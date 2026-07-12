// データ未取込の判定（docs/11 §5.4）。
// 月間画像の vision 取込（ADR-0012）は 1 回で複数 businessDate を書き込むため、
// 「対象日の screenings が存在する or 対象日の succeeded run が存在する」を ready とする。
// いずれも active 劇場に限定する: planner の候補ロード・origin 解決は active のみ対象のため、
// ready 判定だけが paused 劇場のデータを拾うと「ready なのに active 0 件で origin 解決不能の
// 400」になる（採用プロセス中の paused 劇場を手動取込した ST で検出。P4-0）。active 限定なら
// そのケースは 422 DATA_NOT_READY で明快に返る。
export async function isDataReady(db: D1Database, businessDate: string): Promise<boolean> {
  const scr = await db
    .prepare(
      `SELECT 1 FROM screenings s
         JOIN theaters t ON t.id = s.theater_id
        WHERE s.business_date = ?1 AND t.status = 'active' LIMIT 1`,
    )
    .bind(businessDate)
    .first()
  if (scr) return true
  const run = await db
    .prepare(
      `SELECT 1 FROM ingest_runs r
         JOIN theaters t ON t.id = r.theater_id
        WHERE r.business_date = ?1 AND r.status = 'succeeded' AND t.status = 'active' LIMIT 1`,
    )
    .bind(businessDate)
    .first()
  return run !== null
}
