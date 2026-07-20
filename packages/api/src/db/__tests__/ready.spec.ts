import { describe, expect, it } from 'vitest'
import { isDataReady } from '../ready'

// P4-0 の回帰テスト: isDataReady は active 劇場のデータのみで判定する。
// paused 劇場だけがデータを持つ場合は not ready（→ /plan は 422 DATA_NOT_READY）。
//
// フェイク D1 は SQL に active フィルタ（t.status = 'active'）が含まれるかで挙動を変える。
// 将来 SQL から active 条件が消えると、paused-only ケースのテストが落ちて回帰を検出する。
interface Seed {
  theaters: { id: string; status: string }[]
  screenings: { theaterId: string; businessDate: string }[]
  runs: { theaterId: string; businessDate: string; status: string }[]
}

function createFakeDb(seed: Seed) {
  const activeIds = new Set(seed.theaters.filter((t) => t.status === 'active').map((t) => t.id))
  return {
    prepare(sql: string) {
      const filtersActive = sql.includes("t.status = 'active'")
      const eligible = (theaterId: string) => (filtersActive ? activeIds.has(theaterId) : true)
      return {
        bind(date: string) {
          return {
            async first() {
              if (/FROM screenings/.test(sql)) {
                const hit = seed.screenings.some(
                  (s) => s.businessDate === date && eligible(s.theaterId),
                )
                return hit ? { 1: 1 } : null
              }
              const hit = seed.runs.some(
                (r) => r.businessDate === date && r.status === 'succeeded' && eligible(r.theaterId),
              )
              return hit ? { 1: 1 } : null
            },
          }
        },
      }
    },
  } as unknown as D1Database
}

const D = '2026-07-15'

describe('isDataReady — active 劇場限定（P4-0）', () => {
  it('active 劇場に対象日の screenings があれば ready', async () => {
    const db = createFakeDb({
      theaters: [{ id: 'thr_a', status: 'active' }],
      screenings: [{ theaterId: 'thr_a', businessDate: D }],
      runs: [],
    })
    expect(await isDataReady(db, D)).toBe(true)
  })

  it('paused 劇場だけが screenings を持つ場合は not ready（回帰: 旧実装は true だった）', async () => {
    const db = createFakeDb({
      theaters: [{ id: 'thr_cnv01', status: 'paused' }],
      screenings: [{ theaterId: 'thr_cnv01', businessDate: D }],
      runs: [{ theaterId: 'thr_cnv01', businessDate: D, status: 'succeeded' }],
    })
    expect(await isDataReady(db, D)).toBe(false)
  })

  it('screenings は無いが active 劇場の succeeded run があれば ready（休館日0件を拾う）', async () => {
    const db = createFakeDb({
      theaters: [{ id: 'thr_a', status: 'active' }],
      screenings: [],
      runs: [{ theaterId: 'thr_a', businessDate: D, status: 'succeeded' }],
    })
    expect(await isDataReady(db, D)).toBe(true)
  })

  it('active 劇場の run が失敗のみなら not ready', async () => {
    const db = createFakeDb({
      theaters: [{ id: 'thr_a', status: 'active' }],
      screenings: [],
      runs: [{ theaterId: 'thr_a', businessDate: D, status: 'fetch_failed' }],
    })
    expect(await isDataReady(db, D)).toBe(false)
  })

  it('データが一切無ければ not ready', async () => {
    const db = createFakeDb({ theaters: [], screenings: [], runs: [] })
    expect(await isDataReady(db, D)).toBe(false)
  })
})
