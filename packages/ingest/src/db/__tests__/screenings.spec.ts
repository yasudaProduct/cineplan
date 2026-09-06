import type { NormalizedScreening } from '@cinema/shared'
import { describe, expect, it } from 'vitest'
import { pickDefaultDate, replaceScreeningsByDate } from '../screenings'

// D1Database の最小フェイク。prepare().bind() で捕捉した stmt を batch() 実行時に
// インメモリ行に対して適用する（DELETE/INSERT のみ対応）。
interface Row {
  theaterId: string
  businessDate: string
  movieId: string
}

function createFakeDb(seed: Row[]) {
  let rows = [...seed]
  let batchCalls = 0
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return { sql, args }
        },
      }
    },
    async batch(stmts: Array<{ sql: string; args: unknown[] }>) {
      batchCalls++
      for (const s of stmts) {
        if (s.sql.startsWith('DELETE')) {
          const [theaterId, businessDate] = s.args as [string, string]
          rows = rows.filter((r) => !(r.theaterId === theaterId && r.businessDate === businessDate))
        } else if (s.sql.startsWith('INSERT')) {
          // (id, theater_id, movie_id, business_date, ...)
          const [, theaterId, movieId, businessDate] = s.args as [string, string, string, string]
          rows.push({ theaterId, businessDate, movieId })
        }
      }
      return []
    },
  }
  return {
    db: db as unknown as D1Database,
    getRows: () => rows,
    getBatchCalls: () => batchCalls,
  }
}

function screening(businessDate: string, movieId: string): NormalizedScreening {
  return {
    businessDate,
    movieId,
    startAt: `${businessDate}T01:00:00.000Z`,
    endAt: `${businessDate}T03:00:00.000Z`,
    endAtSource: 'site',
    format: null,
    screenName: '',
    detailUrl: null,
  }
}

describe('replaceScreeningsByDate — stale データ防止（review指摘#3の回帰テスト）', () => {
  it('抽出結果が完全に空でも coverageFloor(today) の古い screenings は洗い替えられる', async () => {
    const { db, getRows, getBatchCalls } = createFakeDb([
      { theaterId: 'thr_a', businessDate: '2026-07-10', movieId: 'mov_old' },
    ])
    const written = await replaceScreeningsByDate(db, 'thr_a', 'run_1', [], '2026-07-10')
    expect(written).toBe(0)
    expect(getRows()).toEqual([]) // 古い上映が消える（修正前は残り続けた）
    expect(getBatchCalls()).toBe(1) // 1トランザクションで実行
  })

  it('抽出結果に現れない日（休館日等）も min〜max 範囲内なら洗い替えられる', async () => {
    const { db, getRows } = createFakeDb([
      { theaterId: 'thr_a', businessDate: '2026-07-12', movieId: 'mov_old' }, // 抽出で消えた日
    ])
    const rows = [screening('2026-07-10', 'mov_new'), screening('2026-07-15', 'mov_new2')]
    await replaceScreeningsByDate(db, 'thr_a', 'run_1', rows, '2026-07-10')
    const result = getRows()
    expect(result.some((r) => r.businessDate === '2026-07-12')).toBe(false) // stale が消える
    expect(result.some((r) => r.businessDate === '2026-07-10')).toBe(true)
    expect(result.some((r) => r.businessDate === '2026-07-15')).toBe(true)
  })

  it('抽出の最小日が coverageFloor より後でも floor は必ず洗い替え範囲に含む', async () => {
    const { db, getRows } = createFakeDb([
      { theaterId: 'thr_a', businessDate: '2026-07-10', movieId: 'mov_old' }, // today の古い行
    ])
    // 抽出は 07-11 以降のみ（今日 07-10 分が抽出から欠落したケース）
    const rows = [screening('2026-07-11', 'mov_new')]
    await replaceScreeningsByDate(db, 'thr_a', 'run_1', rows, '2026-07-10')
    const result = getRows()
    expect(result.some((r) => r.businessDate === '2026-07-10')).toBe(false) // floor も洗い替え対象
  })

  it('他劇場・範囲外日付の screenings には影響しない', async () => {
    const { db, getRows } = createFakeDb([
      { theaterId: 'thr_other', businessDate: '2026-07-10', movieId: 'mov_x' },
      { theaterId: 'thr_a', businessDate: '2026-08-01', movieId: 'mov_y' }, // 範囲外
    ])
    await replaceScreeningsByDate(
      db,
      'thr_a',
      'run_1',
      [screening('2026-07-10', 'mov_new')],
      '2026-07-10',
    )
    const result = getRows()
    expect(result.some((r) => r.theaterId === 'thr_other')).toBe(true)
    expect(result.some((r) => r.businessDate === '2026-08-01')).toBe(true)
  })

  it('written は実際に INSERT した行数を返す', async () => {
    const { db } = createFakeDb([])
    const rows = [
      screening('2026-07-10', 'a'),
      screening('2026-07-11', 'b'),
      screening('2026-07-11', 'c'),
    ]
    const written = await replaceScreeningsByDate(db, 'thr_a', 'run_1', rows, '2026-07-10')
    expect(written).toBe(3)
  })
})

describe('pickDefaultDate — 上映データ画面の既定表示日（docs/spec/07 §2.6）', () => {
  it('今日のデータがあれば今日', () => {
    expect(pickDefaultDate(['2026-07-19', '2026-07-20', '2026-07-21'], '2026-07-20')).toBe(
      '2026-07-20',
    )
  })
  it('今日が無ければ直近の未来日（入力順に依存しない）', () => {
    expect(pickDefaultDate(['2026-07-23', '2026-07-18', '2026-07-22'], '2026-07-20')).toBe(
      '2026-07-22',
    )
  })
  it('未来日が無ければ最新の過去日', () => {
    expect(pickDefaultDate(['2026-07-15', '2026-07-18'], '2026-07-20')).toBe('2026-07-18')
  })
  it('データが無ければ null', () => {
    expect(pickDefaultDate([], '2026-07-20')).toBeNull()
  })
})

// ADR-0023 の回帰テスト: 抽出を見送った日を coverage に含めると、DELETE だけされて
// INSERT が無く既存データを失う。「上映が無い」と「今回は分からなかった」を区別する。
describe('replaceScreeningsByDate — 見送った日を洗い替え範囲から除外（ADR-0023）', () => {
  it('skipDates の日は DELETE されず既存データが残る', async () => {
    const { db, getRows } = createFakeDb([
      { theaterId: 'thr_a', businessDate: '2026-07-11', movieId: 'mov_old' },
    ])
    // 07-10 と 07-12 は取れたが 07-11 は抽出に失敗して見送った
    const rows = [screening('2026-07-10', 'mov_1'), screening('2026-07-12', 'mov_2')]
    await replaceScreeningsByDate(db, 'thr_a', 'run_1', rows, '2026-07-10', ['2026-07-11'])
    const after = getRows()
    expect(after.filter((r) => r.businessDate === '2026-07-11')).toEqual([
      { theaterId: 'thr_a', businessDate: '2026-07-11', movieId: 'mov_old' },
    ])
    expect(after.map((r) => r.movieId).sort()).toEqual(['mov_1', 'mov_2', 'mov_old'])
  })

  it('skipDates 未指定なら従来どおり範囲内の中日も洗い替える（stale データ防止は維持）', async () => {
    const { db, getRows } = createFakeDb([
      { theaterId: 'thr_a', businessDate: '2026-07-11', movieId: 'mov_old' },
    ])
    const rows = [screening('2026-07-10', 'mov_1'), screening('2026-07-12', 'mov_2')]
    await replaceScreeningsByDate(db, 'thr_a', 'run_1', rows, '2026-07-10')
    expect(
      getRows()
        .map((r) => r.movieId)
        .sort(),
    ).toEqual(['mov_1', 'mov_2'])
  })

  it('抽出行がある日は skipDates に入っていても洗い替える（書込側を優先し重複を防ぐ）', async () => {
    const { db, getRows } = createFakeDb([
      { theaterId: 'thr_a', businessDate: '2026-07-10', movieId: 'mov_old' },
    ])
    await replaceScreeningsByDate(
      db,
      'thr_a',
      'run_1',
      [screening('2026-07-10', 'mov_1')],
      '2026-07-10',
      ['2026-07-10'],
    )
    expect(getRows().map((r) => r.movieId)).toEqual(['mov_1'])
  })
})

// ADR-0024 の回帰テスト: スクリーン名を公開しない劇場は、同一作品の同時刻並行上映が
// UNIQUE (theater_id, business_date, movie_id, start_at, screen_name) の同一キーになる。
// 畳まずに INSERT すると UNIQUE 違反で batch() 全体が落ち、洗い替えも承認も失敗する。
describe('replaceScreeningsByDate — UNIQUE キー重複を畳む（ADR-0024）', () => {
  it('同一 (日付・作品・開始時刻・スクリーン) の行は1件に畳む', async () => {
    const { db, getRows } = createFakeDb([])
    const dup = screening('2026-09-06', 'mov_live')
    const written = await replaceScreeningsByDate(
      db,
      'thr_a',
      'run_1',
      [dup, { ...dup }, screening('2026-09-06', 'mov_other')],
      '2026-09-06',
    )
    expect(written).toBe(2)
    expect(
      getRows()
        .map((r) => r.movieId)
        .sort(),
    ).toEqual(['mov_live', 'mov_other'])
  })

  it('スクリーン名が異なれば畳まない（多スクリーン館の並行上映は別行）', async () => {
    const { db, getRows } = createFakeDb([])
    const base = screening('2026-09-06', 'mov_live')
    const written = await replaceScreeningsByDate(
      db,
      'thr_a',
      'run_1',
      [
        { ...base, screenName: 'スクリーン1' },
        { ...base, screenName: 'スクリーン2' },
      ],
      '2026-09-06',
    )
    expect(written).toBe(2)
    expect(getRows()).toHaveLength(2)
  })

  it('開始時刻が違えば畳まない', async () => {
    const { db } = createFakeDb([])
    const base = screening('2026-09-06', 'mov_live')
    const written = await replaceScreeningsByDate(
      db,
      'thr_a',
      'run_1',
      [base, { ...base, startAt: '2026-09-06T05:00:00.000Z' }],
      '2026-09-06',
    )
    expect(written).toBe(2)
  })
})
