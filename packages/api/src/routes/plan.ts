import { PlanRequest } from '@cinema/shared'
import { Hono } from 'hono'
import type { Env } from '../env'
import { ApiHttpError } from '../errors'
import { plan } from '../planner'

// POST /v1/plan（docs/04）。入力不正=400、未取込=422、案なしも 200 で infeasible。
export const planRoute = new Hono<{ Bindings: Env }>().post('/', async (c) => {
  let body: unknown
  try {
    body = await c.req.json()
  } catch {
    return c.json({ code: 'VALIDATION_ERROR', message: 'JSON ボディが必要です' }, 400)
  }
  const parsed = PlanRequest.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        code: 'VALIDATION_ERROR',
        message: '入力が不正です',
        details: { issues: parsed.error.issues },
      },
      400,
    )
  }
  try {
    return c.json(
      await plan(c.env.DB, c.env.KV, parsed.data, { transitApiBase: c.env.TRANSIT_API_BASE }),
    )
  } catch (e) {
    if (e instanceof ApiHttpError) {
      return c.json({ code: e.code, message: e.message }, e.status)
    }
    throw e
  }
})
