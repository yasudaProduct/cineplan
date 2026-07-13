import { afterEach, describe, expect, it, vi } from 'vitest'
import { resolveStationToGeo } from '../station-geo'

// 駅名→座標のジオコーディング（P4-6・ADR-0014）。KV 30日キャッシュ・失敗は null（→400）。

function fakeKv(seed: Record<string, string> = {}) {
  const store = new Map(Object.entries(seed))
  const puts: { key: string; value: string; ttl?: number }[] = []
  return {
    kv: {
      async get(key: string, _type: 'json') {
        const v = store.get(key)
        return v ? JSON.parse(v) : null
      },
      async put(key: string, value: string, opts?: { expirationTtl?: number }) {
        store.set(key, value)
        puts.push({ key, value, ttl: opts?.expirationTtl })
      },
    } as unknown as KVNamespace,
    puts,
  }
}

const suggestResponse = (stations: unknown[]) =>
  new Response(JSON.stringify({ stations }), { status: 200 })

afterEach(() => vi.unstubAllGlobals())

describe('resolveStationToGeo', () => {
  it('KV ヒット時は外部 API を呼ばない', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const { kv } = fakeKv({ 'station-geo:梅田': JSON.stringify({ lat: 34.7, lng: 135.49 }) })
    const geo = await resolveStationToGeo(kv, '梅田')
    expect(geo).toEqual({ lat: 34.7, lng: 135.49 })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('ミス時は suggest を1回呼び、kind=station を優先して TTL 30日で KV 保存する', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request) =>
      suggestResponse([
        { name: '梅田入口', kind: 'stop', lat: 34.0, lon: 135.0 }, // バス停は優先しない
        { name: '梅田', kind: 'station', lat: 34.70313, lon: 135.497685 },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { kv, puts } = fakeKv()
    const geo = await resolveStationToGeo(kv, '梅田')
    expect(geo).toEqual({ lat: 34.70313, lng: 135.497685 })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/v1/locations/suggest?q=')
    expect(puts[0]?.key).toBe('station-geo:梅田')
    expect(puts[0]?.ttl).toBe(30 * 24 * 3600)
  })

  it('station が無ければ先頭の座標付き候補を使う', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        suggestResponse([{ name: 'テスト前', kind: 'stop', lat: 35.0, lon: 139.0 }]),
      ),
    )
    const { kv } = fakeKv()
    expect(await resolveStationToGeo(kv, 'テスト前')).toEqual({ lat: 35.0, lng: 139.0 })
  })

  it('候補ゼロ・HTTP エラー・fetch 例外は null（→呼び元で 400）', async () => {
    const { kv } = fakeKv()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => suggestResponse([])),
    )
    expect(await resolveStationToGeo(kv, '存在しない駅XYZ')).toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('err', { status: 500 })),
    )
    expect(await resolveStationToGeo(kv, '梅田')).toBeNull()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('network'))),
    )
    expect(await resolveStationToGeo(kv, '梅田')).toBeNull()
  })
})
