import type { ScreeningLeg } from '@cinema/shared'

// Google カレンダー登録 URL の生成（F-10・ADR-0008。OAuth 不使用・上映1件=予定1件）。

// '2026-07-15T01:00:00.000Z' → '20260715T010000Z'（Google/iCal の UTC 形式）
export function toCalendarUtc(iso: string): string {
  return iso.replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '')
}

export function googleCalendarUrl(leg: ScreeningLeg): string {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `🎬 ${leg.movieTitle}`,
    dates: `${toCalendarUtc(leg.startAt)}/${toCalendarUtc(leg.endAt)}`,
    location: leg.theaterName,
    details: `${leg.theaterName}\n公式: ${leg.officialUrl}\n※上映時間は変更される場合があります。必ず公式サイトでご確認ください。`,
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
