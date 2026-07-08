import { Hono } from 'hono'

export interface Env {
  DB: D1Database
  KV: KVNamespace
  APP_ENV: string
}

// P0 スケルトン。/v1/theaters・/v1/movies・/v1/plan は P2、/v1/plans は P5 で実装する。
// 追加時も型は @cinema/shared から取り、劇場×日付の上映一覧 API は作らない（原則1）。
const app = new Hono<{ Bindings: Env }>()

app.get('/healthz', (c) => c.json({ status: 'ok', env: c.env.APP_ENV ?? 'local' }))

export default app
