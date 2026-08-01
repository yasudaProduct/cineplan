import type {
  TheaterRecord as TheaterRecordT,
  TheaterStatus as TheaterStatusT,
  TheaterUpsert as TheaterUpsertT,
} from '@cinema/shared'
import { newId, TheaterRecord } from '@cinema/shared'

interface TheaterRow {
  id: string
  name: string
  short_name: string | null
  status: string
  lat: number
  lng: number
  nearest_station: string
  walk_min_from_sta: number
  schedule_url: string
  fetch_method: string
  extract_method: string
  fetch_day_mode: string
  fetch_days: number
  official_url: string
  terms_note: string | null
  terms_checked_at: string | null
  robots_status: string
}

const COLS =
  'id,name,short_name,status,lat,lng,nearest_station,walk_min_from_sta,schedule_url,fetch_method,extract_method,fetch_day_mode,fetch_days,official_url,terms_note,terms_checked_at,robots_status'

function toRecord(row: TheaterRow): TheaterRecordT {
  // snake_case(D1) → camelCase(shared)。zod で値域も検証。
  return TheaterRecord.parse({
    id: row.id,
    name: row.name,
    shortName: row.short_name,
    status: row.status,
    lat: row.lat,
    lng: row.lng,
    nearestStation: row.nearest_station,
    walkMinFromSta: row.walk_min_from_sta,
    scheduleUrl: row.schedule_url,
    fetchMethod: row.fetch_method,
    extractMethod: row.extract_method,
    fetchDayMode: row.fetch_day_mode,
    fetchDays: row.fetch_days,
    officialUrl: row.official_url,
    termsNote: row.terms_note,
    termsCheckedAt: row.terms_checked_at,
    robotsStatus: row.robots_status,
  })
}

// 手動取込は status を問わず id で取得（paused の受入対象も対象にできる）。
export async function getTheater(db: D1Database, id: string): Promise<TheaterRecordT | null> {
  const row = await db
    .prepare(`SELECT ${COLS} FROM theaters WHERE id = ?`)
    .bind(id)
    .first<TheaterRow>()
  return row ? toRecord(row) : null
}

// cron の取込対象（active かつ robots/規約確認済みのみ。docs/spec/08 の多層防御）。
// 人間の運用（採用プロセス。docs/spec/08 §2）が一次防御だが、コード側でも
// robots_status='allowed' かつ terms_checked_at 有り以外は対象から除外する。
export async function listActiveTheaters(db: D1Database): Promise<TheaterRecordT[]> {
  const { results } = await db
    .prepare(
      `SELECT ${COLS} FROM theaters
        WHERE status='active' AND robots_status='allowed' AND terms_checked_at IS NOT NULL
        ORDER BY id`,
    )
    .all<TheaterRow>()
  return results.map(toRecord)
}

// ---- 管理サイト用 CRUD（P4-3。docs/spec/07 §2.3）----

// 全劇場（管理一覧用。retired 含む）。
export async function listAllTheaters(db: D1Database): Promise<TheaterRecordT[]> {
  const { results } = await db.prepare(`SELECT ${COLS} FROM theaters ORDER BY id`).all<TheaterRow>()
  return results.map(toRecord)
}

// 新規劇場は必ず paused で起票する（docs/spec/06 §9 受入手順・docs/spec/08 §2 採用プロセス）。
export async function createTheater(db: D1Database, input: TheaterUpsertT): Promise<string> {
  const id = newId('thr')
  await db
    .prepare(
      `INSERT INTO theaters (id,name,short_name,status,lat,lng,nearest_station,
         walk_min_from_sta,schedule_url,fetch_method,extract_method,
         fetch_day_mode,fetch_days,official_url,
         terms_note,terms_checked_at,robots_status)
       VALUES (?,?,?,'paused',?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .bind(
      id,
      input.name,
      input.shortName ?? null,
      input.lat,
      input.lng,
      input.nearestStation,
      input.walkMinFromSta,
      input.scheduleUrl,
      input.fetchMethod,
      input.extractMethod,
      input.fetchDayMode,
      input.fetchDays,
      input.officialUrl,
      input.termsNote ?? null,
      input.termsCheckedAt ?? null,
      input.robotsStatus,
    )
    .run()
  return id
}

// 基本情報の更新（status は含めない。変更は updateTheaterStatus の昇格ゲート経由のみ）。
export async function updateTheater(
  db: D1Database,
  id: string,
  input: TheaterUpsertT,
): Promise<void> {
  await db
    .prepare(
      `UPDATE theaters SET name=?, short_name=?, lat=?, lng=?, nearest_station=?,
         walk_min_from_sta=?, schedule_url=?, fetch_method=?, extract_method=?,
         fetch_day_mode=?, fetch_days=?,
         official_url=?, terms_note=?, terms_checked_at=?, robots_status=?
       WHERE id=?`,
    )
    .bind(
      input.name,
      input.shortName ?? null,
      input.lat,
      input.lng,
      input.nearestStation,
      input.walkMinFromSta,
      input.scheduleUrl,
      input.fetchMethod,
      input.extractMethod,
      input.fetchDayMode,
      input.fetchDays,
      input.officialUrl,
      input.termsNote ?? null,
      input.termsCheckedAt ?? null,
      input.robotsStatus,
      id,
    )
    .run()
}

export async function updateTheaterStatus(
  db: D1Database,
  id: string,
  status: TheaterStatusT,
): Promise<void> {
  await db.prepare(`UPDATE theaters SET status=? WHERE id=?`).bind(status, id).run()
}
