import type { IngestRunStatus, IngestTrigger } from '@cinema/shared'
import { newId } from '@cinema/shared'

const nowIso = (): string => new Date().toISOString()

export interface CompleteRunInput {
  snapshotKey: string | null
  extractedCount: number
  writtenCount: number
  llmModel: string | null
  inTokens: number | null
  outTokens: number | null
  promptVersion: string | null
}

// IngestRun を起票（P1 手動取込は 'fetching' から開始。cron 経路は 'queued'→'fetching'）。
export async function createIngestRun(
  db: D1Database,
  input: {
    theaterId: string
    businessDate: string
    trigger: IngestTrigger
    status?: IngestRunStatus
  },
): Promise<string> {
  const runId = newId('run')
  await db
    .prepare(
      `INSERT INTO ingest_runs (id,theater_id,business_date,trigger,status,started_at)
       VALUES (?,?,?,?,?,?)`,
    )
    .bind(
      runId,
      input.theaterId,
      input.businessDate,
      input.trigger,
      input.status ?? 'fetching',
      nowIso(),
    )
    .run()
  return runId
}

export async function updateRunStatus(
  db: D1Database,
  runId: string,
  status: IngestRunStatus,
): Promise<void> {
  await db.prepare(`UPDATE ingest_runs SET status=? WHERE id=?`).bind(status, runId).run()
}

export async function completeRun(
  db: D1Database,
  runId: string,
  input: CompleteRunInput,
): Promise<void> {
  await db
    .prepare(
      `UPDATE ingest_runs
         SET status='succeeded', snapshot_key=?, extracted_count=?, written_count=?,
             llm_model=?, llm_in_tokens=?, llm_out_tokens=?, prompt_version=?, finished_at=?
       WHERE id=?`,
    )
    .bind(
      input.snapshotKey,
      input.extractedCount,
      input.writtenCount,
      input.llmModel,
      input.inTokens,
      input.outTokens,
      input.promptVersion,
      nowIso(),
      runId,
    )
    .run()
}

export type FailStatus = Extract<
  IngestRunStatus,
  'fetch_failed' | 'extraction_failed' | 'validation_failed'
>

export async function failRun(
  db: D1Database,
  runId: string,
  input: { status: FailStatus; errorMessage: string; snapshotKey?: string | null },
): Promise<void> {
  await db
    .prepare(
      `UPDATE ingest_runs
         SET status=?, error_message=?, snapshot_key=COALESCE(?, snapshot_key), finished_at=?
       WHERE id=?`,
    )
    .bind(input.status, input.errorMessage, input.snapshotKey ?? null, nowIso(), runId)
    .run()
}

// ---- 管理サイト用読取（P4-2/P4-4。docs/07 §2.2・§2.4）----

// D1 行そのまま（snake_case）。管理画面表示用。
export interface RunRow {
  id: string
  theater_id: string
  business_date: string
  trigger: string
  status: string
  snapshot_key: string | null
  extracted_count: number | null
  written_count: number | null
  error_message: string | null
  llm_model: string | null
  llm_in_tokens: number | null
  llm_out_tokens: number | null
  prompt_version: string | null
  started_at: string
  finished_at: string | null
}

export async function getRun(db: D1Database, runId: string): Promise<RunRow | null> {
  return await db.prepare(`SELECT * FROM ingest_runs WHERE id=?`).bind(runId).first<RunRow>()
}

export interface ListRunsFilter {
  theaterId?: string
  status?: string
  limit?: number
  offset?: number
}

export async function listRuns(db: D1Database, f: ListRunsFilter = {}): Promise<RunRow[]> {
  const conds: string[] = []
  const binds: unknown[] = []
  if (f.theaterId) {
    conds.push('theater_id = ?')
    binds.push(f.theaterId)
  }
  if (f.status) {
    conds.push('status = ?')
    binds.push(f.status)
  }
  const where = conds.length > 0 ? `WHERE ${conds.join(' AND ')}` : ''
  const limit = Math.min(f.limit ?? 50, 200)
  const offset = f.offset ?? 0
  const { results } = await db
    .prepare(`SELECT * FROM ingest_runs ${where} ORDER BY started_at DESC LIMIT ? OFFSET ?`)
    .bind(...binds, limit, offset)
    .all<RunRow>()
  return results
}

// 劇場ごとの直近 run（新しい順）。active 昇格判断の連続 succeeded 表示に使う（docs/06 §9）。
export async function recentRunsForTheater(
  db: D1Database,
  theaterId: string,
  n = 10,
): Promise<Pick<RunRow, 'id' | 'status' | 'trigger' | 'started_at'>[]> {
  const { results } = await db
    .prepare(
      `SELECT id, status, trigger, started_at FROM ingest_runs
        WHERE theater_id=? ORDER BY started_at DESC LIMIT ?`,
    )
    .bind(theaterId, n)
    .all<Pick<RunRow, 'id' | 'status' | 'trigger' | 'started_at'>>()
  return results
}

// 本日（JST）に先方サイトへアクセスした run 数（trigger=cron/manual。retry は R2 のみで数えない）。
// 手動取込ボタンの「1日1回」ガードに使う（docs/08 §3。2回目は人間の明示チェックが必要）。
export async function countTodaySiteFetches(
  db: D1Database,
  theaterId: string,
  todayJstStartIso: string,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS c FROM ingest_runs
        WHERE theater_id=? AND trigger IN ('cron','manual') AND started_at >= ?`,
    )
    .bind(theaterId, todayJstStartIso)
    .first<{ c: number }>()
  return row?.c ?? 0
}
