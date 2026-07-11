import type { LlmEnv } from './llm'

// ingest Worker の env。bindings（wrangler.toml）+ vars/secret。
// 秘密（GEMINI_API_KEY / SLACK_WEBHOOK_URL）は local=.dev.vars / st・prod=wrangler secret。
export interface Env extends LlmEnv {
  DB: D1Database
  KV: KVNamespace
  SNAPSHOTS: R2Bucket
  INGEST_QUEUE: Queue
  APP_ENV: string
  SLACK_WEBHOOK_URL?: string
}
