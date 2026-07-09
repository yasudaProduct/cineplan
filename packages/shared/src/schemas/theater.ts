import { z } from 'zod'

// ステータス・属性 enum（docs/02 用語集の正規定義）
export const TheaterStatus = z.enum(['active', 'paused', 'retired'])
export type TheaterStatus = z.infer<typeof TheaterStatus>

export const FetchMethod = z.enum(['static', 'rendered'])
export type FetchMethod = z.infer<typeof FetchMethod>

export const RobotsStatus = z.enum(['allowed', 'disallowed', 'unknown'])
export type RobotsStatus = z.infer<typeof RobotsStatus>

// 公開 API レスポンスの Theater（docs/04 components.schemas.Theater）。
// 上映情報は一切含めない（原則1: 内部利用限定）。
export const Theater = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().optional(),
  lat: z.number(),
  lng: z.number(),
  officialUrl: z.string().url(),
})
export type Theater = z.infer<typeof Theater>
