import type { Score } from '@cinema/shared'

// planner 内部型（docs/spec/10 §2）。分単位・UTC エポック分で計算し、ISO 変換は build.ts のみ。

export interface Candidate {
  screeningId: string
  theaterId: string
  movieId: string
  startMin: number // UTC エポック分
  endMin: number
  format: string | null
  detailUrl: string | null
  movieTitle: string
  theaterName: string
  officialUrl: string
}

// DP エントリ（k-best 保持のため配列で持つ）
export interface Entry {
  score: Score
  path: number[] // candidate index の列
  mask: number // マスト達成ビットマスク
}

export interface TravelResolver {
  between(a: string, b: string): number
  summary?(a: string, b: string): string | null
}

export interface PlanContext {
  cands: Candidate[] // startMin 昇順ソート済み
  mustMovieIds: string[] // index 順がビット位置
  arrivalMarginMin: number // 劇場間マージン
  windowStartMin: number
  windowEndMin: number
  travel: TravelResolver
  originToTheaterMin: Map<string, number> // 劇場ID → origin 所要分
  theaterToDestMin: Map<string, number> | null // destination 指定時のみ
}
