import type { NormalizedScreening } from '@cinema/shared'
import { describe, expect, it } from 'vitest'
import { replaceScreeningsByDate } from '../screenings'

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
