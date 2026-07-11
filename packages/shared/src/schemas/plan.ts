import { z } from 'zod'

// "HH:mm"（利用可能時間帯・JST。24時超え表記は不可。時00〜23・分00〜59。docs/04）
export const HHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)

// origin / destination（駅名 or 緯度経度）。docs/04 components.schemas.Location
export const Location = z.object({
  type: z.enum(['station', 'geo']),
  value: z.union([z.string(), z.object({ lat: z.number(), lng: z.number() })]),
})
export type Location = z.infer<typeof Location>

// POST /v1/plan リクエスト（docs/04 PlanRequest）
export const PlanRequest = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  timeWindow: z.object({ start: HHMM, end: HHMM }),
  origin: Location,
  destination: Location.nullable().optional(),
  mustMovieIds: z.array(z.string()).max(3).default([]),
  wishMovieIds: z.array(z.string()).default([]),
  arrivalMarginMin: z.number().int().min(5).max(60).default(15),
  maxResults: z.number().int().min(1).max(5).default(3),
})
export type PlanRequest = z.infer<typeof PlanRequest>

// 代替案ラベル（docs/05 §6）
export const PlanLabel = z.enum(['most_movies', 'less_travel', 'relaxed', 'must_priority', 'alt'])
export type PlanLabel = z.infer<typeof PlanLabel>

export const ScreeningLeg = z.object({
  kind: z.literal('screening'),
  theaterId: z.string(),
  theaterName: z.string(),
  movieId: z.string(),
  movieTitle: z.string(),
  format: z.string().nullable().optional(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  officialUrl: z.string().url(),
})
export type ScreeningLeg = z.infer<typeof ScreeningLeg>

export const TravelLeg = z.object({
  kind: z.literal('travel'),
  fromTheaterId: z.string().nullable().optional(), // null = origin から
  toTheaterId: z.string().nullable().optional(), // null = destination へ
  departAt: z.string().datetime(),
  arriveAt: z.string().datetime(),
  durationMin: z.number().int(),
  summary: z.string().nullable().optional(),
})
export type TravelLeg = z.infer<typeof TravelLeg>

export const WaitLeg = z.object({
  kind: z.literal('wait'),
  minutes: z.number().int(),
})
export type WaitLeg = z.infer<typeof WaitLeg>

// Leg 判別共用体（discriminator: kind）
export const Leg = z.discriminatedUnion('kind', [ScreeningLeg, TravelLeg, WaitLeg])
export type Leg = z.infer<typeof Leg>

export const PlanStats = z.object({
  movieCount: z.number().int(),
  totalTravelMin: z.number().int(),
  totalWaitMin: z.number().int(),
  endTime: z.string().datetime(),
})
export type PlanStats = z.infer<typeof PlanStats>

// 1日のはしご計画（docs/04 Plan）。API レスポンスの単位。
export const Plan = z.object({
  label: PlanLabel,
  stats: PlanStats,
  legs: z.array(Leg),
})
export type Plan = z.infer<typeof Plan>

export const InfeasibleReason = z.enum([
  'no_screenings',
  'must_movie_unreachable',
  'time_window_too_narrow',
])
export type InfeasibleReason = z.infer<typeof InfeasibleReason>

export const RelaxSuggestion = z.enum([
  'widen_time_window',
  'drop_must_movie',
  'increase_margin_tolerance',
  'remove_destination',
])
export type RelaxSuggestion = z.infer<typeof RelaxSuggestion>

// POST /v1/plan レスポンス（案なしも 200 で infeasible を返す。docs/04 設計メモ1）
export const PlanResponse = z.object({
  plans: z.array(Plan),
  infeasible: z
    .object({
      reason: InfeasibleReason,
      relaxSuggestions: z.array(RelaxSuggestion),
    })
    .nullable()
    .optional(),
})
export type PlanResponse = z.infer<typeof PlanResponse>

// DP の比較キー（docs/12 §2）。utils/compare.ts の compareScore が対象。
export const Score = z.object({
  count: z.number().int(),
  travel: z.number().int(),
  wait: z.number().int(),
  endMin: z.number().int(),
  lastId: z.string(),
})
export type Score = z.infer<typeof Score>

// エラー本体（docs/04 ApiError）
export const ApiError = z.object({
  code: z.string(),
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
})
export type ApiError = z.infer<typeof ApiError>
