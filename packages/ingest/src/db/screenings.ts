import type { NormalizedScreening } from '@cinema/shared'
import { newId } from '@cinema/shared'

// 同一 (theater_id, business_date) を DELETE→INSERT で置換（洗い替え・docs/11 §4.1）。
// batch でアトミック。通常取込・レビュー承認の両方から呼ぶ（反映ロジックを二重実装しない）。
export async function replaceScreenings(
  db: D1Database,
  theaterId: string,
  businessDate: string,
  runId: string,
  rows: NormalizedScreening[],
): Promise<number> {
  const stmts: D1PreparedStatement[] = [
    db
      .prepare(`DELETE FROM screenings WHERE theater_id = ? AND business_date = ?`)
      .bind(theaterId, businessDate),
  ]
  for (const r of rows) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO screenings
             (id, theater_id, movie_id, business_date, start_at, end_at,
              end_at_source, format, detail_url, ingest_run_id)
           VALUES (?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          newId('scr'),
          theaterId,
          r.movieId,
          businessDate,
          r.startAt,
          r.endAt,
          r.endAtSource,
          r.format ?? null,
          r.detailUrl ?? null,
          runId,
        ),
    )
  }
  await db.batch(stmts)
  return rows.length
}

// businessDate 別にグルーピングして洗い替え（月間画像で複数日を含む場合。ADR-0012）。
export async function replaceScreeningsByDate(
  db: D1Database,
  theaterId: string,
  runId: string,
  rows: NormalizedScreening[],
): Promise<number> {
  const byDate = new Map<string, NormalizedScreening[]>()
  for (const r of rows) {
    const list = byDate.get(r.businessDate)
    if (list) list.push(r)
    else byDate.set(r.businessDate, [r])
  }
  let total = 0
  for (const [date, list] of byDate) {
    total += await replaceScreenings(db, theaterId, date, runId, list)
  }
  return total
}
