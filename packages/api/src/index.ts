import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './env'
import { rateLimit } from './middleware/rate-limit'
import { moviesRoute } from './routes/movies'
import { planRoute } from './routes/plan'
import { plansRoute } from './routes/plans'
import { theatersRoute } from './routes/theaters'

export type { Env }

// コア API（docs/04）。読取専用（書込は ingest。ADR-0007）。
// 劇場×日付の上映一覧を返すエンドポイントは作らない（原則1・docs/08）。
const app = new Hono<{ Bindings: Env }>()

app.onError((err, c) => {
  console.error('api error', err)
  return c.json({ code: 'INTERNAL', message: 'internal error' }, 500)
})

app.get('/healthz', (c) => c.json({ status: 'ok', env: c.env.APP_ENV ?? 'local' }))

// CORS は rateLimit より前（preflight をレート消費させない）。
// MVP は認証なし公開 API のため全許可（docs/04 設計メモ6。制限導入時は許可リストへ）。
app.use('/v1/*', cors())
app.use('/v1/*', rateLimit(60))
app.route('/v1/theaters', theatersRoute)
app.route('/v1/movies', moviesRoute)
app.route('/v1/plan', planRoute)
app.route('/v1/plans', plansRoute) // 共有プラン（P5-1・F-12/F-13）

export default app
