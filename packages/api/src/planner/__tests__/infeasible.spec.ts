import { describe, expect, it } from 'vitest'
import { planFromCandidates } from '../index'
import type { Candidate, PlanContext } from '../types'

// infeasible 判定（P2-4。docs/spec/05 §7 / docs/spec/10 §8 の分岐）

const min = (s: string): number => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

const cand = (
  id: string,
  theater: string,
  movie: string,
  start: string,
  end: string,
): Candidate => ({
  screeningId: id,
  theaterId: theater,
  movieId: movie,
  startMin: min(start),
  endMin: min(end),
  format: null,
  detailUrl: null,
  movieTitle: movie,
  theaterName: theater,
  officialUrl: 'https://example.com/',
})

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  return {
    cands: [cand('s1', 'A', 'X', '10:30', '12:30')],
    mustMovieIds: [],
    arrivalMarginMin: 15,
    windowStartMin: min('10:00'),
    windowEndMin: min('19:00'),
    travel: { between: (a, b) => (a === b ? 0 : 20) },
    originToTheaterMin: new Map([['A', 10]]),
    theaterToDestMin: null,
    ...over,
  }
}

describe('infeasible 判定（docs/spec/05 §7 の判定順）', () => {
  it('候補空（時間帯フィルタで全滅・must無し）→ time_window_too_narrow', () => {
    // no_screenings（対象日の上映0件）はフィルタ前の件数で plan() 側が判定する（docs/spec/05 §7）
    const res = planFromCandidates(ctx({ cands: [] }), 3)
    expect(res.plans).toEqual([])
    expect(res.infeasible?.reason).toBe('time_window_too_narrow')
  })

  it('must 作品が候補に不在 → must_movie_unreachable + drop_must/widen', () => {
    const res = planFromCandidates(ctx({ mustMovieIds: ['NOT_EXIST'] }), 3)
    expect(res.infeasible?.reason).toBe('must_movie_unreachable')
    expect(res.infeasible?.relaxSuggestions).toEqual(['drop_must_movie', 'widen_time_window'])
  })

  it('must は候補にあるが経路に組み込めない → must_movie_unreachable + increase_margin', () => {
    // 窓が狭く s1 に間に合わない（最遅出発 10:05 < 10:30 開始の窓）
    const res = planFromCandidates(
      ctx({ mustMovieIds: ['X'], windowStartMin: min('10:30'), windowEndMin: min('19:00') }),
      3,
    )
    expect(res.infeasible?.reason).toBe('must_movie_unreachable')
    expect(res.infeasible?.relaxSuggestions).toContain('increase_margin_tolerance')
  })

  it('must 無しで1本も観られない → time_window_too_narrow + widen/remove_destination', () => {
    const res = planFromCandidates(ctx({ windowStartMin: min('10:30') }), 3)
    expect(res.infeasible?.reason).toBe('time_window_too_narrow')
    expect(res.infeasible?.relaxSuggestions).toEqual(['widen_time_window', 'remove_destination'])
  })

  it('実行可能なら plans を返し infeasible は無い', () => {
    const res = planFromCandidates(ctx(), 3)
    expect(res.plans.length).toBeGreaterThan(0)
    expect(res.infeasible ?? null).toBeNull()
  })

  it('destination 指定時: ゴール到着が window を超える解は除外される', () => {
    // s1 終了 12:30 + dest 30分 = 13:00 > windowEnd 12:45 → 解なし
    const res = planFromCandidates(
      ctx({
        windowEndMin: min('12:45'),
        theaterToDestMin: new Map([['A', 30]]),
      }),
      3,
    )
    expect(res.infeasible?.reason).toBe('time_window_too_narrow')
  })
})
