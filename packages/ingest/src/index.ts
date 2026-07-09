import { newId } from '@cinema/shared'

export interface Env {
  DB: D1Database
  KV: KVNamespace
  SNAPSHOTS: R2Bucket
  INGEST_QUEUE: Queue
  APP_ENV: string
}

// P0 スケルトン。取込パイプライン（fetch→extract→validate→normalize→write）は P1、
// Cron ディスパッチ・移動時間行列は P1-6/P4-6、管理サイト(/admin) は P4 で実装する。
// 取得マナー（docs/08 §3: 5秒間隔・1劇場1日1回・UA 正直申告）は fetch 実装時に厳守。
export default {
  async fetch(_req, env): Promise<Response> {
    return Response.json({
      service: 'cinema-ingest',
      env: env.APP_ENV ?? 'local',
      requestId: newId('run'),
    })
  },
  async scheduled(_controller, _env): Promise<void> {
    // 劇場リストを Queues に投入する Cron ディスパッチは P1-6。
  },
  async queue(_batch, _env): Promise<void> {
    // 1劇場1ジョブの取込パイプラインは P1。
  },
} satisfies ExportedHandler<Env>
