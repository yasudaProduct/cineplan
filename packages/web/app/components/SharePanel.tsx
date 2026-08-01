import type { Plan } from '@cinema/shared'
import { useState } from 'react'
import { sharePlan } from '../lib/api'
import { shareDescription, shareTitle, summarizePlan } from '../lib/plan-summary'

// 共有ボタン + 共有手段（P5-2・F-12・docs/spec/07 §1.5）。
// POST /v1/plans で URL を発行し、コピー / Web Share API（対応端末）/ X / LINE を出す。
// - 発行直後に共有ページへ自動遷移しない（書込直後の読取はエッジ伝播の過渡で 404 に
//   なりうることを ST で観測済み。共有の目的は URL の配布であり遷移は必須でない）。
// - Web Share API は発行後に自動で呼ばず「共有…」ボタンに分離する。発行の await 後は
//   user activation が切れて Safari 系が NotAllowedError にするのと、デスクトップで
//   OS 共有シートが勝手に開く（ローカル実機で発行フローがそこで止まるのを確認）ため。

type ShareState =
  | { kind: 'idle' }
  | { kind: 'sharing' }
  | { kind: 'shared'; url: string; copied: boolean }
  | { kind: 'error'; message: string }

export function SharePanel({ plan }: { plan: Plan }) {
  const [state, setState] = useState<ShareState>({ kind: 'idle' })

  const issue = async () => {
    setState({ kind: 'sharing' })
    const r = await sharePlan(plan)
    if (!r.ok) {
      setState({ kind: 'error', message: `共有URLの発行に失敗しました（${r.message}）` })
      return
    }
    setState({ kind: 'shared', url: r.data.url, copied: false })
  }

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setState({ kind: 'shared', url, copied: true })
    } catch {
      // clipboard 不許可時は input の手動コピーに任せる（URL は表示済み）
    }
  }

  // ボタン押下（user gesture 内）で OS の共有シートを開く。キャンセル（AbortError）は無視。
  const openShareSheet = async (url: string) => {
    const s = summarizePlan(plan)
    try {
      await navigator.share({ title: shareTitle(s), text: shareDescription(s), url })
    } catch {
      // ユーザーキャンセル等。URL 表示が残っているので何もしない
    }
  }

  if (state.kind === 'idle' || state.kind === 'sharing' || state.kind === 'error') {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={issue}
          disabled={state.kind === 'sharing'}
          className="rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50"
        >
          {state.kind === 'sharing' ? '発行中…' : '🔗 共有URLを発行'}
        </button>
        {state.kind === 'error' && <p className="text-sm text-red-700">{state.message}</p>}
      </div>
    )
  }

  const { url, copied } = state
  const encoded = encodeURIComponent(url)
  return (
    <div className="flex w-full flex-col gap-2 rounded-md border border-neutral-200 bg-neutral-50 p-3">
      <p className="text-xs text-neutral-500">共有URL（30日間有効）</p>
      <div className="flex gap-2">
        <input
          readOnly
          value={url}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded border border-neutral-300 bg-white px-2 py-1 text-sm"
        />
        <button
          type="button"
          onClick={() => copy(url)}
          className="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1 text-sm hover:bg-neutral-100"
        >
          {copied ? '✓ コピーしました' : 'コピー'}
        </button>
      </div>
      <p className="flex flex-wrap gap-3 text-sm">
        {typeof navigator !== 'undefined' && 'share' in navigator && (
          <button
            type="button"
            onClick={() => openShareSheet(url)}
            className="text-blue-700 underline"
          >
            📤 共有…
          </button>
        )}
        <a
          href={`https://x.com/intent/post?url=${encoded}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline"
        >
          X で共有
        </a>
        <a
          href={`https://social-plugins.line.me/lineit/share?url=${encoded}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-700 underline"
        >
          LINE で共有
        </a>
        <a href={url} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">
          共有ページを開く ↗
        </a>
      </p>
    </div>
  )
}
