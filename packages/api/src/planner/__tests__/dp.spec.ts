import { compareScore } from '@cinema/shared'
import { describe, expect, it } from 'vitest'
import { runDp } from '../dp'
import { selectPlans } from '../kbest'
import type { Candidate, Entry, PlanContext } from '../types'

// docs/12 §7 の検算済み期待値テスト。数値は手計算で確定済み・変更しない。
// 実装が合わない場合は実装を直す（docs/09 進行ルール2）。

const min = (s: string): number => {
  const [h, m] = s.split(':').map(Number)
  return h * 60 + m
}

// セットアップ（docs/12 §7）:
// 劇場 A, B。travel(A,B)=travel(B,A)=20分、同一劇場=0分。m_in=10、arrivalMargin=15。
// origin→A=10分、origin→B=30分。destination なし。window 10:00〜19:00。
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
  movieTitle: `作品${movie}`,
  theaterName: `劇場${theater}`,
  officialUrl: `https://example.com/${theater}`,
})

const CANDS: Candidate[] = [
  cand('s1', 'A', 'X', '10:30', '12:30'),
  cand('s2', 'A', 'Y', '12:50', '14:30'),
  cand('s3', 'B', 'Z', '13:30', '15:30'),
  cand('s4', 'B', 'Y', '15:10', '16:50'),
  cand('s5', 'B', 'W', '16:00', '18:00'),
]

function makeContext(over: Partial<PlanContext> = {}): PlanContext {
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

const ids = (e: Entry): string[] => e.path.map((i) => CANDS[i].screeningId)

describe('planner DP — docs/12 §7 の検算済み期待値', () => {
  it('most_movies は s1>s3>s5、本数3・移動30・待ち45・終了18:00', () => {
    const sols = runDp(makeContext())
    const best = selectPlans(sols, { maxResults: 3, cands: CANDS, mustMovieIds: [] })[0]
    expect(best.label).toBe('most_movies')
    expect(ids(best.entry)).toEqual(['s1', 's3', 's5'])
    expect(best.entry.score).toMatchObject({ count: 3, travel: 30, wait: 45 })
    expect(best.entry.score.endMin).toBe(min('18:00'))
  })

  it('3本解のタイブレーク: 待ち45の s1>s3>s5 が 待ち65の s1>s2>s5 に優先', () => {
    const sols = runDp(makeContext()).filter((e) => e.score.count === 3)
    const sorted = [...sols].sort((a, b) => compareScore(a.score, b.score))
    expect(ids(sorted[0])).toEqual(['s1', 's3', 's5'])
    expect(sorted[0].score.wait).toBe(45)
    expect(ids(sorted[1])).toEqual(['s1', 's2', 's5'])
    expect(sorted[1].score.wait).toBe(65)
  })

  it('must={Z}: most_movies は変わらず s1>s3>s5（全解が Z を含む）', () => {
    const ctx = makeContext({ mustMovieIds: ['Z'] })
    const sols = runDp(ctx)
    // 有効解はすべて s3（作品Z）を含む
    for (const e of sols) {
      expect(e.path.map((i) => CANDS[i].movieId)).toContain('Z')
    }
    const best = selectPlans(sols, { maxResults: 3, cands: CANDS, mustMovieIds: ['Z'] })[0]
    expect(ids(best.entry)).toEqual(['s1', 's3', 's5'])
  })

  it('windowStart=13:00 では最大1本（s3 は最遅出発 12:45 で間に合わない）', () => {
    const sols = runDp(makeContext({ windowStartMin: min('13:00') }))
    const maxCount = Math.max(0, ...sols.map((e) => e.score.count))
    expect(maxCount).toBe(1)
  })

  it('windowStart=12:30 では s3>s5 の2本が最良', () => {
    const sols = runDp(makeContext({ windowStartMin: min('12:30') }))
    const best = selectPlans(sols, { maxResults: 3, cands: CANDS, mustMovieIds: [] })[0]
    expect(best.entry.score.count).toBe(2)
    expect(ids(best.entry)).toEqual(['s3', 's5'])
  })
})

describe('k-best ラベリング — docs/12 §7 代替案（maxResults=3）', () => {
  it('most_movies / less_travel=s1>s2(移動10) / relaxed=s1>s3(終了15:30) が選ばれ重複しない', () => {
    const sols = runDp(makeContext())
    const picked = selectPlans(sols, { maxResults: 3, cands: CANDS, mustMovieIds: [] })
    expect(picked.map((p) => p.label)).toEqual(['most_movies', 'less_travel', 'relaxed'])
    expect(ids(picked[0].entry)).toEqual(['s1', 's3', 's5'])
    // less_travel: 本数2以上で移動最小 = s1>s2（移動10・待ち10）
    expect(ids(picked[1].entry)).toEqual(['s1', 's2'])
    expect(picked[1].entry.score).toMatchObject({ count: 2, travel: 10, wait: 10 })
    // relaxed: seen 除外後、待ち≤30×本数で終了最早 = s1>s3（待ち25・終了15:30）
    expect(ids(picked[2].entry)).toEqual(['s1', 's3'])
    expect(picked[2].entry.score.endMin).toBe(min('15:30'))
    // 重複 Plan なし
    const sigs = picked.map((p) => p.entry.path.join('>'))
    expect(new Set(sigs).size).toBe(sigs.length)
  })

  it('maxResults=5 でも選抜 Plan は重複せず、あるだけ返す（パディングしない）', () => {
    const sols = runDp(makeContext())
    const picked = selectPlans(sols, { maxResults: 5, cands: CANDS, mustMovieIds: [] })
    const sigs = picked.map((p) => p.entry.path.join('>'))
    expect(new Set(sigs).size).toBe(sigs.length)
    expect(picked.length).toBeLessThanOrEqual(5)
    expect(picked.length).toBeGreaterThanOrEqual(3)
  })

  it('作品重複を含む解は選抜されない（各 Plan 内で movieId が一意）', () => {
    const sols = runDp(makeContext())
    const picked = selectPlans(sols, { maxResults: 5, cands: CANDS, mustMovieIds: [] })
    for (const p of picked) {
      const movies = p.entry.path.map((i) => CANDS[i].movieId)
      expect(new Set(movies).size).toBe(movies.length)
    }
  })
})
