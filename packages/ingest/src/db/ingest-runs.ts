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
