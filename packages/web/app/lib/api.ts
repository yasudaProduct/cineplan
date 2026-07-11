import { Movie, type PlanRequest, PlanResponse } from '@cinema/shared'
import { z } from 'zod'

// コア API クライアント（docs/04）。型は @cinema/shared の zod が単一の真実。
// API ベース URL はビルド時の VITE_API_BASE（未指定はローカル api dev の :8788）。
const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? 'http://localhost:8788'

export type ApiFailure = { ok: false; status: number; code: string; message: string }
export type ApiResult<T> = { ok: true; data: T } | ApiFailure

async function toFailure(res: Response): Promise<ApiFailure> {
  try {
    const body = (await res.json()) as { code?: string; message?: string }
    return {
      ok: false,
      status: res.status,
      code: body.code ?? 'UNKNOWN',
      message: body.message ?? res.statusText,
    }
  } catch {
    return { ok: false, status: res.status, code: 'UNKNOWN', message: res.statusText }
  }
}

const MoviesResponse = z.object({ movies: z.array(Movie) })

export async function fetchMovies(date: string): Promise<ApiResult<Movie[]>> {
  try {
    const res = await fetch(`${API_BASE}/v1/movies?date=${encodeURIComponent(date)}`)
    if (!res.ok) return toFailure(res)
    return { ok: true, data: MoviesResponse.parse(await res.json()).movies }
  } catch (e) {
    return { ok: false, status: 0, code: 'NETWORK', message: (e as Error).message }
  }
}

export async function postPlan(req: PlanRequest): Promise<ApiResult<PlanResponse>> {
  try {
    const res = await fetch(`${API_BASE}/v1/plan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
    })
    if (!res.ok) return toFailure(res)
    return { ok: true, data: PlanResponse.parse(await res.json()) }
  } catch (e) {
    return { ok: false, status: 0, code: 'NETWORK', message: (e as Error).message }
  }
}
