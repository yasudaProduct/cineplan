import { compareScore, type PlanLabel } from '@cinema/shared'
import type { Candidate, Entry } from './types'

// k-best 解プールからの代替案選抜（docs/12 §6 / docs/05 §6）。
// 作品重複を含む解はここで棄却する（ADR-0006 の妥協。DP 状態では管理しない）。

export interface LabeledPlan {
  label: PlanLabel
  entry: Entry
}

const sig = (e: Entry): string => e.path.join('>')

export function selectPlans(
  solutions: Entry[],
  opts: { maxResults: number; cands: Candidate[]; mustMovieIds: string[] },
): LabeledPlan[] {
  if (solutions.length === 0) return []
  const { cands, maxResults } = opts

  const hasDupMovie = (e: Entry): boolean => {
    const ids = e.path.map((i) => cands[i].movieId)
    return new Set(ids).size !== ids.length
  }

  const sorted = [...solutions].sort((a, b) => compareScore(a.score, b.score))
  const valid = sorted.filter((e) => !hasDupMovie(e))
  if (valid.length === 0) return []

  // most_movies すら棄却された場合は次善の valid 解が自動的に繰り上がる（docs/12 §6）
  const best = valid[0]
  const picked: LabeledPlan[] = [{ label: 'most_movies', entry: best }]
  const seen = new Set([sig(best)])

  const pick = (
    label: PlanLabel,
    pred: (e: Entry) => boolean,
    cmp: (a: Entry, b: Entry) => number,
  ): void => {
    if (picked.length >= maxResults) return
    const cand = valid.filter((e) => !seen.has(sig(e)) && pred(e)).sort(cmp)
    const top = cand[0]
    if (top) {
      picked.push({ label, entry: top })
      seen.add(sig(top))
    }
  }

  // less_travel: 本数 best−1 以内で総移動最小
  pick(
    'less_travel',
    (e) => e.score.count >= best.score.count - 1,
    (a, b) => a.score.travel - b.score.travel || compareScore(a.score, b.score),
  )

  // relaxed: 本数 best−1 以内 かつ 1本あたり待ち ≤ 30分 で終了最早
  pick(
    'relaxed',
    (e) => e.score.count >= best.score.count - 1 && e.score.wait <= 30 * e.score.count,
    (a, b) => a.score.endMin - b.score.endMin || compareScore(a.score, b.score),
  )

  // must_priority: must 指定時のみ。最初の must 作品の startMin が最小の解（docs/05 §6）
  if (opts.mustMovieIds.length > 0) {
    const mustSet = new Set(opts.mustMovieIds)
    const firstMustStart = (e: Entry): number => {
      for (const i of e.path) if (mustSet.has(cands[i].movieId)) return cands[i].startMin
      return Number.MAX_SAFE_INTEGER
    }
    pick(
      'must_priority',
      () => true,
      (a, b) => firstMustStart(a) - firstMustStart(b) || compareScore(a.score, b.score),
    )
  }

  // alt: 残り枠を未選抜の次善解で埋める（docs/05 §6 #5。プールが枯れたらあるだけ返す）
  for (const e of valid) {
    if (picked.length >= maxResults) break
    if (seen.has(sig(e))) continue
    picked.push({ label: 'alt', entry: e })
    seen.add(sig(e))
  }

  return picked.slice(0, maxResults)
}
