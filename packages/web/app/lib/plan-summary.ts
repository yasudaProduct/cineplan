import type { Plan, ScreeningLeg } from '@cinema/shared'
import { jstTime } from './time'

// 共有ページ・OGP 用の集計導出（P5-2・docs/07 §1.5）。
// Plan スナップショットから導出できる値のみ（駅名・検索条件は Plan に含まれない）。

export interface PlanSummary {
  dateLabel: string // '7/27(月)'（JST・先頭上映の興行日ではなく実日付表示）
  movieCount: number
  travelMin: number
  waitMin: number
  startTime: string // '10:30'（最初の上映開始・JST）
  endTime: string // '18:45'（stats.endTime・JST）
  theaterCount: number
  movieTitles: string[]
}

const WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const

// '2026-07-27T01:30:00.000Z' → '7/27(月)'（JST）
export function jstDateLabel(iso: string): string {
  const jst = new Date(new Date(iso).getTime() + 9 * 3600 * 1000)
  return `${jst.getUTCMonth() + 1}/${jst.getUTCDate()}(${WEEKDAYS[jst.getUTCDay()]})`
}

// '2026-07-27T01:30:00.000Z' → '2026-07-27'（JST。/plan の日付プリセット用）
export function jstDateValue(iso: string): string {
  return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

export function summarizePlan(plan: Plan): PlanSummary {
  const screenings = plan.legs.filter((l): l is ScreeningLeg => l.kind === 'screening')
  const first = screenings[0]
  return {
    dateLabel: first ? jstDateLabel(first.startAt) : '',
    movieCount: plan.stats.movieCount,
    travelMin: plan.stats.totalTravelMin,
    waitMin: plan.stats.totalWaitMin,
    startTime: first ? jstTime(first.startAt) : '',
    endTime: jstTime(plan.stats.endTime),
    theaterCount: new Set(screenings.map((s) => s.theaterId)).size,
    movieTitles: screenings.map((s) => s.movieTitle),
  }
}

// og:description / Web Share のテキスト（映画タイトルは画像でなくテキスト側に載せる。docs/07 §1.5）
export function shareDescription(s: PlanSummary): string {
  const stats = `移動${s.travelMin}分・待ち${s.waitMin}分・${s.endTime}終了`
  return s.movieTitles.length > 0 ? `${stats} | ${s.movieTitles.join(' / ')}` : stats
}

export function shareTitle(s: PlanSummary): string {
  return `${s.dateLabel} ${s.movieCount}本はしごプラン — cineplan`
}
