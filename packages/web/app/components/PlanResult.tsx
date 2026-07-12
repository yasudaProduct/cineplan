import type { Leg, PlanResponse } from '@cinema/shared'
import { useState } from 'react'
import { googleCalendarUrl } from '../lib/calendar'
import { buildIcs, icsFilename } from '../lib/ics'
import { planLabelText } from '../lib/labels'
import { formatDuration, isLateNight, jstTime, minutesBetween } from '../lib/time'

// 結果一覧・詳細（07 §1.4）。タブ切替はクライアント内（再リクエストなし）。

interface Props {
  response: PlanResponse
  date: string
}

export function PlanResult({ response, date }: Props) {
  const [active, setActive] = useState(0)
  const plans = response.plans
  const plan = plans[active] ?? plans[0]
  if (!plan) return null

  const downloadIcs = () => {
    const blob = new Blob([buildIcs(plan)], { type: 'text/calendar' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = icsFilename(date)
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <section aria-label="算出結果">
      {/* タブ */}
      <div className="flex flex-wrap gap-2">
        {plans.map((p, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: 算出結果ごとに全置換される静的リストで並べ替えが無いため index で安全
            key={`${p.label}-${i}`}
            type="button"
            onClick={() => setActive(i)}
            className={`rounded-t-lg px-4 py-2 text-sm font-semibold ${
              i === active
                ? 'border border-b-0 border-neutral-300 bg-white'
                : 'bg-neutral-100 text-neutral-500 hover:bg-neutral-200'
            }`}
          >
            {planLabelText[p.label]} {p.stats.movieCount}本
          </button>
        ))}
      </div>

      <div className="rounded-b-lg rounded-tr-lg border border-neutral-300 bg-white p-4">
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

        {/* アクション（共有は P5-1） */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={downloadIcs}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
          >
            ⬇ .ics 保存（カレンダー一括登録）
          </button>
        </div>
      </div>
    </section>
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
