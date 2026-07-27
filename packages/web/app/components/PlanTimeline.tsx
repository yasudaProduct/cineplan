import type { Leg, Plan } from '@cinema/shared'
import { googleCalendarUrl } from '../lib/calendar'
import { formatDuration, isLateNight, jstTime, minutesBetween } from '../lib/time'

// 単一 Plan のタイムライン + 集計（読み取り専用）。
// 結果画面（PlanResult のタブ内・07 §1.4）と共有ページ（/p/{planId}・07 §1.5）で共用する。
// P5-2 で PlanResult から切り出した（表示ロジックの二重実装を避ける）。

export function PlanTimeline({ plan }: { plan: Plan }) {
  return (
    <>
      {/* タイムライン（縦） */}
      <ol className="flex flex-col gap-1">
        {plan.legs.map((leg, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: legs は選択中プランの静的リストで部分更新・並べ替えが無いため index で安全
          <TimelineLeg key={`${leg.kind}-${i}`} leg={leg} />
        ))}
      </ol>

      {/* 集計 */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-100 pt-3 text-sm">
        <span className="font-semibold">
          {plan.stats.movieCount}本 / 移動{plan.stats.totalTravelMin}分 / 待ち
          {plan.stats.totalWaitMin}分 / {jstTime(plan.stats.endTime)} 終了
        </span>
        {isLateNight(plan.stats.endTime) && (
          <span className="rounded-full bg-amber-100 px-3 py-0.5 text-xs font-semibold text-amber-800">
            ⚠ 終電にご注意
          </span>
        )}
      </div>
    </>
  )
}

function TimelineLeg({ leg }: { leg: Leg }) {
  if (leg.kind === 'travel') {
    return (
      <li className="flex items-baseline gap-2 py-1 text-sm text-neutral-600">
        <span className="w-12 shrink-0 tabular-nums">{jstTime(leg.departAt)}</span>
        <span>
          🚃 移動 {leg.durationMin}分（{jstTime(leg.departAt)}→{jstTime(leg.arriveAt)}）
          {leg.summary ? ` ${leg.summary}` : ''}
        </span>
      </li>
    )
  }
  if (leg.kind === 'wait') {
    return (
      <li className="flex items-baseline gap-2 py-1 text-sm text-neutral-500">
        <span className="w-12 shrink-0" />
        <span>☕ 待ち {leg.minutes}分</span>
      </li>
    )
  }
  // screening
  const dur = minutesBetween(leg.startAt, leg.endAt)
  return (
    <li className="flex items-baseline gap-2 rounded-md bg-neutral-50 px-2 py-2">
      <span className="w-12 shrink-0 tabular-nums text-sm font-semibold">
        {jstTime(leg.startAt)}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          🎬 {leg.movieTitle}
          <span className="ml-2 text-sm font-normal text-neutral-500">
            {formatDuration(dur)}
            {leg.format ? ` ・${leg.format}` : ''}
          </span>
        </p>
        <p className="text-sm text-neutral-600">
          {leg.theaterName}（〜{jstTime(leg.endAt)}）
        </p>
        <p className="mt-1 flex gap-3 text-sm">
          {/* 予約導線は公式のみ（F-07・原則2） */}
          <a
            href={leg.officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            劇場公式で予約する ↗
          </a>
          <a
            href={googleCalendarUrl(leg)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-700 underline"
          >
            📅 カレンダー登録
          </a>
        </p>
      </div>
    </li>
  )
}
