import { newId } from '@cinema/shared'

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
