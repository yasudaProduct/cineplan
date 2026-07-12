import { ExtractionResult, newId } from '@cinema/shared'
import { normalizeResolveWrite } from '../worker/write'

// 検証NG（validation_failed）時にレビューキューへ登録（docs/03 §3.5 / docs/06 §5）。
// payloadJson は抽出結果全体。承認時にこれを通常の書込パスで screenings へ反映する。
export async function createReview(
  db: D1Database,
  input: { runId: string; reason: string; payloadJson: string },
): Promise<string> {
  const id = newId('rev')
  await db
    .prepare(
      `INSERT INTO extraction_reviews (id, ingest_run_id, status, reason, payload_json)
       VALUES (?,?,'pending',?,?)`,
    )
    .bind(id, input.runId, input.reason, input.payloadJson)
    .run()
  return id
}

// V2 件数検証の履歴平均（過去 succeeded の written_count 平均。履歴3件未満は undefined）。
export async function recentAvgCount(
  db: D1Database,
  theaterId: string,
): Promise<number | undefined> {
  const { results } = await db
    .prepare(
      `SELECT written_count AS c FROM ingest_runs
        WHERE theater_id=? AND status='succeeded' AND written_count IS NOT NULL
        ORDER BY started_at DESC LIMIT 7`,
    )
    .bind(theaterId)
    .all<{ c: number }>()
  if (results.length < 3) return undefined
  const sum = results.reduce((a, r) => a + r.c, 0)
  return sum / results.length
}

// ---- レビューキュー（P4-5。docs/07 §2.5・docs/11 §6）----

const nowIso = (): string => new Date().toISOString()

export interface ReviewListItem {
  id: string
  ingest_run_id: string
  status: string
  reason: string
  review_note: string | null
  reviewed_at: string | null
  created_at: string
  theater_id: string
  theater_name: string
  business_date: string
}

export async function listReviews(
  db: D1Database,
  filter: 'pending' | 'all' = 'pending',
): Promise<ReviewListItem[]> {
  const where = filter === 'pending' ? `WHERE v.status='pending'` : ''
  const { results } = await db
    .prepare(
      `SELECT v.id, v.ingest_run_id, v.status, v.reason, v.review_note, v.reviewed_at,
              v.created_at, r.theater_id, t.name AS theater_name, r.business_date
         FROM extraction_reviews v
         JOIN ingest_runs r ON r.id = v.ingest_run_id
         JOIN theaters t ON t.id = r.theater_id
        ${where}
        ORDER BY v.created_at DESC LIMIT 100`,
    )
    .all<ReviewListItem>()
  return results
}

export interface ReviewDetail extends ReviewListItem {
  payload_json: string
  snapshot_key: string | null
}

export async function getReview(db: D1Database, id: string): Promise<ReviewDetail | null> {
  return await db
    .prepare(
      `SELECT v.id, v.ingest_run_id, v.status, v.reason, v.review_note, v.reviewed_at,
              v.created_at, v.payload_json, r.theater_id, t.name AS theater_name,
              r.business_date, r.snapshot_key
         FROM extraction_reviews v
         JOIN ingest_runs r ON r.id = v.ingest_run_id
         JOIN theaters t ON t.id = r.theater_id
        WHERE v.id = ?`,
    )
    .bind(id)
    .first<ReviewDetail>()
}

// 破棄（rejected）。理由メモ必須（docs/07 §2.5。必須検証は route 側）。
export async function rejectReview(db: D1Database, id: string, note: string): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE extraction_reviews SET status='rejected', review_note=?, reviewed_at=?
        WHERE id=? AND status='pending'`,
    )
    .bind(note, nowIso(), id)
    .run()
  return (res.meta.changes ?? 0) > 0
}

export class ReviewNotPendingError extends Error {
  constructor(id: string) {
    super(`review ${id} は存在しないか pending ではありません`)
    this.name = 'ReviewNotPendingError'
  }
}

// 承認（approved）: payload を通常書込パス（normalizeResolveWrite = pipeline と同一関数）で
// D1 に反映し、run を succeeded に更新する（docs/11 §6・docs/09 P4-5）。
// coverageFloor は payload.businessDate（そのデータの取込日）。承認が数日後でも、抽出が
// カバーしない日を洗い替え範囲に入れないため today は使わない。
export async function approveReview(
  db: D1Database,
  reviewId: string,
  note?: string,
): Promise<{ written: number; runId: string }> {
  const rev = await db
    .prepare(
      `SELECT v.ingest_run_id, v.payload_json, r.theater_id
         FROM extraction_reviews v JOIN ingest_runs r ON r.id = v.ingest_run_id
        WHERE v.id=? AND v.status='pending'`,
    )
    .bind(reviewId)
    .first<{ ingest_run_id: string; payload_json: string; theater_id: string }>()
  if (!rev) throw new ReviewNotPendingError(reviewId)

  const payload = ExtractionResult.parse(JSON.parse(rev.payload_json))
  const written = await normalizeResolveWrite(
    db,
    rev.theater_id,
    rev.ingest_run_id,
    payload,
    payload.businessDate,
  )

  const now = nowIso()
  await db.batch([
    db
      .prepare(
        `UPDATE extraction_reviews SET status='approved', review_note=?, reviewed_at=? WHERE id=?`,
      )
      .bind(note ?? null, now, reviewId),
    db
      .prepare(
        `UPDATE ingest_runs SET status='succeeded', written_count=?, error_message=NULL, finished_at=? WHERE id=?`,
      )
      .bind(written, now, rev.ingest_run_id),
  ])
  return { written, runId: rev.ingest_run_id }
}
