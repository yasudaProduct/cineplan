import type { StationGeo as StationGeoT } from '@cinema/shared'
import { STATION_GEO_TTL_SECONDS, StationGeo, stationGeoKvKey } from '@cinema/shared'

// 駅名 → 座標のジオコーディング（docs/spec/03 §5.2・docs/spec/04 設計メモ7・ADR-0014）。
// ls8h Transit API の /api/v1/locations/suggest を使い、結果は KV に 30日キャッシュする。
// 外部呼出はキャッシュ未ヒットの初出駅名のみ（利用者リクエスト毎には呼ばない）。
// 失敗（タイムアウト・不明駅名・API停止）は null を返し、呼び元が 400 にする。

export const TRANSIT_API_DEFAULT_BASE = 'https://api.transit.ls8h.com'
const SUGGEST_TIMEOUT_MS = 4000
const USER_AGENT = 'CinemaHashigoBot/0.1 (+https://example.com/bot)'

interface SuggestStation {
  name?: string
  kind?: string
  lat?: number
  lon?: number
}

export async function resolveStationToGeo(
  kv: KVNamespace,
  stationName: string,
  apiBase: string = TRANSIT_API_DEFAULT_BASE,
): Promise<StationGeoT | null> {
  const key = stationGeoKvKey(stationName)
  const cached = await kv.get(key, 'json')
  if (cached) {
    const parsed = StationGeo.safeParse(cached)
    if (parsed.success) return parsed.data
  }

  let stations: SuggestStation[]
  try {
    const url = `${apiBase}/api/v1/locations/suggest?q=${encodeURIComponent(stationName)}&limit=5`
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(SUGGEST_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { stations?: SuggestStation[] }
    stations = body.stations ?? []
  } catch {
    return null
  }

  // kind='station'（鉄道駅）を優先。API は score/weight 順に返すため先頭が最有力。
  const hit =
    stations.find((s) => s.kind === 'station' && s.lat != null && s.lon != null) ??
    stations.find((s) => s.lat != null && s.lon != null)
  if (!hit || hit.lat == null || hit.lon == null) return null

  const geo: StationGeoT = { lat: hit.lat, lng: hit.lon }
  await kv.put(key, JSON.stringify(geo), { expirationTtl: STATION_GEO_TTL_SECONDS })
  return geo
}
