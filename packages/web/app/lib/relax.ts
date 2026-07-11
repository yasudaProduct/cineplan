import type { RelaxSuggestion } from '@cinema/shared'

// infeasible 時の緩和提案をフォーム状態へワンタップ適用する（F-09・07 §1.3）。

export interface RelaxTarget {
  timeStart: string
  timeEnd: string
  mustMovieIds: string[]
  arrivalMarginMin: number
  destEnabled: boolean
}

export const relaxLabel: Record<RelaxSuggestion, string> = {
  widen_time_window: '時間帯を前後1時間広げて再算出',
  drop_must_movie: 'マスト指定を外して再算出',
  increase_margin_tolerance: '到着マージンを5分にして再算出',
  remove_destination: 'ゴール指定を外して再算出',
}

// "HH:mm" を deltaMin 分ずらす（00:00〜23:59 にクランプ）
export function shiftHHMM(hhmm: string, deltaMin: number): string {
  const [h, m] = hhmm.split(':').map(Number)
  const total = Math.min(23 * 60 + 59, Math.max(0, h * 60 + m + deltaMin))
  const hh = String(Math.floor(total / 60)).padStart(2, '0')
  const mm = String(total % 60).padStart(2, '0')
  return `${hh}:${mm}`
}

export function applyRelaxSuggestion<T extends RelaxTarget>(form: T, s: RelaxSuggestion): T {
  switch (s) {
    case 'widen_time_window':
      return {
        ...form,
        timeStart: shiftHHMM(form.timeStart, -60),
        timeEnd: shiftHHMM(form.timeEnd, 60),
      }
    case 'drop_must_movie':
      return { ...form, mustMovieIds: [] }
    case 'increase_margin_tolerance':
      return { ...form, arrivalMarginMin: 5 }
    case 'remove_destination':
      return { ...form, destEnabled: false }
  }
}
