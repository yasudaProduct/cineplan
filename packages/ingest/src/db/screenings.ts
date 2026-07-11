import type { NormalizedScreening } from '@cinema/shared'
import { newId } from '@cinema/shared'

function buildInsertStmt(
  db: D1Database,
  theaterId: string,
  businessDate: string,
  runId: string,
  r: NormalizedScreening,
): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO screenings
         (id, theater_id, movie_id, business_date, start_at, end_at,
          end_at_source, format, screen_name, detail_url, ingest_run_id)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
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
      r.screenName,
      r.detailUrl ?? null,
      runId,
    )
}

// 同一 (theater_id, business_date) を DELETE→INSERT で置換（洗い替え・docs/11 §4.1）。
// batch でアトミック。単一日付の書込に使う（レビュー承認は payload が1日分のためこちらを使う。docs/11 §6）。
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
    ...rows.map((r) => buildInsertStmt(db, theaterId, businessDate, runId, r)),
  ]
  await db.batch(stmts)
  return rows.length
}

function enumerateDates(fromIso: string, toIso: string): string[] {
  const dates: string[] = []
  const end = new Date(`${toIso}T00:00:00Z`).getTime()
  for (let t = new Date(`${fromIso}T00:00:00Z`).getTime(); t <= end; t += 24 * 3600_000) {
    dates.push(new Date(t).toISOString().slice(0, 10))
  }
  return dates
}

// businessDate 別にグルーピングして洗い替え（月間画像で複数日を含む場合。ADR-0012）。
//
// coverageFloor（この取込実行の対象日＝今日の businessDate）を必ず範囲に含め、抽出結果に
// 現れた日付の最小〜最大までを「この取込が責任を持つ範囲」として洗い替える。
// 抽出0件の日・今回の抽出に現れなかった日も含めて DELETE することで、休館日や
// 上映が無くなった日の古い screenings が残り続ける（stale データ）のを防ぐ。
// 抽出結果が完全に空の場合は coverageFloor 1日分のみを洗い替える（最低限のフロア）。
export async function replaceScreeningsByDate(
  db: D1Database,
  theaterId: string,
  runId: string,
  rows: NormalizedScreening[],
  coverageFloor: string,
): Promise<number> {
  const byDate = new Map<string, NormalizedScreening[]>()
  for (const r of rows) {
    const list = byDate.get(r.businessDate)
    if (list) list.push(r)
    else byDate.set(r.businessDate, [r])
  }

  const allDates = [coverageFloor, ...byDate.keys()].sort()
  const coverageDates = enumerateDates(allDates[0], allDates[allDates.length - 1])

  const stmts: D1PreparedStatement[] = coverageDates.map((date) =>
    db
      .prepare(`DELETE FROM screenings WHERE theater_id = ? AND business_date = ?`)
      .bind(theaterId, date),
  )
  let total = 0
  for (const date of coverageDates) {
    for (const r of byDate.get(date) ?? []) {
      stmts.push(buildInsertStmt(db, theaterId, date, runId, r))
      total++
    }
  }
  await db.batch(stmts) // coverage 範囲全体を1トランザクションで洗い替え（アトミック）
  return total
}
