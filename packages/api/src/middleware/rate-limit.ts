import type { MiddlewareHandler } from 'hono'

// IP ベースの簡易レート制限（docs/04: 60 req/min）。
// isolate 内メモリのため厳密ではない（isolate 再作成・複数 isolate で緩む）。
// MVP の乱用抑止としては十分。厳密化が必要になったら Durable Objects / KV で置換。
const buckets = new Map<string, { count: number; windowStart: number }>()
const WINDOW_MS = 60_000

export function rateLimit(limit = 60): MiddlewareHandler {
  return async (c, next) => {
    const ip = c.req.header('cf-connecting-ip') ?? c.req.header('x-forwarded-for') ?? 'local'
    const now = Date.now()
    const b = buckets.get(ip)
    if (!b || now - b.windowStart >= WINDOW_MS) {
      buckets.set(ip, { count: 1, windowStart: now })
    } else {
      b.count++
      if (b.count > limit) {
        return c.json({ code: 'RATE_LIMITED', message: 'リクエストが多すぎます' }, 429)
      }
    }
    await next()
  }
}
