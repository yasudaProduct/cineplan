import type { Plan, ScreeningLeg } from '../schemas/plan'

// カレンダー連携ユーティリティ（F-10/F-11・ADR-0008）。
// P3-5 で web に実装したものを P5-1 で shared へ移動した:
// GET /v1/plans/{id}/ics（サーバ生成・共有ページ用）が同一の .ics を返す必要があり、
// web / api の二重実装を避けるため（docs/spec/04 設計メモ3）。

// '2026-07-15T01:00:00.000Z' → '20260715T010000Z'（Google/iCal の UTC 形式）
export function toCalendarUtc(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
}

const escapeText = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')

// .ics 生成（VEVENT は screening のみ・CRLF 区切り。RFC 5545）
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
