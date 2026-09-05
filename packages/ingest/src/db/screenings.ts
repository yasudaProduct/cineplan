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

// 同一 (theater_id, business_date) を DELETE→INSERT で置換（洗い替え・docs/spec/09 §4.1）。
// batch でアトミック。単一日付の書込に使う（レビュー承認は payload が1日分のためこちらを使う。docs/spec/09 §6）。
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
//
// skipDates は「抽出に失敗して見送った日」（ADR-0023・docs/spec/03 §7）。その日は
// 「上映が無い」ではなく「今回は分からなかった」なので coverage から除外する。
// 含めると DELETE だけされて INSERT が無く、既存データを失う。
export async function replaceScreeningsByDate(
  db: D1Database,
  theaterId: string,
  runId: string,
  rows: NormalizedScreening[],
  coverageFloor: string,
  skipDates: string[] = [],
): Promise<number> {
  const byDate = new Map<string, NormalizedScreening[]>()
  for (const r of rows) {
    const list = byDate.get(r.businessDate)
    if (list) list.push(r)
    else byDate.set(r.businessDate, [r])
  }

  const allDates = [coverageFloor, ...byDate.keys()].sort()
  // 見送った日に抽出行がある状態は起きない（見送り＝その日の結果が無い）が、
  // 万一同時に来たら書込側を優先し除外しない（DELETE 無しの INSERT で重複するのを防ぐ）。
  const skip = new Set(skipDates.filter((d) => !byDate.has(d)))
  const coverageDates = enumerateDates(allDates[0], allDates[allDates.length - 1]).filter(
    (d) => !skip.has(d),
  )

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

// ---- 管理サイトの抽出検証用読取（ADR-0015。docs/spec/07 §2.6）----
// 利用者向け・公開 API には出さない（docs/spec/08 §1 原則1 注記）。

export interface ScreeningDateCount {
  business_date: string
  count: number
}

// データが存在する business_date と件数（日付昇順）
export async function listScreeningDates(
  db: D1Database,
  theaterId: string,
): Promise<ScreeningDateCount[]> {
  const { results } = await db
    .prepare(
      `SELECT business_date, COUNT(*) AS count FROM screenings
        WHERE theater_id = ? GROUP BY business_date ORDER BY business_date`,
    )
    .bind(theaterId)
    .all<ScreeningDateCount>()
  return results
}

export interface ScreeningListRow {
  start_at: string
  end_at: string
  end_at_source: string
  format: string | null
  screen_name: string
  detail_url: string | null
  ingest_run_id: string
  created_at: string
  movie_title: string
  runtime_min: number | null
}

// 劇場×日付の screenings（作品名 join・開始時刻順）
export async function listScreeningsForDate(
  db: D1Database,
  theaterId: string,
  businessDate: string,
): Promise<ScreeningListRow[]> {
  const { results } = await db
    .prepare(
      `SELECT s.start_at, s.end_at, s.end_at_source, s.format, s.screen_name,
              s.detail_url, s.ingest_run_id, s.created_at,
              m.title AS movie_title, m.runtime_min
         FROM screenings s JOIN movies m ON m.id = s.movie_id
        WHERE s.theater_id = ? AND s.business_date = ?
        ORDER BY s.start_at, s.screen_name`,
    )
    .bind(theaterId, businessDate)
    .all<ScreeningListRow>()
  return results
}

// 既定表示日: 今日(JST) → なければ直近の未来日 → なければ最新の過去日（docs/spec/07 §2.6）
export function pickDefaultDate(dates: string[], today: string): string | null {
  if (dates.length === 0) return null
  if (dates.includes(today)) return today
  const sorted = [...dates].sort()
  return sorted.find((d) => d > today) ?? sorted[sorted.length - 1]
}
