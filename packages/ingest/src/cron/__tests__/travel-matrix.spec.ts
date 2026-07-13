import { beforeEach, describe, expect, it, vi } from 'vitest'

// TravelMatrix 週次生成（P4-6・ADR-0014・docs/03 §5.1）のユニットテスト。
// 実 API は叩かず fetch をモック。要点: door-to-door 分の計算・複数案の最小値・
// summaries 連結・失敗ペアの前回値温存・全滅時の未書込・retired 除外。

const theatersMock = vi.fn()
vi.mock('../../db/theaters', () => ({ listAllTheaters: theatersMock }))

const { buildTravelMatrix, fetchPairMinutes, representativeDate, readTravelMatrixMeta } =
  await import('../travel-matrix')

const T = (id: string, status = 'paused', lat = 34.6, lng = 135.4) => ({
  id,
  status,
  lat,
  lng,
  name: id,
})

function fakeKv(seed: Record<string, unknown> = {}) {
  const store = new Map(Object.entries(seed).map(([k, v]) => [k, JSON.stringify(v)]))
  return {
    async get(key: string, _t: 'json') {
      const v = store.get(key)
      return v ? JSON.parse(v) : null
    },
    async put(key: string, value: string) {
      store.set(key, value)
    },
    _store: store,
  } as unknown as KVNamespace & { _store: Map<string, string> }
}

const journey = (durationSecs: number, accessWalkSecs = 0, routes: string[] = []) => ({
  durationSecs,
  accessWalkSecs,
  legs: routes.map((r) => ({ kind: 'transit', routeName: r })),
})

const planResponse = (...journeys: unknown[]) =>
  new Response(JSON.stringify({ journeys }), { status: 200 })

const envOf = (kv: KVNamespace) => ({ DB: {} as D1Database, KV: kv }) as never

beforeEach(() => {
  theatersMock.mockReset()
})

describe('fetchPairMinutes', () => {
  it('door-to-door 分 = ceil((accessWalkSecs + durationSecs)/60)・複数案の最小値・路線名連結', async () => {
    const fetchFn = vi.fn(async (_url: string | URL | Request) =>
      planResponse(
        journey(1106, 511, ['大阪環状線']),
        journey(1050, 900, ['長堀鶴見緑地線', '御堂筋線']),
      ),
    )
    const r = await fetchPairMinutes(
      'https://example.test',
      { lat: 34.6692, lng: 135.4781 },
      { lat: 34.70313, lng: 135.497685 },
      '20260714',
      fetchFn as unknown as typeof fetch,
    )
    // (511+1106)=1617s=27分 < (900+1050)=1950s → 27分・大阪環状線
    expect(r).toEqual({ minutes: 27, summary: '大阪環状線' })
    const url = String(fetchFn.mock.calls[0]?.[0])
    expect(url).toContain('/api/v1/plan?')
    expect(url).toContain('time=13%3A00')
    expect(url).toContain('date=20260714')
  })

  it('journeys 空・HTTP エラー・例外は null', async () => {
    expect(
      await fetchPairMinutes('x', { lat: 0, lng: 0 }, { lat: 1, lng: 1 }, '20260714', (async () =>
        planResponse()) as unknown as typeof fetch),
    ).toBeNull()
    expect(
      await fetchPairMinutes(
        'x',
        { lat: 0, lng: 0 },
        { lat: 1, lng: 1 },
        '20260714',
        (async () => new Response('e', { status: 500 })) as unknown as typeof fetch,
      ),
    ).toBeNull()
    expect(
      await fetchPairMinutes('x', { lat: 0, lng: 0 }, { lat: 1, lng: 1 }, '20260714', (async () => {
        throw new Error('network')
      }) as unknown as typeof fetch),
    ).toBeNull()
  })
})

describe('representativeDate', () => {
  it('翌日（JST）の YYYYMMDD を返す（実行時刻に依存しない昼間ダイヤ用）', () => {
    // 2026-07-13T20:00Z = 7/14 05:00 JST → 翌日 7/15
    expect(representativeDate(new Date('2026-07-13T20:00:00Z'))).toBe('20260715')
    // 2026-07-13T10:00Z = 7/13 19:00 JST → 翌日 7/14
    expect(representativeDate(new Date('2026-07-13T10:00:00Z'))).toBe('20260714')
  })
})

describe('buildTravelMatrix', () => {
  it('retired を除外し、全ペアを取得して KV に書く（対角0・非対称対応）', async () => {
    theatersMock.mockResolvedValue([
      T('thr_a', 'active'),
      T('thr_b', 'paused'),
      T('thr_x', 'retired'),
    ])
    const kv = fakeKv()
    const fetchFn = vi.fn(async (url: string) =>
      planResponse(journey(String(url).includes('from=geo%3A34.6') ? 600 : 900, 60, ['御堂筋線'])),
    )
    const r = await buildTravelMatrix(envOf(kv), {
      intervalMs: 0,
      now: new Date('2026-07-13T00:00:00Z'),
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    expect(r).toMatchObject({
      theaters: 2,
      pairs: 2,
      updated: 2,
      carried: 0,
      missing: 0,
      skippedWrite: false,
    })
    const stored = JSON.parse(kv._store.get('travel-matrix:v1') ?? 'null')
    expect(stored.unit).toBe('minutes')
    expect(stored.theaters).toEqual(['thr_a', 'thr_b'])
    expect(stored.matrix[0][0]).toBe(0)
    expect(stored.matrix[1][1]).toBe(0)
    expect(typeof stored.matrix[0][1]).toBe('number')
    expect(stored.summaries['thr_a>thr_b']).toBe('御堂筋線')
  })

  it('失敗ペアは前回値を温存し、前回も無ければ null（missing）', async () => {
    theatersMock.mockResolvedValue([T('thr_a'), T('thr_b'), T('thr_c')])
    const kv = fakeKv({
      'travel-matrix:v1': {
        generatedAt: '2026-07-06T00:00:00Z',
        unit: 'minutes',
        theaters: ['thr_a', 'thr_b'],
        matrix: [
          [0, 24],
          [26, 0],
        ],
      },
    })
    // thr_a→thr_b だけ成功、他は全部失敗
    const fetchFn = vi.fn(async (url: string) => {
      const u = decodeURIComponent(String(url))
      if (u.includes('from=geo:34.6,135.4') && u.includes('to=geo:34.6,135.4')) {
        // 座標が同じなので from/to では区別できない → 呼出順で1回目だけ成功させる
      }
      return fetchFn.mock.calls.length === 1 ? planResponse(journey(600, 0)) : planResponse()
    })
    const r = await buildTravelMatrix(envOf(kv), {
      intervalMs: 0,
      now: new Date('2026-07-13T00:00:00Z'),
      fetchFn: fetchFn as unknown as typeof fetch,
    })
    // 6ペア中: 1成功 / thr_b→thr_a は前回値26を温存 / 残り4は missing
    expect(r.updated).toBe(1)
    expect(r.carried).toBe(1)
    expect(r.missing).toBe(4)
    const stored = JSON.parse(kv._store.get('travel-matrix:v1') ?? 'null')
    expect(stored.matrix[1][0]).toBe(26) // 温存
    expect(stored.matrix[0][2]).toBeNull() // 新劇場ペアは null → planner がフォールバック
  })

  it('全滅（成功0・温存0）なら KV を上書きしない', async () => {
    theatersMock.mockResolvedValue([T('thr_a'), T('thr_b')])
    const kv = fakeKv()
    const r = await buildTravelMatrix(envOf(kv), {
      intervalMs: 0,
      now: new Date('2026-07-13T00:00:00Z'),
      fetchFn: (async () => planResponse()) as unknown as typeof fetch,
    })
    expect(r.skippedWrite).toBe(true)
    expect(kv._store.has('travel-matrix:v1')).toBe(false)
  })

  it('劇場1館（ペア0）でも空行列を書き、meta が読める', async () => {
    theatersMock.mockResolvedValue([T('thr_a', 'active')])
    const kv = fakeKv()
    const r = await buildTravelMatrix(envOf(kv), {
      intervalMs: 0,
      now: new Date('2026-07-13T00:00:00Z'),
      fetchFn: (async () => planResponse()) as unknown as typeof fetch,
    })
    expect(r).toMatchObject({ theaters: 1, pairs: 0, skippedWrite: false })
    const meta = await readTravelMatrixMeta(kv)
    expect(meta).toMatchObject({ theaters: 1, missing: 0 })
  })
})
