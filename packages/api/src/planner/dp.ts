import { compareScore } from '@cinema/shared'
import type { Entry, PlanContext } from './types'

// マストビットマスク付き DP（docs/12 §5 の参照実装。定式化は docs/05 §3）。
// compareScore（shared）が唯一の比較基準。乱数・Map イテレーション順に依存しない。

export const M_IN = 10 // 同一劇場内マージン（分・固定）
const K_KEEP = 9 // 各状態で保持する上位件数（maxResults*3 相当）

export function runDp(ctx: PlanContext): Entry[] {
  const n = ctx.cands.length
  const fullMask = (1 << ctx.mustMovieIds.length) - 1
  const maskOf = (movieId: string): number => {
    const i = ctx.mustMovieIds.indexOf(movieId)
    return i >= 0 ? 1 << i : 0
  }

  // dp[i] = 「最後に観た上映が cands[i]」の Entry リスト（mask 別に混在、上位 K 保持）
  const dp: Entry[][] = Array.from({ length: n }, () => [])

  // 初期化: origin から間に合う各 i（初手 wait は常に 0 = 最遅出発。docs/12 §4）
  for (let i = 0; i < n; i++) {
    const c = ctx.cands[i]
    const oto = ctx.originToTheaterMin.get(c.theaterId)
    if (oto === undefined) continue // 到達不能劇場
    const latestDepart = c.startMin - ctx.arrivalMarginMin - oto
    if (latestDepart < ctx.windowStartMin) continue // 初手に間に合わない
    dp[i].push({
      score: { count: 1, travel: oto, wait: 0, endMin: c.endMin, lastId: c.screeningId },
      path: [i],
      mask: maskOf(c.movieId),
    })
  }

  // 遷移: i < j（startMin 昇順なので時系列順が保証される）
  for (let i = 0; i < n; i++) {
    if (dp[i].length === 0) continue
    const ci = ctx.cands[i]
    for (let j = i + 1; j < n; j++) {
      const cj = ctx.cands[j]
      // 作品重複は k-best 段階で棄却（docs/05 §3 の妥協）。同一作品への即時遷移のみ早期スキップ
      if (ci.movieId === cj.movieId) continue
      const m = ci.theaterId === cj.theaterId ? M_IN : ctx.arrivalMarginMin
      const tv = ctx.travel.between(ci.theaterId, cj.theaterId)
      const earliestReady = ci.endMin + tv + m
      if (earliestReady > cj.startMin) continue // 連結不可
      const waitJ = cj.startMin - earliestReady

      for (const e of dp[i]) {
        insertTopK(
          dp[j],
          {
            score: {
              count: e.score.count + 1,
              travel: e.score.travel + tv,
              wait: e.score.wait + waitJ,
              endMin: cj.endMin,
              lastId: cj.screeningId,
            },
            path: [...e.path, j],
            mask: e.mask | maskOf(cj.movieId),
          },
          K_KEEP,
        )
      }
    }
  }

  // 解の収集: must 全達成（mask==fullMask）かつ終了条件を満たす Entry
  const solutions: Entry[] = []
  for (let i = 0; i < n; i++) {
    for (const e of dp[i]) {
      if (e.mask !== fullMask) continue
      const last = ctx.cands[i]
      if (ctx.theaterToDestMin) {
        const td = ctx.theaterToDestMin.get(last.theaterId)
        if (td === undefined) continue
        if (last.endMin + td > ctx.windowEndMin) continue
      } else if (last.endMin > ctx.windowEndMin) {
        continue
      }
      solutions.push(e)
    }
  }
  return solutions
}

// compareScore 順に上位 K 件を保持（同一 path は入れない）
function insertTopK(list: Entry[], e: Entry, k: number): void {
  const key = e.path.join(',')
  if (list.some((x) => x.path.join(',') === key)) return
  list.push(e)
  list.sort((a, b) => compareScore(a.score, b.score))
  if (list.length > k) list.length = k
}
