// データ保持 Cron（P5-5・docs/03 §4・docs/11 §7）。日次で期限切れデータを削除する。
// R2 スナップショット（90日）はバケットのライフサイクルルールで別途削除（ここでは扱わない）。

export interface RetentionResult {
  screenings: number
  reviews: number
  ingestRuns: number
  sharedPlans: number
}

// 削除順: 参照元 → 参照先（screenings / extraction_reviews → ingest_runs）。shared_plans は独立。
// D1 は FK を既定で強制し、batch は1トランザクション（違反すると全体 rollback）のため、
// ingest_runs は extraction_reviews から参照されていない行だけ消す（pending 長期残存ガード。
// 当該 run はレビュー解決 → 90日経過後の Cron で自然に消える）。
//
// 左辺の datetime() ラップは必須（docs/11 §7）: アプリが書く列は ISO 'T'+'Z' 形式・
// datetime('now') はスペース区切り形式で、生の文字列比較は 'T' > ' ' により同日内の
// 判定が最大1日遅れる。business_date は YYYY-MM-DD 同士なのでラップ不要。
export async function runRetention(db: D1Database): Promise<RetentionResult> {
  const [scr, rev, runs, plans] = await db.batch([
    db.prepare(`DELETE FROM screenings WHERE business_date < date('now','-30 days')`),
    db.prepare(
      `DELETE FROM extraction_reviews
        WHERE status <> 'pending' AND datetime(created_at) < datetime('now','-90 days')`,
    ),
    db.prepare(
      `DELETE FROM ingest_runs
        WHERE datetime(started_at) < datetime('now','-180 days')
          AND id NOT IN (SELECT ingest_run_id FROM extraction_reviews)`,
    ),
    db.prepare(`DELETE FROM shared_plans WHERE datetime(expires_at) < datetime('now')`),
  ])
  return {
    screenings: scr?.meta.changes ?? 0,
    reviews: rev?.meta.changes ?? 0,
    ingestRuns: runs?.meta.changes ?? 0,
    sharedPlans: plans?.meta.changes ?? 0,
  }
}
