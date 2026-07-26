export interface Env {
  DB: D1Database
  KV: KVNamespace
  APP_ENV: string
  // 経路探索 API（ls8h Transit API。ADR-0014）。省略時は実 API。スタブ検証時のみ上書き。
  TRANSIT_API_BASE?: string
  // 共有 URL（{WEB_BASE_URL}/p/{planId}）の組み立て用（P5-1・docs/04 設計メモ10）。
  // api 自身のオリジンからは導出しない（api と web は別オリジン）。
  WEB_BASE_URL?: string
}
