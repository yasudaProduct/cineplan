import { Hono } from 'hono'
import { listMoviesByDate } from '../db/movies'
import type { Env } from '../env'

// GET /v1/movies?date=（docs/spec/04）。作品の存在のみ。上映時刻は返さない（原則1）。
export const moviesRoute = new Hono<{ Bindings: Env }>().get('/', async (c) => {
  const date = c.req.query('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return c.json({ code: 'VALIDATION_ERROR', message: 'date (YYYY-MM-DD) が必要です' }, 400)
  }
  const movies = await listMoviesByDate(c.env.DB, date)
  c.header('Cache-Control', 'public, max-age=600')
  return c.json({ movies })
})
