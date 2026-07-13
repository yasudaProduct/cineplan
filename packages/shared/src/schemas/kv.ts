import { z } from 'zod'

// KV 値の契約（docs/03 §5）。ingest（週次バッチ）が書き、api（planner）が読む —
// パッケージ間のデータ契約なので shared に置く（CLAUDE.md ハードルール7）。

// travel-matrix:v{n}（docs/03 §5.1・ADR-0014）。
// matrix[i][j] = theaters[i] → theaters[j] の所要分（劇場前→劇場前 door-to-door）。
// 欠損（経路探索失敗・前回値も無い）は null = planner が直線距離推定へフォールバック。
export const TravelMatrix = z.object({
  generatedAt: z.string(),
  unit: z.literal('minutes'),
  theaters: z.array(z.string()),
  matrix: z.array(z.array(z.number().int().nonnegative().nullable())),
  // 経路概要（UI 表示用・任意）。キーは "thr_a>thr_b"、値は乗車路線名の連結。
  summaries: z.record(z.string(), z.string()).optional(),
})
export type TravelMatrix = z.infer<typeof TravelMatrix>

export const TRAVEL_MATRIX_KV_KEY = 'travel-matrix:v1'

// station-geo:{駅名}（docs/03 §5.2）。駅名→座標のジオコーディングキャッシュ。TTL 30日。
export const StationGeo = z.object({
  lat: z.number(),
  lng: z.number(),
})
export type StationGeo = z.infer<typeof StationGeo>

export const stationGeoKvKey = (stationName: string): string => `station-geo:${stationName}`
export const STATION_GEO_TTL_SECONDS = 30 * 24 * 3600
