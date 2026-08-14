import { describe, expect, it } from 'vitest'
import { buildPlan } from '../build'
import { runDp } from '../dp'
import { selectPlans } from '../kbest'
import type { Candidate, PlanContext } from '../types'

// Entry → API Plan 変換（docs/spec/10 §9）。docs/spec/10 §7 の most_movies で legs を検証する。

const min = (s: string): number => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}
const iso = (s: string): string => new Date(min(s) * 60_000).toISOString()

const cand = (
  id: string,
  theater: string,
  movie: string,
  start: string,
  end: string,
  detailUrl: string | null = null,
): Candidate => ({
  screeningId: id,
  theaterId: theater,
  movieId: movie,
  startMin: min(start),
  endMin: min(end),
  format: null,
  detailUrl,
  movieTitle: `作品${movie}`,
  theaterName: `劇場${theater}`,
  officialUrl: `https://example.com/${theater}`,
})

const CANDS = [
  cand('s1', 'A', 'X', '10:30', '12:30', 'https://example.com/A/movie-x'),
  cand('s2', 'A', 'Y', '12:50', '14:30'),
  cand('s3', 'B', 'Z', '13:30', '15:30'),
  cand('s4', 'B', 'Y', '15:10', '16:50'),
  cand('s5', 'B', 'W', '16:00', '18:00'),
]

function ctx(over: Partial<PlanContext> = {}): PlanContext {
  return {
    cands: CANDS,
    mustMovieIds: [],
    arrivalMarginMin: 15,
    windowStartMin: min('10:00'),
    windowEndMin: min('19:00'),
    travel: { between: (a, b) => (a === b ? 0 : 20) },
    originToTheaterMin: new Map([
      ['A', 10],
      ['B', 30],
    ]),
    theaterToDestMin: null,
    ...over,
  }
}

describe('buildPlan（docs/spec/10 §7 の most_movies = s1>s3>s5）', () => {
  const c = ctx()
  const best = selectPlans(runDp(c), { maxResults: 3, cands: CANDS, mustMovieIds: [] })[0]
  const plan = buildPlan(best.label, best.entry, c)

  it('legs の並び: 初回travel → s1 → travel(A→B) → wait25 → s3 → wait20 → s5', () => {
    expect(plan.legs.map((l) => l.kind)).toEqual([
      'travel', // origin → A（10分）
      'screening', // s1
      'travel', // A → B（20分）
      'wait', // 25分
      'screening', // s3
      'wait', // 20分（同一劇場は travel leg 省略）
      'screening', // s5
    ])
  })

  it('初回 travel は最遅出発（wait 0）: 10:05 発 → 10:15 着（マージン15分前）', () => {
    const first = plan.legs[0]
    if (first.kind !== 'travel') throw new Error('unreachable')
    expect(first.fromTheaterId ?? null).toBeNull()
    expect(first.departAt).toBe(iso('10:05'))
    expect(first.arriveAt).toBe(iso('10:15'))
    expect(first.durationMin).toBe(10)
  })

  it('wait leg はマージン超過分のみ（25分・20分）', () => {
    const waits = plan.legs.filter((l) => l.kind === 'wait')
    expect(waits.map((w) => (w.kind === 'wait' ? w.minutes : -1))).toEqual([25, 20])
  })

  it('screening leg は detail_url 優先で officialUrl を設定', () => {
    const screenings = plan.legs.filter((l) => l.kind === 'screening')
    expect(screenings[0].kind === 'screening' && screenings[0].officialUrl).toBe(
      'https://example.com/A/movie-x',
    )
    expect(screenings[1].kind === 'screening' && screenings[1].officialUrl).toBe(
      'https://example.com/B',
    )
  })

  it('stats = 3本 / 移動30 / 待ち45 / 終了18:00', () => {
    expect(plan.stats).toEqual({
      movieCount: 3,
      totalTravelMin: 30,
      totalWaitMin: 45,
      endTime: iso('18:00'),
    })
  })

  it('destination 指定時は最後に dest への travel leg が付き endTime が到着時刻になる', () => {
    const c2 = ctx({
      theaterToDestMin: new Map([
        ['A', 10],
        ['B', 30],
      ]),
    })
    const best2 = selectPlans(runDp(c2), { maxResults: 3, cands: CANDS, mustMovieIds: [] })[0]
    const plan2 = buildPlan(best2.label, best2.entry, c2)
    const lastLeg = plan2.legs[plan2.legs.length - 1]
    expect(lastLeg.kind).toBe('travel')
    if (lastLeg.kind !== 'travel') throw new Error('unreachable')
    expect(lastLeg.toTheaterId ?? null).toBeNull()
    expect(plan2.stats.endTime).toBe(lastLeg.arriveAt)
    expect(plan2.stats.totalTravelMin).toBe(best2.entry.score.travel + lastLeg.durationMin)
  })
})
