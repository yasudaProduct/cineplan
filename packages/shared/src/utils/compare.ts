import type { Score } from '../schemas/plan'

// 目的関数の辞書式比較（docs/spec/05 §1 / docs/spec/10 §3）。
// すべての最適性判断の単一の基準。乱数・Map イテレーション順に依存しないこと。
// a が b より良ければ負、悪ければ正、同値 0。
export function compareScore(a: Score, b: Score): number {
  if (a.count !== b.count) return b.count - a.count // 本数: 多い方が良い
  if (a.travel !== b.travel) return a.travel - b.travel // 移動: 少ない方が良い
  if (a.wait !== b.wait) return a.wait - b.wait // 待ち: 少ない方が良い
  if (a.endMin !== b.endMin) return a.endMin - b.endMin // 終了: 早い方が良い
  return a.lastId < b.lastId ? -1 : a.lastId > b.lastId ? 1 : 0 // id 辞書順
}

export const isBetter = (a: Score, b: Score): boolean => compareScore(a, b) < 0
