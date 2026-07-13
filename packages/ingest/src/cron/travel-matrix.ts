import type { TravelMatrix as TravelMatrixT } from '@cinema/shared'
import { TRAVEL_MATRIX_KV_KEY, TravelMatrix } from '@cinema/shared'
import { addDays, todayJst } from '../db/admin-queries'
import { listAllTheaters } from '../db/theaters'
import type { Env } from '../env'
import { USER_AGENT } from '../worker/fetch'

// TravelMatrix 週次生成（P4-6・docs/03 §5.1・ADR-0014）。
// ls8h Transit API の /api/v1/plan を劇場座標 geo→geo で引き、door-to-door 所要分を
// KV `travel-matrix:v1` に保存する。planner（api）は実行時に外部 API を呼ばず KV のみ参照。
// 取得マナー: 直列・1秒以上間隔・正直 UA（ToS の「過度なリクエスト」禁止への配慮）。
// 失敗ペアは前回値を温存し、1件も取れなければ KV を上書きしない（安全弁）。

export const TRANSIT_API_DEFAULT_BASE = 'https://api.transit.ls8h.com'
const REQUEST_INTERVAL_MS = 1100
const PLAN_TIMEOUT_MS = 15_000

interface PlanJourney {
  durationSecs?: number
  accessWalkSecs?: number
  legs?: { kind?: string; routeName?: string }[]
}

export interface BuildMatrixResult {
  theaters: number
  pairs: number
  updated: number
  carried: number // 今回失敗したが前回値で埋めたペア
  missing: number // 値なし（null）のまま = planner は直線距離推定
  skippedWrite: boolean // 全滅時: KV を上書きしなかった
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

// 代表時刻: 翌日 13:00 JST（昼間ダイヤ）。実行時刻に依存させない（cron は深夜 JST のため、
// 当日 now を使うと終電後の乗継ぎで異常値になる）。
export function representativeDate(now: Date = new Date()): string {
  return addDays(todayJst(now), 1).replaceAll('-', '')
}

// 1ペア分の経路取得 → { minutes, summary } | null。
// door-to-door 分 = ceil((accessWalkSecs + durationSecs) / 60)（egress は durationSecs に含まれる。
// 実 API で確認済み・docs/03 §5.1）。複数案の最小値を採る。
export async function fetchPairMinutes(
  apiBase: string,
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  dateYyyymmdd: string,
  fetchFn: typeof fetch = fetch,
): Promise<{ minutes: number; summary: string | null } | null> {
  const params = new URLSearchParams({
    from: `geo:${from.lat},${from.lng}`,
    to: `geo:${to.lat},${to.lng}`,
    date: dateYyyymmdd,
    time: '13:00',
    numItineraries: '2',
  })
  try {
    const res = await fetchFn(`${apiBase}/api/v1/plan?${params}`, {
      headers: { 'user-agent': USER_AGENT },
      signal: AbortSignal.timeout(PLAN_TIMEOUT_MS),
    })
    if (!res.ok) return null
    const body = (await res.json()) as { journeys?: PlanJourney[] }
    const journeys = (body.journeys ?? []).filter((j) => typeof j.durationSecs === 'number')
    if (journeys.length === 0) return null
    let best: PlanJourney | null = null
    let bestSecs = Number.POSITIVE_INFINITY
    for (const j of journeys) {
      const secs = (j.accessWalkSecs ?? 0) + (j.durationSecs ?? 0)
      if (secs < bestSecs) {
        bestSecs = secs
        best = j
      }
    }
    if (!best) return null
    const lines = (best.legs ?? [])
      .filter((l) => l.kind === 'transit' && l.routeName)
      .map((l) => l.routeName as string)
    return { minutes: Math.ceil(bestSecs / 60), summary: lines.length > 0 ? lines.join('→') : null }
  } catch {
    return null
  }
}

export async function buildTravelMatrix(
  env: Env,
  opts?: { intervalMs?: number; now?: Date; fetchFn?: typeof fetch },
): Promise<BuildMatrixResult> {
  const apiBase = env.TRANSIT_API_BASE ?? TRANSIT_API_DEFAULT_BASE
  const intervalMs = opts?.intervalMs ?? REQUEST_INTERVAL_MS
  const fetchFn = opts?.fetchFn ?? fetch
  const date = representativeDate(opts?.now)

  // retired 以外（paused 含む: 受入中の劇場も active 昇格前に行列を持てる）
  const theaters = (await listAllTheaters(env.DB)).filter((t) => t.status !== 'retired')
  const ids = theaters.map((t) => t.id)

  // 前回行列（失敗ペアの温存用）
  const oldRaw = await env.KV.get(TRAVEL_MATRIX_KV_KEY, 'json')
  const old = oldRaw ? TravelMatrix.safeParse(oldRaw) : null
  const oldIdx = new Map<string, number>(
    (old?.success ? old.data.theaters : []).map((id, i) => [id, i]),
  )
  const oldAt = (a: string, b: string): number | null => {
    if (!old?.success) return null
    const ia = oldIdx.get(a)
    const ib = oldIdx.get(b)
    const v = ia !== undefined && ib !== undefined ? old.data.matrix[ia]?.[ib] : null
    return typeof v === 'number' ? v : null
  }

  const n = ids.length
  const matrix: (number | null)[][] = Array.from({ length: n }, () => Array(n).fill(null))
  const summaries: Record<string, string> = { ...(old?.success ? old.data.summaries : undefined) }
  let updated = 0
  let carried = 0
  let missing = 0
  let first = true

  for (let i = 0; i < n; i++) {
    const row = matrix[i]
    if (!row) continue
    row[i] = 0
    for (let j = 0; j < n; j++) {
      if (i === j) continue
      if (!first) await sleep(intervalMs)
      first = false
      const a = theaters[i]
      const b = theaters[j]
      if (!a || !b) continue
      const r = await fetchPairMinutes(
        apiBase,
        { lat: a.lat, lng: a.lng },
        { lat: b.lat, lng: b.lng },
        date,
        fetchFn,
      )
      if (r) {
        row[j] = r.minutes
        if (r.summary) summaries[`${a.id}>${b.id}`] = r.summary
        updated++
      } else {
        const prev = oldAt(a.id, b.id)
        if (prev !== null) {
          row[j] = prev
          carried++
        } else {
          missing++
        }
      }
    }
  }

  const pairs = n * (n - 1)
  // 全滅（1ペアも取れず前回値も無い状態で上書きすると劣化するだけ）→ 書き込まない
  const skippedWrite = pairs > 0 && updated === 0 && carried === 0
  if (!skippedWrite) {
    const value: TravelMatrixT = {
      generatedAt: (opts?.now ?? new Date()).toISOString(),
      unit: 'minutes',
      theaters: ids,
      matrix,
      summaries,
    }
    await env.KV.put(TRAVEL_MATRIX_KV_KEY, JSON.stringify(TravelMatrix.parse(value)))
  }
  return { theaters: n, pairs, updated, carried, missing, skippedWrite }
}

// 管理サイト・ダッシュボード表示用のメタ情報（P4-6）
export interface TravelMatrixMeta {
  generatedAt: string
  theaters: number
  missing: number
}

export async function readTravelMatrixMeta(kv: KVNamespace): Promise<TravelMatrixMeta | null> {
  const raw = await kv.get(TRAVEL_MATRIX_KV_KEY, 'json')
  const parsed = raw ? TravelMatrix.safeParse(raw) : null
  if (!parsed?.success) return null
  const m = parsed.data
  let missing = 0
  for (let i = 0; i < m.theaters.length; i++) {
    for (let j = 0; j < m.theaters.length; j++) {
      if (i !== j && typeof m.matrix[i]?.[j] !== 'number') missing++
    }
  }
  return { generatedAt: m.generatedAt, theaters: m.theaters.length, missing }
}
