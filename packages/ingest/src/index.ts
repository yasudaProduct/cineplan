import { isAdminAuthorized } from './admin-auth'
import { listActiveTheaters } from './db/theaters'
import type { Env } from './env'
import { ComplianceGateError, TheaterNotFoundError } from './worker/errors'
import { FETCH_FAILED_NOTIFY_AT_ATTEMPT, ingestTheater } from './worker/pipeline'

// fetch_failed の指数バックオフ（初回5分後・以降倍々。docs/06 §7）。
const RETRY_BASE_DELAY_SECONDS = 300

export type { Env }

// 取込サービス + 管理サイト（P4）。取得マナー（docs/08 §3）を fetch 実装で厳守。
export default {
  async fetch(req, env): Promise<Response> {
    const url = new URL(req.url)

    if (url.pathname === '/healthz') {
      return Response.json({ status: 'ok', service: 'cinema-ingest', env: env.APP_ENV ?? 'local' })
    }

    // 手動取込トリガー（P1-6/F-33）。prod は cron のみ。
    // Access（P4-1）投入前は ADMIN_TOKEN が唯一の防御のため local 以外は必須・未設定は fail closed。
    // docs/09 P4-0・docs/16 §3.6。
    // POST /admin/ingest?theaterId=thr_xxx
    if (req.method === 'POST' && url.pathname === '/admin/ingest') {
      if (env.APP_ENV === 'prod') return new Response('forbidden (prod は cron)', { status: 403 })
      if (!isAdminAuthorized(env, req.headers.get('x-admin-token'))) {
        return new Response('unauthorized', { status: 401 })
      }
      const theaterId = url.searchParams.get('theaterId')
      if (!theaterId) return Response.json({ error: 'theaterId required' }, { status: 400 })
      try {
        const result = await ingestTheater(env, theaterId, 'manual')
        return Response.json(result)
      } catch (e) {
        if (e instanceof TheaterNotFoundError)
          return Response.json({ error: e.message }, { status: 404 })
        if (e instanceof ComplianceGateError)
          return Response.json({ error: e.message }, { status: 403 })
        throw e
      }
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

  // Queue consumer: 1劇場1ジョブの取込パイプライン。
  // fetch_failed のみ Queues リトライ対象（docs/06 §7）。それ以外の失敗（extraction_failed /
  // validation_failed / 恒久的エラー）は ack して打ち切る（再取得を伴う再試行をしないため）。
  async queue(batch, env): Promise<void> {
    for (const msg of batch.messages) {
      const body = msg.body as { theaterId?: string }
      if (!body.theaterId) {
        msg.ack()
        continue
      }
      try {
        const result = await ingestTheater(env, body.theaterId, 'cron', msg.attempts)
        if (result.status === 'fetch_failed' && msg.attempts < FETCH_FAILED_NOTIFY_AT_ATTEMPT) {
          const delaySeconds = RETRY_BASE_DELAY_SECONDS * 2 ** (msg.attempts - 1) // 5分・10分…
          msg.retry({ delaySeconds })
        } else {
          msg.ack()
        }
      } catch (e) {
        // TheaterNotFoundError / ComplianceGateError 等の恒久的失敗はリトライしない
        console.error('ingest queue error', e)
        msg.ack()
      }
    }
  },
} satisfies ExportedHandler<Env>
