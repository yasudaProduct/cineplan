import { Hono } from 'hono'
import type { Env } from './env'
import { rateLimit } from './middleware/rate-limit'
import { moviesRoute } from './routes/movies'
import { planRoute } from './routes/plan'
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

app.use('/v1/*', rateLimit(60))
app.route('/v1/theaters', theatersRoute)
app.route('/v1/movies', moviesRoute)
app.route('/v1/plan', planRoute)
// /v1/plans（共有）は P5-1 で追加

export default app
