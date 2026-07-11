import { listActiveTheaters } from './db/theaters'
import type { Env } from './env'
import { ingestTheater } from './worker/pipeline'

export type { Env }

// 取込サービス + 管理サイト（P4）。取得マナー（docs/08 §3）を fetch 実装で厳守。
export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname === '/healthz') {
      return Response.json({ status: 'ok', service: 'cinema-ingest', env: env.APP_ENV ?? 'local' })
    }

    // 手動取込トリガー（P1-6/F-33）。prod は cron のみ。管理UIの Access 保護は P4。
    // POST /admin/ingest?theaterId=thr_xxx
    if (req.method === 'POST' && url.pathname === '/admin/ingest') {
      if (env.APP_ENV === 'prod') return new Response('forbidden (prod は cron)', { status: 403 })
      const theaterId = url.searchParams.get('theaterId')
      if (!theaterId) return Response.json({ error: 'theaterId required' }, { status: 400 })
      const result = await ingestTheater(env, theaterId, 'manual')
      return Response.json(result)
    }

    return new Response('cinema-ingest', { status: 200 })
  },

  // Cron（prod のみ有効・docs/14）: active 劇場を Queue 投入（P1-6）。
  async scheduled(_controller, env): Promise<void> {
    const theaters = await listActiveTheaters(env.DB)
    for (const t of theaters) {
      await env.INGEST_QUEUE.send({ theaterId: t.id })
    }
  },

  // Queue consumer: 1劇場1ジョブの取込パイプライン。失敗は Queues 標準リトライ（docs/06 §7）。
  async queue(batch, env): Promise<void> {
    for (const msg of batch.messages) {
      const body = msg.body as { theaterId?: string }
      if (!body.theaterId) {
        msg.ack()
        continue
      }
      try {
        await ingestTheater(env, body.theaterId, 'cron')
        msg.ack()
      } catch (e) {
        console.error('ingest queue error', e)
        msg.retry()
      }
    }
  },
} satisfies ExportedHandler<Env>
