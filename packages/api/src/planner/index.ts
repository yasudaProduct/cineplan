import type { PlanRequest, PlanResponse } from '@cinema/shared'
import { normalizeStart } from '@cinema/shared'
import { isDataReady } from '../db/ready'
import { loadCandidates } from '../db/screenings'
import { listTheaterRows, toTheaterGeo } from '../db/theaters'
import { ApiHttpError } from '../errors'
import { buildPlan } from './build'
import { runDp } from './dp'
import { selectPlans } from './kbest'
import { createTravelResolver, resolveEndpointMinutes, type TravelMatrixData } from './travel'
import type { Candidate, PlanContext } from './types'

// /plan エントリ（docs/12 §8）。infeasible 判定順は docs/05 §7 準拠。

const isoToMin = (iso: string): number => Math.floor(Date.parse(iso) / 60_000)

export async function plan(
  db: D1Database,
  kv: KVNamespace,
  req: PlanRequest,
): Promise<PlanResponse> {
  // 1. データ未取込 → 422（docs/11 §5.4）
  if (!(await isDataReady(db, req.date))) {
    throw new ApiHttpError(422, 'DATA_NOT_READY', '対象日の上映データが未取込です')
  }

  const windowStartMin = isoToMin(normalizeStart(req.date, req.timeWindow.start))
  const windowEndMin = isoToMin(normalizeStart(req.date, req.timeWindow.end))
  if (windowEndMin <= windowStartMin) {
    throw new ApiHttpError(
      400,
      'VALIDATION_ERROR',
      'timeWindow.end は start より後の時刻にしてください',
    )
  }

  const theaterRows = await listTheaterRows(db)
  const theaters = theaterRows.map(toTheaterGeo)

  // origin/destination 解決（P2 暫定: station=最寄駅一致 / geo=フォールバック推定。本解決は P4-6）
  const originToTheaterMin = resolveEndpointMinutes(req.origin, theaters)
  if (originToTheaterMin.size === 0) {
    throw new ApiHttpError(
      400,
      'VALIDATION_ERROR',
      'origin を解決できません（現在は対応劇場の最寄駅名または緯度経度を指定してください)',
    )
  }
  let theaterToDestMin: Map<string, number> | null = null
  if (req.destination) {
    theaterToDestMin = resolveEndpointMinutes(req.destination, theaters)
    if (theaterToDestMin.size === 0) {
      throw new ApiHttpError(400, 'VALIDATION_ERROR', 'destination を解決できません')
    }
  }

  // 候補ロード + フィルタ（docs/05 §2）
  const rows = await loadCandidates(db, req.date)
  // 対象日の上映0件（取込済みだが上映なし）はフィルタ前に判定する（docs/05 §7・docs/12 §8）。
  // フィルタ後に0件になるケースは「時間帯を広げれば観られる」= time_window_too_narrow 側。
  if (rows.length === 0) {
    return { plans: [], infeasible: { reason: 'no_screenings', relaxSuggestions: [] } }
  }
  const wishSet = new Set([...req.wishMovieIds, ...req.mustMovieIds])
  const cands: Candidate[] = rows
    .map((r) => ({
      screeningId: r.screeningId,
      theaterId: r.theaterId,
      movieId: r.movieId,
      startMin: isoToMin(r.startAt),
      endMin: isoToMin(r.endAt),
      format: r.format,
      detailUrl: r.detailUrl,
      movieTitle: r.movieTitle,
      theaterName: r.theaterName,
      officialUrl: r.officialUrl,
    }))
    .filter((c) => (req.wishMovieIds.length > 0 ? wishSet.has(c.movieId) : true))
    .filter((c) => c.startMin >= windowStartMin && c.endMin <= windowEndMin)
    .sort((a, b) => a.startMin - b.startMin || (a.screeningId < b.screeningId ? -1 : 1))

  const matrix = await kv.get<TravelMatrixData>('travel-matrix:v1', 'json')

  return planFromCandidates(
    {
      cands,
      mustMovieIds: req.mustMovieIds,
      arrivalMarginMin: req.arrivalMarginMin,
      windowStartMin,
      windowEndMin,
      travel: createTravelResolver(theaters, matrix),
      originToTheaterMin,
      theaterToDestMin,
    },
    req.maxResults,
  )
}

// 純粋部（D1/KV 非依存）。infeasible 分岐のテストはここを対象にする。
// ※ no_screenings（対象日の上映0件）はフィルタ前の件数で plan() 側が判定する。
//   ここに cands が空で渡ってきた場合は「フィルタで全滅」= 時間帯/must 側の分岐に落ちる。
export function planFromCandidates(ctx: PlanContext, maxResults: number): PlanResponse {
  // 3. must 作品が候補に存在しない
  if (ctx.mustMovieIds.some((id) => !ctx.cands.some((c) => c.movieId === id))) {
    return {
      plans: [],
      infeasible: {
        reason: 'must_movie_unreachable',
        relaxSuggestions: ['drop_must_movie', 'widen_time_window'],
      },
    }
  }

  const solutions = runDp(ctx)
  const labeled = selectPlans(solutions, {
    maxResults,
    cands: ctx.cands,
    mustMovieIds: ctx.mustMovieIds,
  })

  // 4. must はあるが経路に組み込めない / 5. 1本も観られない
  if (labeled.length === 0) {
    if (ctx.mustMovieIds.length > 0) {
      return {
        plans: [],
        infeasible: {
          reason: 'must_movie_unreachable',
          relaxSuggestions: ['drop_must_movie', 'widen_time_window', 'increase_margin_tolerance'],
        },
      }
    }
    return {
      plans: [],
      infeasible: {
        reason: 'time_window_too_narrow',
        relaxSuggestions: ['widen_time_window', 'remove_destination'],
      },
    }
  }

  return { plans: labeled.map((lp) => buildPlan(lp.label, lp.entry, ctx)) }
}
