import type { PlanResponse } from '@cinema/shared'
import { useState } from 'react'
import { buildIcs, icsFilename } from '../lib/ics'
import { planLabelText } from '../lib/labels'
import { PlanTimeline } from './PlanTimeline'
import { SharePanel } from './SharePanel'

// 結果一覧・詳細（07 §1.4）。タブ切替はクライアント内（再リクエストなし）。
// タイムライン描画は PlanTimeline（共有ページと共用。P5-2 で切り出し）。

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
        <PlanTimeline plan={plan} />

        {/* アクション（共有は表示中タブの Plan を発行する。P5-2・F-12） */}
        <div className="mt-3 flex flex-wrap items-start gap-2">
          <button
            type="button"
            onClick={downloadIcs}
            className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
          >
            ⬇ .ics 保存（カレンダー一括登録）
          </button>
          <SharePanel key={`${plan.label}-${active}`} plan={plan} />
        </div>
      </div>
    </section>
  )
}
