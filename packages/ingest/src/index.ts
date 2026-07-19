import type { IngestTrigger } from '@cinema/shared'
import { Hono } from 'hono'
import { adminApp } from './admin'
import { buildTravelMatrix } from './cron/travel-matrix'
import { listActiveTheaters } from './db/theaters'
import type { Env } from './env'
import { logError, logInfo } from './log'
import { sendSlack } from './worker/notify'
import { FETCH_FAILED_NOTIFY_AT_ATTEMPT, ingestTheater } from './worker/pipeline'
import { reextractFromSnapshot } from './worker/reextract'

// Queue メッセージ形（fix/p4-manual-ingest-orphan・fix/reextract-orphan）:
// - 取込（cron投入・手動取込UI）: { theaterId, trigger }
// - 再抽出（R2再抽出UI。先方サイトへの再アクセスなし）: { reextractRunId }
export type IngestQueueMessage =
  | { theaterId: string; trigger: IngestTrigger }
  | { reextractRunId: string }

// TravelMatrix 週次再生成の cron パターン（wrangler.toml [env.prod.triggers] と一致させる。docs/14 §3.2）
const MATRIX_CRON = '0 18 * * 1'

// fetch_failed の指数バックオフ（初回5分後・以降倍々。docs/06 §7）。
const RETRY_BASE_DELAY_SECONDS = 300

export type { Env }

// 取込サービス + 管理サイト（/admin。P4-2〜P4-5・docs/07 §2）。
// 取得マナー（docs/08 §3）は fetch 実装と手動取込の1日1回ガードで厳守。
const app = new Hono<{ Bindings: Env }>()

app.onError((err, c) => {
  logError('http.error', err, { method: c.req.method, path: c.req.path })
  return c.text('internal error', 500)
})

app.get('/healthz', (c) =>
  c.json({ status: 'ok', service: 'cinema-ingest', env: c.env.APP_ENV ?? 'local' }),
)

// /admin 配下（UI + 手動取込 API）。エッジの Cloudflare Access（P4-1）+ adminGuard の多層防御。
app.route('/admin', adminApp)

app.get('/', (c) => c.text('cinema-ingest'))

export default {
  fetch: app.fetch,

  // Cron（prod のみ有効・docs/14 §3.2）。controller.cron で分岐:
  // - 毎日 21:00 UTC: active 劇場を Queue 投入（P1-6）
  // - 月曜 18:00 UTC: TravelMatrix 週次再生成（P4-6・ADR-0014）
  async scheduled(controller, env): Promise<void> {
    if (controller.cron === MATRIX_CRON) {
      const r = await buildTravelMatrix(env)
      await sendSlack(
        env.SLACK_WEBHOOK_URL,
        `🚃 TravelMatrix 再生成: ${r.theaters}劇場 ${r.pairs}ペア（更新${r.updated}/温存${r.carried}/欠損${r.missing}${r.skippedWrite ? '・全滅のため未書込' : ''}）`,
      )
      return
    }
    const theaters = await listActiveTheaters(env.DB)
    for (const t of theaters) {
      await env.INGEST_QUEUE.send({ theaterId: t.id, trigger: 'cron' })
    }
    logInfo('cron.dispatch.done', { theaters: theaters.length })
  },

  // Queue consumer: 1劇場1ジョブの取込パイプライン + R2再抽出。
  // 管理サイトの手動取込（trigger='manual'）・再抽出（reextractRunId）もこの経路を通る
  // （fix/p4-manual-ingest-orphan・fix/reextract-orphan）: ブラウザ接続に処理を同期させると、
  // rendered+LLM抽出の途中で接続が切れた際に Workers が実行をキャンセルし run が孤児化する
  // 不具合があったため（再抽出は「先方アクセスが無く短時間」という前提だったが、大きな
  // rendered ページでは抽出自体が数分かかり同じ問題が起きることが実機で判明。docs/06 §7）。
  // fetch_failed のみ Queues リトライ対象（再抽出は fetch を伴わないため対象外）。
  // それ以外の失敗（extraction_failed / validation_failed / 恒久的エラー）は ack して打ち切る
  // （再取得を伴う再試行をしないため）。
  async queue(batch, env): Promise<void> {
    for (const msg of batch.messages) {
      const body = msg.body as Partial<IngestQueueMessage>
      try {
        if ('reextractRunId' in body && body.reextractRunId) {
          logInfo('queue.reextract.start', {
            sourceRunId: body.reextractRunId,
            attempt: msg.attempts,
          })
          const r = await reextractFromSnapshot(env, body.reextractRunId)
          logInfo('queue.reextract.done', {
            sourceRunId: body.reextractRunId,
            runId: r.runId,
            status: r.status,
          })
          msg.ack()
          continue
        }
        if (!('theaterId' in body) || !body.theaterId) {
          logInfo('queue.invalid_message', { keys: Object.keys(body) })
          msg.ack()
          continue
        }
        logInfo('queue.ingest.start', {
          theaterId: body.theaterId,
          trigger: body.trigger ?? 'cron',
          attempt: msg.attempts,
        })
        const result = await ingestTheater(
          env,
          body.theaterId,
          body.trigger ?? 'cron',
          msg.attempts,
        )
        if (result.status === 'fetch_failed' && msg.attempts < FETCH_FAILED_NOTIFY_AT_ATTEMPT) {
          const delaySeconds = RETRY_BASE_DELAY_SECONDS * 2 ** (msg.attempts - 1) // 5分・10分…
          logInfo('queue.ingest.retry', {
            theaterId: body.theaterId,
            runId: result.runId,
            attempt: msg.attempts,
            delaySeconds,
          })
          msg.retry({ delaySeconds })
        } else {
          logInfo('queue.ingest.done', {
            theaterId: body.theaterId,
            runId: result.runId,
            status: result.status,
          })
          msg.ack()
        }
      } catch (e) {
        // TheaterNotFoundError / ComplianceGateError / SnapshotNotFoundError 等の
        // 恒久的失敗はリトライしない
        logError('queue.error', e, {
          theaterId: 'theaterId' in body ? body.theaterId : undefined,
          reextractRunId: 'reextractRunId' in body ? body.reextractRunId : undefined,
          attempt: msg.attempts,
        })
        msg.ack()
      }
    }
  },
} satisfies ExportedHandler<Env>
