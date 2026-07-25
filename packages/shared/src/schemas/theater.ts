import { z } from 'zod'

// ステータス・属性 enum（docs/02 用語集の正規定義）
export const TheaterStatus = z.enum(['active', 'paused', 'retired'])
export type TheaterStatus = z.infer<typeof TheaterStatus>

export const FetchMethod = z.enum(['static', 'rendered'])
export type FetchMethod = z.infer<typeof FetchMethod>

export const RobotsStatus = z.enum(['allowed', 'disallowed', 'unknown'])
export type RobotsStatus = z.infer<typeof RobotsStatus>

// 複数日取得（ADR-0019・docs/06 §2.2）。1ページに1日分しか掲載しないサイト向け。
// single       = 現行（1取込 = 1ページロード）
// tabs         = 日付タブを順にクリック（Browser Rendering 必須）
// url_template = schedule_url の {date} を置換して日付ごとに静的取得
export const FetchDayMode = z.enum(['single', 'tabs', 'url_template'])
export type FetchDayMode = z.infer<typeof FetchDayMode>

// 1セッションで取得するページ数の絶対上限（docs/08 §0・§3）。
// DB の CHECK（migration 0005）・zod・fetch 実装の三箇所で守る。
// 引き上げには docs/08 §6 の変更手続き（ADR + ポリシー改定）が必要。
export const MAX_FETCH_DAYS = 10

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
