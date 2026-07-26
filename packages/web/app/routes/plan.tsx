import type { Movie, PlanRequest, PlanResponse, RelaxSuggestion } from '@cinema/shared'
import { useCallback, useEffect, useRef, useState } from 'react'
import { PlanForm } from '../components/PlanForm'
import { PlanResult } from '../components/PlanResult'
import { fetchMovies, postPlan } from '../lib/api'
import { infeasibleReasonText } from '../lib/labels'
import { applyRelaxSuggestion, relaxLabel } from '../lib/relax'
import { loadFormState, saveFormState } from '../lib/storage'
import { todayJst } from '../lib/time'
import type { Route } from './+types/plan'

export function meta(_args: Route.MetaArgs) {
  return [{ title: 'はしごプラン作成 — cineplan' }]
}

// フォーム状態（07 §1.3）。localStorage に保存・復元（個人情報なし）。
export interface FormState {
  date: string
  timeStart: string
  timeEnd: string
  originKind: 'station' | 'geo'
  originStation: string
  originGeo: { lat: number; lng: number } | null
  destEnabled: boolean
  destStation: string
  arrivalMarginMin: number
  mustMovieIds: string[]
  wishMovieIds: string[]
}

function defaultForm(): FormState {
  return {
    date: todayJst(),
    timeStart: '09:00',
    timeEnd: '22:00',
    originKind: 'station',
    originStation: '',
    originGeo: null,
    destEnabled: false,
    destStation: '',
    arrivalMarginMin: 15,
    mustMovieIds: [],
    wishMovieIds: [],
  }
}

// 画面状態（07 §1.3: idle / loading / results / infeasible / error）
type Phase =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'results'; res: PlanResponse }
  | { kind: 'infeasible'; reason: string; suggestions: RelaxSuggestion[] }
  | { kind: 'error'; message: string }

function buildRequest(f: FormState): { req: PlanRequest } | { error: string } {
  if (f.originKind === 'station' && f.originStation.trim() === '') {
    return { error: 'スタート地点の駅名を入力してください' }
  }
  if (f.originKind === 'geo' && !f.originGeo) {
    return { error: '現在地を取得してください（📍ボタン）' }
  }
  const origin =
    f.originKind === 'geo' && f.originGeo
      ? { type: 'geo' as const, value: f.originGeo }
      : { type: 'station' as const, value: f.originStation.trim() }
  const destination =
    f.destEnabled && f.destStation.trim() !== ''
      ? { type: 'station' as const, value: f.destStation.trim() }
      : null
  return {
    req: {
      date: f.date,
      timeWindow: { start: f.timeStart, end: f.timeEnd },
      origin,
      destination,
      mustMovieIds: f.mustMovieIds,
      wishMovieIds: f.wishMovieIds,
      arrivalMarginMin: f.arrivalMarginMin,
      maxResults: 3,
    },
  }
}

export default function PlanPage() {
  const [form, setForm] = useState<FormState>(defaultForm)
  const [movies, setMovies] = useState<Movie[]>([])
  const [moviesLoading, setMoviesLoading] = useState(false)
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })
  const restored = useRef(false)

  // 初回マウントで localStorage から復元（過去日付になっていたら今日に置き換え）。
  // ?date=YYYY-MM-DD があれば最優先（共有ページの「自分でもプランを作る」導線。07 §1.5）。
  useEffect(() => {
    if (restored.current) return
    restored.current = true
    const urlDate = new URLSearchParams(window.location.search).get('date')
    const presetDate =
      urlDate && /^\d{4}-\d{2}-\d{2}$/.test(urlDate) && urlDate >= todayJst() ? urlDate : null
    const saved = loadFormState<FormState>()
    if (saved || presetDate) {
      setForm((cur) => {
        const merged = { ...cur, ...saved }
        if (!merged.date || merged.date < todayJst()) merged.date = todayJst()
        if (presetDate) merged.date = presetDate
        return merged
      })
    }
  }, [])

  // 入力値を保存
  useEffect(() => {
    if (restored.current) saveFormState(form)
  }, [form])

  // 対象日の作品一覧（マスト/ウィッシュ選択用。上映時刻は返らない = 原則1）
  useEffect(() => {
    let cancelled = false
    setMoviesLoading(true)
    fetchMovies(form.date).then((r) => {
      if (cancelled) return
      setMoviesLoading(false)
      const list = r.ok ? r.data : []
      setMovies(list)
      // 日付変更で存在しなくなった選択作品を除去
      const ids = new Set(list.map((m) => m.id))
      setForm((cur) => ({
        ...cur,
        mustMovieIds: cur.mustMovieIds.filter((id) => ids.has(id)),
        wishMovieIds: cur.wishMovieIds.filter((id) => ids.has(id)),
      }))
    })
    return () => {
      cancelled = true
    }
  }, [form.date])

  const submit = useCallback(async (f: FormState) => {
    const built = buildRequest(f)
    if ('error' in built) {
      setPhase({ kind: 'error', message: built.error })
      return
    }
    setPhase({ kind: 'loading' })
    const r = await postPlan(built.req)
    if (!r.ok) {
      const message =
        r.code === 'DATA_NOT_READY'
          ? 'この日の上映データはまだ取り込まれていません。別の日付をお試しください。'
          : r.message
      setPhase({ kind: 'error', message })
      return
    }
    if (r.data.plans.length === 0 && r.data.infeasible) {
      setPhase({
        kind: 'infeasible',
        reason: infeasibleReasonText[r.data.infeasible.reason],
        suggestions: r.data.infeasible.relaxSuggestions,
      })
      return
    }
    setPhase({ kind: 'results', res: r.data })
  }, [])

  // 緩和提案のワンタップ適用 → フォーム更新 + 即再算出（F-09）
  const onRelax = useCallback(
    (s: RelaxSuggestion) => {
      const next = applyRelaxSuggestion(form, s)
      setForm(next)
      void submit(next)
    },
    [form, submit],
  )

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="mb-6 text-2xl font-bold">🎬 はしごプランを組む</h1>

      <PlanForm
        form={form}
        setForm={setForm}
        movies={movies}
        moviesLoading={moviesLoading}
        submitting={phase.kind === 'loading'}
        onSubmit={() => void submit(form)}
      />

      <div className="mt-8" id="results">
        {phase.kind === 'loading' && (
          <div className="animate-pulse rounded-lg border border-neutral-200 bg-white p-8 text-center text-neutral-500">
            ルートを計算中…
          </div>
        )}
        {phase.kind === 'error' && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
            {phase.message}
          </div>
        )}
        {phase.kind === 'infeasible' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <p className="font-semibold text-amber-800">{phase.reason}</p>
            {phase.suggestions.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {phase.suggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onRelax(s)}
                    className="rounded-full border border-amber-400 bg-white px-4 py-1.5 text-sm text-amber-800 hover:bg-amber-100"
                  >
                    {relaxLabel[s]}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {phase.kind === 'results' && <PlanResult response={phase.res} date={form.date} />}
      </div>
    </main>
  )
}
