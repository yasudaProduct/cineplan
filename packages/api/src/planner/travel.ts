import type { Location } from '@cinema/shared'
import type { TravelResolver } from './types'

// 移動時間の解決（docs/05 §5）。
// 劇場間: KV の TravelMatrix があれば参照、欠損ペアは直線距離フォールバック推定。
// origin/destination: P2 暫定 — station は劇場の nearest_station 一致（walk_min_from_sta）、
// geo は直線距離フォールバック。駅すぱあとによる本解決は P4-6（ADR-0005）。

export interface TheaterGeo {
  id: string
  lat: number
  lng: number
  nearestStation: string
  walkMinFromSta: number
}

// KV `travel-matrix:v{n}` の値（docs/03 §5.1）
export interface TravelMatrixData {
  theaters: string[]
  matrix: number[][]
  summaries?: Record<string, string>
}

const FALLBACK_SPEED_KMH = 20
const FALLBACK_OVERHEAD_MIN = 15

export function haversineKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const rad = (d: number): number => (d * Math.PI) / 180
  const dLat = rad(bLat - aLat)
  const dLng = rad(bLng - aLng)
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

// 直線距離 ÷ 20km/h + 15分（docs/05 §5 のフォールバック推定）
export function estimateMinutes(aLat: number, aLng: number, bLat: number, bLng: number): number {
  return (
    Math.ceil((haversineKm(aLat, aLng, bLat, bLng) / FALLBACK_SPEED_KMH) * 60) +
    FALLBACK_OVERHEAD_MIN
  )
}

export function createTravelResolver(
  theaters: TheaterGeo[],
  matrix: TravelMatrixData | null,
): TravelResolver {
  const idx = new Map<string, number>((matrix?.theaters ?? []).map((id, i) => [id, i]))
  const geo = new Map(theaters.map((t) => [t.id, t]))
  return {
    between(a: string, b: string): number {
      if (a === b) return 0 // 同一劇場（マージンは館内 M_IN 固定。docs/05 §5）
      const ia = idx.get(a)
      const ib = idx.get(b)
      if (matrix && ia !== undefined && ib !== undefined) {
        return matrix.matrix[ia][ib]
      }
      const ga = geo.get(a)
      const gb = geo.get(b)
      if (ga && gb) return estimateMinutes(ga.lat, ga.lng, gb.lat, gb.lng)
      return Number.MAX_SAFE_INTEGER // 座標未知（通常起きない）は実質到達不能
    },
    summary(a: string, b: string): string | null {
      return matrix?.summaries?.[`${a}>${b}`] ?? null
    },
  }
}

// origin/destination → 各劇場への所要分。解決できない劇場はマップに含めない
// （DP 側が到達不能として扱う）。マップが空 = 地点自体を解決できない。
export function resolveEndpointMinutes(loc: Location, theaters: TheaterGeo[]): Map<string, number> {
  const map = new Map<string, number>()
  if (loc.type === 'geo' && typeof loc.value === 'object') {
    for (const t of theaters) {
      map.set(t.id, estimateMinutes(loc.value.lat, loc.value.lng, t.lat, t.lng))
    }
  } else if (loc.type === 'station' && typeof loc.value === 'string') {
    for (const t of theaters) {
      if (t.nearestStation === loc.value) map.set(t.id, t.walkMinFromSta)
    }
  }
  return map
}
