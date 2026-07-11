import type { Leg, Plan, PlanLabel } from '@cinema/shared'
import { M_IN } from './dp'
import type { Entry, PlanContext } from './types'

// DP の path（candidate index 列）→ API Plan（legs 配列）変換（docs/12 §9）。
// 分（UTC エポック分）→ ISO 変換はこの層だけで行う。

const minToIso = (m: number): string => new Date(m * 60_000).toISOString()

export function buildPlan(label: PlanLabel, e: Entry, ctx: PlanContext): Plan {
  const cands = ctx.cands
  const legs: Leg[] = []

  // 1. origin → 最初の劇場（初手 wait=0 の定義どおり最遅出発。docs/12 §4）
  const first = cands[e.path[0]]
  const oto = ctx.originToTheaterMin.get(first.theaterId) ?? 0
  const firstArrive = first.startMin - ctx.arrivalMarginMin
  legs.push({
    kind: 'travel',
    fromTheaterId: null,
    toTheaterId: first.theaterId,
    departAt: minToIso(firstArrive - oto),
    arriveAt: minToIso(firstArrive),
    durationMin: oto,
    summary: null,
  })
  let totalTravel = oto

  // 2. 上映と区間（同一劇場の 0分 travel leg は省略。UI 方針。docs/12 §9）
  for (let k = 0; k < e.path.length; k++) {
    const c = cands[e.path[k]]
    legs.push({
      kind: 'screening',
      theaterId: c.theaterId,
      theaterName: c.theaterName,
      movieId: c.movieId,
      movieTitle: c.movieTitle,
      format: c.format,
      startAt: minToIso(c.startMin),
      endAt: minToIso(c.endMin),
      officialUrl: c.detailUrl ?? c.officialUrl, // detail_url 優先（docs/11 §5.1）
    })
    if (k + 1 < e.path.length) {
      const next = cands[e.path[k + 1]]
      const sameTheater = next.theaterId === c.theaterId
      const tv = ctx.travel.between(c.theaterId, next.theaterId)
      if (!sameTheater) {
        legs.push({
          kind: 'travel',
          fromTheaterId: c.theaterId,
          toTheaterId: next.theaterId,
          departAt: minToIso(c.endMin),
          arriveAt: minToIso(c.endMin + tv),
          durationMin: tv,
          summary: ctx.travel.summary?.(c.theaterId, next.theaterId) ?? null,
        })
        totalTravel += tv
      }
      const margin = sameTheater ? M_IN : ctx.arrivalMarginMin
      const wait = next.startMin - (c.endMin + tv + margin)
      if (wait > 0) legs.push({ kind: 'wait', minutes: wait })
    }
  }

  // 3. destination 指定時は最後の劇場 → destination
  const last = cands[e.path[e.path.length - 1]]
  let endMin = last.endMin
  if (ctx.theaterToDestMin) {
    const td = ctx.theaterToDestMin.get(last.theaterId) ?? 0
    legs.push({
      kind: 'travel',
      fromTheaterId: last.theaterId,
      toTheaterId: null,
      departAt: minToIso(last.endMin),
      arriveAt: minToIso(last.endMin + td),
      durationMin: td,
      summary: null,
    })
    totalTravel += td
    endMin = last.endMin + td
  }

  return {
    label,
    stats: {
      movieCount: e.score.count,
      totalTravelMin: totalTravel, // dest 分を含む leg 合計（score.travel は dest を含まない。docs/12 §4）
      totalWaitMin: e.score.wait,
      endTime: minToIso(endMin),
    },
    legs,
  }
}
