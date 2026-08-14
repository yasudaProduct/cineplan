import type { Movie } from '@cinema/shared'
import { useMemo, useState } from 'react'
import { addDaysJst, formatDuration, todayJst } from '../lib/time'
import type { FormState } from '../routes/plan'
import { IconChevron, IconMapPin, IconSearch, IconStar } from './icons'

// プラン作成フォーム（07 §1.3）。日付・時間帯・スタート/ゴール・観たい映画・詳細設定（マージン）。
// 作品選択は詳細設定の外の常設セクション（07 §1.3。MoviePicker に分離）。

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
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-2 text-sm ${form.originKind === 'geo' && form.originGeo ? 'border-neutral-900 bg-neutral-900 text-white' : 'border-neutral-300'}`}
          title="現在地を使う"
        >
          <IconMapPin className="shrink-0" />
          {geoBusy ? '取得中…' : '現在地'}
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

      {/* 観たい映画（常設セクション。07 §1.3） */}
      <MoviePicker form={form} setForm={setForm} movies={movies} moviesLoading={moviesLoading} />

      {/* 詳細設定（折りたたみ） */}
      <div className="border-t border-neutral-100 pt-3">
        <button
          type="button"
          onClick={() => setDetailOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-sm text-neutral-600"
        >
          <IconChevron open={detailOpen} className="text-neutral-400" />
          詳細設定
        </button>
        {detailOpen && (
          <div className="mt-3 flex items-center gap-2">
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

// ---- 観たい映画セクション ----

const SEARCH_THRESHOLD = 8 // これ以上の作品数で絞り込み入力を出す（07 §1.3）

interface PickerProps {
  form: FormState
  setForm: React.Dispatch<React.SetStateAction<FormState>>
  movies: Movie[]
  moviesLoading: boolean
}

function MoviePicker({ form, setForm, movies, moviesLoading }: PickerProps) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return movies
    return movies.filter((m) => m.title.toLowerCase().includes(q))
  }, [movies, query])

  const selectedCount = form.wishMovieIds.length
  const mustCount = form.mustMovieIds.length
  const mustFull = mustCount >= 3

  // 行タップで候補（wish）指定を切替。解除時は must も外す
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

  // 「マスト」ボタンで must 指定（最大3。F-03）。must は wish を兼ねる
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

  const clearAll = () => setForm((cur) => ({ ...cur, wishMovieIds: [], mustMovieIds: [] }))

  return (
    <div className="border-t border-neutral-100 pt-3">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className="text-sm font-semibold">
          観たい映画
          <span className="ml-1.5 font-normal text-neutral-400">任意</span>
        </p>
        {selectedCount > 0 ? (
          <p className="flex items-center gap-2 text-xs text-neutral-600">
            <span>
              {selectedCount}作品を候補に指定
              {mustCount > 0 && `（マスト ${mustCount}/3）`}
            </span>
            <button
              type="button"
              onClick={clearAll}
              className="text-neutral-500 underline hover:text-neutral-700"
            >
              選択解除
            </button>
          </p>
        ) : (
          <p className="text-xs text-neutral-500">未選択なら全作品から自動で選びます</p>
        )}
      </div>

      {moviesLoading && (
        <div className="flex flex-col gap-1.5" role="status" aria-label="作品を読み込み中">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-10 animate-pulse rounded-md bg-neutral-100" />
          ))}
        </div>
      )}
      {!moviesLoading && movies.length === 0 && (
        <p className="rounded-md border border-dashed border-neutral-300 px-3 py-4 text-center text-sm text-neutral-500">
          この日の作品情報がありません
        </p>
      )}

      {!moviesLoading && movies.length > 0 && (
        <>
          {movies.length > SEARCH_THRESHOLD && (
            <div className="relative mb-2">
              <IconSearch className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-neutral-400" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="作品名で絞り込み"
                aria-label="作品名で絞り込み"
                className="w-full rounded-md border border-neutral-300 bg-white py-2 pr-3 pl-9 text-sm focus:border-neutral-500 focus:outline-none"
              />
            </div>
          )}

          <ul className="max-h-72 divide-y divide-neutral-100 overflow-y-auto rounded-md border border-neutral-200">
            {filtered.map((m) => {
              const must = form.mustMovieIds.includes(m.id)
              const selected = form.wishMovieIds.includes(m.id) || must
              return (
                <li key={m.id} className={`flex items-stretch ${selected ? 'bg-neutral-50' : ''}`}>
                  <button
                    type="button"
                    onClick={() => toggleWish(m.id)}
                    aria-pressed={selected}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left"
                  >
                    <span
                      aria-hidden="true"
                      className={`flex size-5 shrink-0 items-center justify-center rounded border text-white ${
                        selected
                          ? 'border-neutral-900 bg-neutral-900'
                          : 'border-neutral-300 bg-white'
                      }`}
                    >
                      {selected && <CheckMark />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{m.title}</span>
                      {m.runtimeMin != null && (
                        <span className="block text-xs text-neutral-500">
                          {formatDuration(m.runtimeMin)}
                        </span>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleMust(m.id)}
                    disabled={!must && mustFull}
                    aria-pressed={must}
                    aria-label={`${m.title} をマスト指定`}
                    title={!must && mustFull ? 'マストは最大3作品です' : '必ず観る作品として指定'}
                    className={`my-2 mr-3 inline-flex shrink-0 items-center gap-1 self-center rounded-full border px-2.5 py-1 text-xs font-semibold ${
                      must
                        ? 'border-amber-500 bg-amber-500 text-white'
                        : 'border-neutral-300 bg-white text-neutral-500 hover:border-amber-400 hover:text-amber-600 disabled:opacity-40 disabled:hover:border-neutral-300 disabled:hover:text-neutral-500'
                    }`}
                  >
                    <IconStar filled={must} strokeWidth={must ? 0 : 2} />
                    マスト
                  </button>
                </li>
              )
            })}
            {filtered.length === 0 && (
              <li className="px-3 py-4 text-center text-sm text-neutral-500">
                「{query}」に一致する作品はありません
              </li>
            )}
          </ul>
          <p className="mt-1.5 text-xs text-neutral-400">
            行をタップで候補に指定。「マスト」は必ず組み込む作品（最大3）
          </p>
        </>
      )}
    </div>
  )
}

function CheckMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="0.75em"
      height="0.75em"
      fill="none"
      stroke="currentColor"
      strokeWidth={3.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}
