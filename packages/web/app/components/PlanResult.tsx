import type { PlanResponse } from '@cinema/shared'
import { useState } from 'react'
import { buildIcs, icsFilename } from '../lib/ics'
import { planLabelText } from '../lib/labels'
import { IconDownload } from './icons'
import { PlanTimeline } from './PlanTimeline'
import { SharePanel } from './SharePanel'

// 結果一覧・詳細（07 §1.4）。タブ切替はクライアント内（再リクエストなし）。
// タブはセグメントコントロール型。タイムライン描画は PlanTimeline（共有ページと共用。P5-2 で切り出し）。

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
      {/* プラン切替（セグメントコントロール） */}
      {plans.length > 1 && (
        <div className="mb-3 flex gap-1 rounded-lg bg-neutral-200/70 p-1" role="tablist">
          {plans.map((p, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: 算出結果ごとに全置換される静的リストで並べ替えが無いため index で安全
              key={`${p.label}-${i}`}
              type="button"
              role="tab"
              aria-selected={i === active}
              onClick={() => setActive(i)}
              className={`flex-1 rounded-md px-2 py-1.5 text-center ${
                i === active ? 'bg-white shadow-sm' : 'text-neutral-500 hover:text-neutral-700'
              }`}
            >
              <span className="block text-sm font-semibold">{planLabelText[p.label]}</span>
              <span
                className={`block text-xs ${i === active ? 'text-neutral-500' : 'text-neutral-400'}`}
              >
                {p.stats.movieCount}本・移動{p.stats.totalTravelMin}分
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="rounded-lg border border-neutral-200 bg-white p-4 shadow-sm">
        <PlanTimeline plan={plan} />

        {/* アクション（共有は表示中タブの Plan を発行する。P5-2・F-12） */}
        <div className="mt-4 flex flex-wrap items-start gap-2 border-t border-neutral-100 pt-4">
          <button
            type="button"
            onClick={downloadIcs}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
          >
            <IconDownload className="shrink-0" />
            .ics 保存（カレンダー一括登録）
          </button>
          <SharePanel key={`${plan.label}-${active}`} plan={plan} />
        </div>
      </div>
    </section>
  )
}
