// データ未取込の判定（docs/11 §5.4）。
// 月間画像の vision 取込（ADR-0012）は 1 回で複数 businessDate を書き込むため、
// 「対象日の screenings が存在する or 対象日の succeeded run が存在する」を ready とする。
export async function isDataReady(db: D1Database, businessDate: string): Promise<boolean> {
  const scr = await db
    .prepare(`SELECT 1 FROM screenings WHERE business_date = ?1 LIMIT 1`)
    .bind(businessDate)
    .first()
  if (scr) return true
  const run = await db
    .prepare(`SELECT 1 FROM ingest_runs WHERE business_date = ?1 AND status = 'succeeded' LIMIT 1`)
    .bind(businessDate)
    .first()
  return run !== null
}
