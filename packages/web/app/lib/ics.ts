import type { Plan, ScreeningLeg } from '@cinema/shared'
import { toCalendarUtc } from './calendar'

// .ics 生成（F-11）。結果画面はクライアント生成（docs/04 設計メモ3）。
// 共有ページ用のサーバ生成 /plans/{id}/ics は P5-1。

const escapeText = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

export function buildIcs(plan: Plan, nowIso: string = new Date().toISOString()): string {
  const screenings = plan.legs.filter((l): l is ScreeningLeg => l.kind === 'screening')
  const dtstamp = toCalendarUtc(nowIso)
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//cineplan//hashigo//JA',
    'CALSCALE:GREGORIAN',
  ]
  screenings.forEach((s, i) => {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${toCalendarUtc(s.startAt)}-${i}@cineplan`,
      `DTSTAMP:${dtstamp}`,
      `DTSTART:${toCalendarUtc(s.startAt)}`,
      `DTEND:${toCalendarUtc(s.endAt)}`,
      `SUMMARY:${escapeText(`🎬 ${s.movieTitle}`)}`,
      `LOCATION:${escapeText(s.theaterName)}`,
      `DESCRIPTION:${escapeText(`公式: ${s.officialUrl}\n※上映時間は変更される場合があります。必ず公式サイトでご確認ください。`)}`,
      'END:VEVENT',
    )
  })
  lines.push('END:VCALENDAR')
  return `${lines.join('\r\n')}\r\n`
}

export function icsFilename(date: string): string {
  return `hashigo-${date}.ics`
}
