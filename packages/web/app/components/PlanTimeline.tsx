import type { Leg, Plan, PlanStats } from '@cinema/shared'
import { googleCalendarUrl } from '../lib/calendar'
import { formatDuration, isLateNight, jstTime, minutesBetween } from '../lib/time'
import {
  IconCalendar,
  IconClock,
  IconExternal,
  IconFilm,
  IconFlag,
  IconMapPin,
  IconTicket,
  IconTrain,
  IconWarning,
} from './icons'

// 単一 Plan のタイムライン + 集計（読み取り専用）。
// 結果画面（PlanResult のタブ内・07 §1.4）と共有ページ（/p/{planId}・07 §1.5）で共用する。
// P5-2 で PlanResult から切り出した（表示ロジックの二重実装を避ける）。
// 表示は時刻列 + 縦レール + ノード構成（07 §1.4）。上映=カード / travel・wait=コネクタ。

// 列幅: 時刻 w-12(3rem) + マーカー w-8(2rem)。レールはマーカー列の中心 = left 4rem。
const RAIL_LEFT = 'left-16'

export function PlanTimeline({ plan }: { plan: Plan }) {
  return (
    <>
      <ol className="relative flex flex-col">
        <span
          aria-hidden="true"
          className={`absolute top-8 bottom-8 w-px bg-neutral-200 ${RAIL_LEFT}`}
        />
        {plan.legs.map((leg, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: legs は選択中プランの静的リストで部分更新・並べ替えが無いため index で安全
          <TimelineLeg key={`${leg.kind}-${i}`} leg={leg} />
        ))}
      </ol>
      <StatsBar stats={plan.stats} />
    </>
  )
}

function TimelineLeg({ leg }: { leg: Leg }) {
  if (leg.kind === 'travel') {
    return (
      <li className="relative flex items-center py-1">
        <span className="w-12 shrink-0 text-right text-xs tabular-nums text-neutral-400">
          {jstTime(leg.departAt)}
        </span>
        <ConnectorMarker>
          <IconTrain className="text-[13px]" />
        </ConnectorMarker>
        <p className="min-w-0 flex-1 pl-2 text-sm text-neutral-600">
          移動 {leg.durationMin}分
          <span className="text-neutral-400">
            （{jstTime(leg.departAt)}→{jstTime(leg.arriveAt)}）
          </span>
          {leg.summary && (
            <span className="block truncate text-xs text-neutral-400">{leg.summary}</span>
          )}
        </p>
      </li>
    )
  }

  if (leg.kind === 'wait') {
    return (
      <li className="relative flex items-center py-1">
        <span className="w-12 shrink-0" />
        <ConnectorMarker>
          <IconClock className="text-[13px]" />
        </ConnectorMarker>
        <p className="min-w-0 flex-1 pl-2 text-sm text-neutral-500">待ち {leg.minutes}分</p>
      </li>
    )
  }

  // screening
  const dur = minutesBetween(leg.startAt, leg.endAt)
  return (
    <li className="relative flex py-1.5">
      <span className="w-12 shrink-0 pt-[0.85rem] text-right text-sm font-bold tabular-nums">
        {jstTime(leg.startAt)}
      </span>
      <span className="relative flex w-8 shrink-0 justify-center pt-[1.15rem]">
        <span className="size-3 rounded-full border-2 border-neutral-900 bg-white ring-4 ring-white" />
      </span>
      <div className="min-w-0 flex-1 rounded-lg border border-neutral-200 bg-white p-3 shadow-sm">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 leading-snug font-semibold">
          {leg.movieTitle}
          {leg.format && (
            <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-white">
              {leg.format}
            </span>
          )}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-neutral-500">
          <span className="tabular-nums">
            {jstTime(leg.startAt)}–{jstTime(leg.endAt)}（{formatDuration(dur)}）
          </span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <IconMapPin className="shrink-0 text-neutral-400" />
            <span className="truncate">{leg.theaterName}</span>
          </span>
        </p>
        <div className="mt-2.5 flex flex-wrap gap-2">
          {/* 予約導線は公式のみ（F-07・原則2） */}
          <a
            href={leg.officialUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-900 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-neutral-900 hover:text-white"
          >
            <IconTicket className="shrink-0" />
            劇場公式で予約
            <IconExternal className="shrink-0 text-[11px] opacity-60" />
          </a>
          <a
            href={googleCalendarUrl(leg)}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            <IconCalendar className="shrink-0" />
            カレンダー登録
          </a>
        </div>
      </div>
    </li>
  )
}

// travel / wait 用のレール上マーカー（アイコン入りの小円。ring でレールとの重なりを整える）
function ConnectorMarker({ children }: { children: React.ReactNode }) {
  return (
    <span className="relative flex w-8 shrink-0 justify-center">
      <span className="flex size-7 items-center justify-center rounded-full bg-neutral-100 text-neutral-500 ring-4 ring-white">
        {children}
      </span>
    </span>
  )
}

function StatsBar({ stats }: { stats: PlanStats }) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg bg-neutral-50 px-4 py-3 text-sm">
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <IconFilm className="text-neutral-400" />
        {stats.movieCount}本鑑賞
      </span>
      <span className="inline-flex items-center gap-1.5 text-neutral-600">
        <IconTrain className="text-neutral-400" />
        移動 {stats.totalTravelMin}分
      </span>
      <span className="inline-flex items-center gap-1.5 text-neutral-600">
        <IconClock className="text-neutral-400" />
        待ち {stats.totalWaitMin}分
      </span>
      <span className="inline-flex items-center gap-1.5 text-neutral-600">
        <IconFlag className="text-neutral-400" />
        {jstTime(stats.endTime)} 終了
      </span>
      {isLateNight(stats.endTime) && (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">
          <IconWarning />
          終電にご注意
        </span>
      )}
    </div>
  )
}
