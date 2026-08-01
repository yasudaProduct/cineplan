// 構造化ログ（Workers Logs。feat/ingest-observability・docs/spec/11 §3.2・docs/guides/01 §6）。
// console.log/error にオブジェクトを渡すと Workers Logs がフィールド単位でインデックスし、
// ダッシュボードで event / runId / theaterId 等により検索できる。イベント台帳は README.md。
//
// 載せてはいけないもの（ガードレール）:
// - シークレット・API キー・Access JWT
// - HTML / プロンプト / LLM 生出力の本文（サイズのみ。本文は R2 と reviews.payload_json が正）
// - 500文字を超えるエラー断片（D1 error_message と同じ上限慣習）

type LogFields = Record<string, unknown>

const MAX_ERROR_CHARS = 500

// unknown なエラーをログ用フィールドに変換（name + 500字までの message）。
export function errorFields(e: unknown): { name: string; message: string } {
  if (e instanceof Error) {
    return { name: e.name, message: e.message.slice(0, MAX_ERROR_CHARS) }
  }
  return { name: 'unknown', message: String(e).slice(0, MAX_ERROR_CHARS) }
}

export function logInfo(event: string, fields: LogFields = {}): void {
  console.log({ event, ...fields })
}

export function logError(event: string, e: unknown, fields: LogFields = {}): void {
  console.error({ event, ...fields, error: errorFields(e) })
}
