import type { TheaterRecord as TheaterRecordT } from '@cinema/shared'
import { TheaterRecord } from '@cinema/shared'

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
  official_url: string
  terms_note: string | null
  terms_checked_at: string | null
  robots_status: string
}

const COLS =
  'id,name,short_name,status,lat,lng,nearest_station,walk_min_from_sta,schedule_url,fetch_method,extract_method,official_url,terms_note,terms_checked_at,robots_status'

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

// cron の取込対象（active のみ）。
export async function listActiveTheaters(db: D1Database): Promise<TheaterRecordT[]> {
  const { results } = await db
    .prepare(`SELECT ${COLS} FROM theaters WHERE status='active' ORDER BY id`)
    .all<TheaterRow>()
  return results.map(toRecord)
}
