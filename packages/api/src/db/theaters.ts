import type { Theater } from '@cinema/shared'
import type { TheaterGeo } from '../planner/travel'

// active 劇場の読取（docs/11 §5.3 + planner の travel 解決に必要な列）
export interface TheaterRow {
  id: string
  name: string
  short_name: string | null
  lat: number
  lng: number
  official_url: string
  nearest_station: string
  walk_min_from_sta: number
}

export async function listTheaterRows(db: D1Database): Promise<TheaterRow[]> {
  const { results } = await db
    .prepare(
      `SELECT id, name, short_name, lat, lng, official_url, nearest_station, walk_min_from_sta
         FROM theaters WHERE status = 'active' ORDER BY name`,
    )
    .all<TheaterRow>()
  return results
}

// GET /v1/theaters のレスポンス形（docs/04 Theater。上映情報は含めない）
export function toApiTheater(r: TheaterRow): Theater {
  return {
    id: r.id,
    name: r.name,
    ...(r.short_name ? { shortName: r.short_name } : {}),
    lat: r.lat,
    lng: r.lng,
    officialUrl: r.official_url,
  }
}

export function toTheaterGeo(r: TheaterRow): TheaterGeo {
  return {
    id: r.id,
    lat: r.lat,
    lng: r.lng,
    nearestStation: r.nearest_station,
    walkMinFromSta: r.walk_min_from_sta,
  }
}
