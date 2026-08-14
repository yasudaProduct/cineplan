// サイト共通の定数（P5-4）。
// 連絡先メールアドレスは**オーナーが決定して差し替える**（docs/guides/01 §5.4）。
// null の間は各ページに「準備中」と表示し、mailto リンクは出さない
// （未決定のままプレースホルダ文字列を公開しないため）。
export const CONTACT_EMAIL: string | null = null

// ingest の User-Agent 表記（packages/ingest/src/worker/fetch.ts の USER_AGENT および
// packages/api/src/lib/station-geo.ts と一致させる）。連絡先 URL は到達可能な /bot を指す
// （ADR-0021）。独自ドメイン取得時に3箇所を同時に更新する。
export const BOT_USER_AGENT =
  'CinemaHashigoBot/0.1 (+https://cinema-web-st.yuta-develop-ct.workers.dev/bot)'

// 事業者名等が必要になった場合もここに集約する（法務ページから参照）
export const SERVICE_NAME = 'cineplan'
