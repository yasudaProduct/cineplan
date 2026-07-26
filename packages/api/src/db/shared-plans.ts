// 共有プラン（P5-1。F-12/F-13・docs/03 §3.6・docs/11）。
// plan_json は Plan（API レスポンス形式）のスナップショット。再計算しない（F-13）。

export interface SharedPlanRow {
  id: string
  plan_json: string
  expires_at: string // UTC ISO（アプリ側で採番時に付与。docs/11 §3）
}

export async function insertSharedPlan(db: D1Database, row: SharedPlanRow): Promise<void> {
  await db
    .prepare(`INSERT INTO shared_plans (id, plan_json, expires_at) VALUES (?, ?, ?)`)
    .bind(row.id, row.plan_json, row.expires_at)
    .run()
}

// 期限判定は呼び出し側（routes）で行う。SQL の datetime('now') はスペース区切り形式で
// ISO の 'T' と文字列比較互換がないため、SQL 内比較を避けて JS で比較する（docs/11 §3）。
export async function getSharedPlan(db: D1Database, id: string): Promise<SharedPlanRow | null> {
  const row = await db
    .prepare(`SELECT id, plan_json, expires_at FROM shared_plans WHERE id = ?`)
    .bind(id)
    .first<SharedPlanRow>()
  return row ?? null
}
