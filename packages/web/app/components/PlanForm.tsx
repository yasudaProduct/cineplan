import type { Movie } from '@cinema/shared'
import { useState } from 'react'
import { addDaysJst, todayJst } from '../lib/time'
import type { FormState } from '../routes/plan'

// プラン作成フォーム（07 §1.3）。日付・時間帯・スタート/ゴール・詳細設定（マージン・作品選択）。

interface Props {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  movies: Movie[]
  moviesLoading: boolean
  submitting: boolean
  onSubmit: () => void
}

const inputCls =
  'rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-neutral-500 focus:outline-none'

export function PlanForm({ form, setForm, movies, moviesLoading, submitting, onSubmit }: Props) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [geoBusy, setGeoBusy] = useState(false)
  const today = todayJst()
  const tomorrow = addDaysJst(today, 1)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((cur) => ({ ...cur, [key]: value }))

  const useGeolocation = () => {
    if (!navigator.geolocation) return
    setGeoBusy(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeoBusy(false)
        setForm((cur) => ({
          ...cur,
          originKind: 'geo',
          originGeo: { lat: pos.coords.latitude, lng: pos.coords.longitude },
        }))
      },
      () => setGeoBusy(false),
      { timeout: 10_000 },
    )
  }

  const toggleWish = (id: string) => {
    setForm((cur) => {
      const selected = cur.wishMovieIds.includes(id) || cur.mustMovieIds.includes(id)
      if (selected) {
        return {
          ...cur,
          wishMovieIds: cur.wishMovieIds.filter((x) => x !== id),
          mustMovieIds: cur.mustMovieIds.filter((x) => x !== id),
        }
      }
      return { ...cur, wishMovieIds: [...cur.wishMovieIds, id] }
    })
  }

  // 星タップでマスト指定（最大3。F-03）
  const toggleMust = (id: string) => {
    setForm((cur) => {
      if (cur.mustMovieIds.includes(id)) {
        return { ...cur, mustMovieIds: cur.mustMovieIds.filter((x) => x !== id) }
      }
      if (cur.mustMovieIds.length >= 3) return cur
      return {
        ...cur,
        mustMovieIds: [...cur.mustMovieIds, id],
        wishMovieIds: cur.wishMovieIds.includes(id) ? cur.wishMovieIds : [...cur.wishMovieIds, id],
      }
    })
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-neutral-200 bg-white p-4 shadow-sm"
      onSubmit={(e) => {
        e.preventDefault()
        onSubmit()
      }}
    >
      {/* 日付 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-sm font-semibold">日付</span>
        <button
          type="button"
          onClick={() => set('date', today)}
          className={`rounded-full px-3 py-1 text-sm ${form.date === today ? 'bg-neutral-900 text-white' : 'border border-neutral-300'}`}
        >
          今日
        </button>
        <button
          type="button"
          onClick={() => set('date', tomorrow)}
          className={`rounded-full px-3 py-1 text-sm ${form.date === tomorrow ? 'bg-neutral-900 text-white' : 'border border-neutral-300'}`}
        >
          明日
        </button>
        <input
          type="date"
          value={form.date}
          min={today}
          onChange={(e) => set('date', e.target.value)}
          className={inputCls}
          aria-label="対象日"
        />
      </div>

      {/* 時間帯 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-sm font-semibold">時間帯</span>
        <input
          type="time"
          value={form.timeStart}
          onChange={(e) => set('timeStart', e.target.value)}
          className={inputCls}
          aria-label="開始時刻"
        />
        <span>〜</span>
        <input
          type="time"
          value={form.timeEnd}
          onChange={(e) => set('timeEnd', e.target.value)}
          className={inputCls}
          aria-label="終了時刻"
        />
      </div>

      {/* スタート地点 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-sm font-semibold">スタート</span>
        <input
          type="text"
          placeholder="駅名（例: 九条）"
          value={form.originStation}
          onChange={(e) =>
            setForm((cur) => ({ ...cur, originKind: 'station', originStation: e.target.value }))
          }
          className={`${inputCls} flex-1 min-w-40 ${form.originKind === 'station' ? '' : 'opacity-50'}`}
          aria-label="スタート駅名"
        />
        <button
          type="button"
          onClick={useGeolocation}
          disabled={geoBusy}
          className={`rounded-md border px-3 py-2 text-sm ${form.originKind === 'geo' && form.originGeo ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300'}`}
          title="現在地を使う"
        >
          {geoBusy ? '取得中…' : '📍 現在地'}
        </button>
      </div>
      {form.originKind === 'geo' && form.originGeo && (
        <p className="-mt-2 ml-20 pl-2 text-xs text-neutral-500">
          現在地（{form.originGeo.lat.toFixed(4)}, {form.originGeo.lng.toFixed(4)}）から出発
        </p>
      )}

      {/* ゴール地点 */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-20 shrink-0 text-sm font-semibold">ゴール</span>
        <label className="flex items-center gap-1 text-sm">
          <input
            type="checkbox"
            checked={!form.destEnabled}
            onChange={(e) => set('destEnabled', !e.target.checked)}
          />
          指定しない
        </label>
        {form.destEnabled && (
          <input
            type="text"
            placeholder="駅名"
            value={form.destStation}
            onChange={(e) => set('destStation', e.target.value)}
            className={`${inputCls} flex-1 min-w-40`}
            aria-label="ゴール駅名"
          />
        )}
      </div>

      {/* 詳細設定（折りたたみ） */}
      <div className="border-t border-neutral-100 pt-3">
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          className="text-sm text-neutral-600"
        >
          {detailOpen ? '▾' : '▸'} 詳細設定
        </button>
        {detailOpen && (
          <div className="mt-3 flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <span className="w-28 shrink-0 text-sm font-semibold">到着マージン</span>
              <select
                value={form.arrivalMarginMin}
                onChange={(e) => set('arrivalMarginMin', Number(e.target.value))}
                className={inputCls}
                aria-label="到着マージン"
              >
                {[5, 10, 15, 20, 30, 45, 60].map((m) => (
                  <option key={m} value={m}>
                    {m}分
                  </option>
                ))}
              </select>
            </div>
            <div>
              <p className="mb-2 text-sm font-semibold">
                観たい映画を選ぶ（任意）
                <span className="ml-2 font-normal text-neutral-500">
                  未選択なら全作品が候補。★でマスト指定（最大3）
                </span>
              </p>
              {moviesLoading && <p className="text-sm text-neutral-500">読み込み中…</p>}
              {!moviesLoading && movies.length === 0 && (
                <p className="text-sm text-neutral-500">この日の作品情報がありません</p>
              )}
              <div className="flex flex-wrap gap-2">
                {movies.map((m) => {
                  const selected =
                    form.wishMovieIds.includes(m.id) || form.mustMovieIds.includes(m.id)
                  const must = form.mustMovieIds.includes(m.id)
                  return (
                    <span
                      key={m.id}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm ${
                        selected
                          ? 'border-neutral-900 bg-neutral-900 text-white'
                          : 'border-neutral-300 bg-white'
                      }`}
                    >
                      <button type="button" onClick={() => toggleWish(m.id)}>
                        {m.title}
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleMust(m.id)}
                        title="マスト指定"
                        aria-label={`${m.title} をマスト指定`}
                        className={must ? 'text-amber-300' : 'opacity-50'}
                      >
                        {must ? '★' : '☆'}
                      </button>
                    </span>
                  )
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      <button
        type="submit"
        disabled={submitting}
        className="rounded-md bg-neutral-900 py-3 text-lg font-semibold text-white hover:bg-neutral-700 disabled:opacity-50"
      >
        {submitting ? '算出中…' : 'はしごプランを算出する'}
      </button>
    </form>
  )
}
