export interface Env {
  DB: D1Database
  KV: KVNamespace
  APP_ENV: string
  // 経路探索 API（ls8h Transit API。ADR-0014）。省略時は実 API。スタブ検証時のみ上書き。
  TRANSIT_API_BASE?: string
}
