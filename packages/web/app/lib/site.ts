// サイト共通の定数（P5-4）。
// 連絡先メールアドレスは**オーナーが決定して差し替える**（docs/16 §5.4）。
// null の間は各ページに「準備中」と表示し、mailto リンクは出さない
// （未決定のままプレースホルダ文字列を公開しないため）。
export const CONTACT_EMAIL: string | null = null

// ingest の User-Agent 表記（packages/ingest/src/worker/fetch.ts の USER_AGENT と一致させる。
// ドメインは P5-7 の確定時に ingest 側と同時に更新する）
export const BOT_USER_AGENT = 'CinemaHashigoBot/0.1 (+https://example.com/bot)'

// 事業者名等が必要になった場合もここに集約する（法務ページから参照）
export const SERVICE_NAME = 'cineplan'
