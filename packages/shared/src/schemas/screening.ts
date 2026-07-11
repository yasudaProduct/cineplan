import { z } from 'zod'

// 中核エンティティ Screening（docs/03 §3.3）。公開 API では露出しない（原則1）。
// 内部（取込書込・planner ロード）の型の単一の真実。
export const Screening = z.object({
  id: z.string(),
  theaterId: z.string(),
  movieId: z.string(),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  endAtSource: z.enum(['site', 'estimated']),
  format: z.string().nullable(),
  screenName: z.string(), // スクリーン名（単一館は ''）。migration 0003
  detailUrl: z.string().nullable(),
})
export type Screening = z.infer<typeof Screening>

// planner 用の候補（docs/11 §5.1 の JOIN 結果）。build 層で ScreeningLeg に変換する。
export const CandidateScreening = z.object({
  screeningId: z.string(),
  theaterId: z.string(),
  movieId: z.string(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  format: z.string().nullable(),
  detailUrl: z.string().nullable(),
  movieTitle: z.string(),
  theaterName: z.string(),
  officialUrl: z.string(),
})
export type CandidateScreening = z.infer<typeof CandidateScreening>
