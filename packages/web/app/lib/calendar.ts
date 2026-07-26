import type { ScreeningLeg } from '@cinema/shared'
import { toCalendarUtc } from '@cinema/shared'

// Google カレンダー登録 URL の生成（F-10・ADR-0008。OAuth 不使用・上映1件=予定1件）。
// toCalendarUtc の実体は P5-1 で @cinema/shared へ移動（.ics サーバ生成と共通化）。
export { toCalendarUtc }

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
