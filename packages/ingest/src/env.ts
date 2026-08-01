import type { BrowserWorker } from '@cloudflare/puppeteer'
import type { LlmEnv } from './llm'

// ingest Worker の env。bindings（wrangler.toml）+ vars/secret。
// 秘密（GEMINI_API_KEY / SLACK_WEBHOOK_URL / ADMIN_TOKEN）は local=.dev.vars / st・prod=wrangler secret。
export interface Env extends LlmEnv {
  DB: D1Database
  KV: KVNamespace
  SNAPSHOTS: R2Bucket
  INGEST_QUEUE: Queue
  // Browser Rendering（fetch_method=rendered の描画取得。P4-7）
  BROWSER: BrowserWorker
  APP_ENV: string
  SLACK_WEBHOOK_URL?: string
  // 経路探索 API（ls8h Transit API。ADR-0014）。省略時は実 API。スタブ検証時のみ上書き。
  TRANSIT_API_BASE?: string
  // POST /admin/ingest の保護用共有シークレット。APP_ENV!=='local' では必須（未設定は fail closed）。
  // docs/16 §3.6・docs/09 P4-0。
  ADMIN_TOKEN?: string
  // LLM コスト急増アラートの日次 in-tokens 閾値（P5-6・docs/06 §8）。
  // 未設定は既定 5,000,000（cost-alert.ts）。上書きは wrangler var で。
  COST_ALERT_DAILY_IN_TOKENS?: string
}
