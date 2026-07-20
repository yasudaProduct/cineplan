import { Hono } from 'hono'
import { listTheaterRows, toApiTheater } from '../db/theaters'
import type { Env } from '../env'

// GET /v1/theaters（docs/04）。active 劇場のみ・上映情報は返さない。
export const theatersRoute = new Hono<{ Bindings: Env }>().get('/', async (c) => {
  const rows = await listTheaterRows(c.env.DB)
  c.header('Cache-Control', 'public, max-age=3600')
  return c.json({ theaters: rows.map(toApiTheater) })
})
