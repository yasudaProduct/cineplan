import type { LlmEnv } from './llm'

// ingest Worker の env。bindings（wrangler.toml）+ vars/secret。
// 秘密（GEMINI_API_KEY / SLACK_WEBHOOK_URL / ADMIN_TOKEN）は local=.dev.vars / st・prod=wrangler secret。
export interface Env extends LlmEnv {
  DB: D1Database
  KV: KVNamespace
  SNAPSHOTS: R2Bucket
  INGEST_QUEUE: Queue
  APP_ENV: string
  SLACK_WEBHOOK_URL?: string
  // POST /admin/ingest の保護用共有シークレット。APP_ENV!=='local' では必須（未設定は fail closed）。
  // docs/16 §3.6・docs/09 P4-0。
  ADMIN_TOKEN?: string
}
