import type { Plan } from '@cinema/shared'
import { describe, expect, it } from 'vitest'
import app from '../../index'

// 共有プラン API（P5-1。F-12/F-13・docs/04 /plans + 設計メモ8〜11）。
// フェイク D1（インメモリ）で app 全体（CORS/rate-limit 込みの実配線）越しに検証する。

interface StoredRow {
  id: string
  plan_json: string
  expires_at: string
}

function createFakeDb(seed: StoredRow[] = []) {
  const rows = new Map<string, StoredRow>(seed.map((r) => [r.id, r]))
  const db = {
    prepare(sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              if (!/INSERT INTO shared_plans/.test(sql)) throw new Error(`unexpected run: ${sql}`)
              const [id, planJson, expiresAt] = args as [string, string, string]
              rows.set(id, { id, plan_json: planJson, expires_at: expiresAt })
              return { success: true }
            },
            async first() {
              if (!/FROM shared_plans/.test(sql)) throw new Error(`unexpected first: ${sql}`)
              return rows.get(args[0] as string) ?? null
            },
          }
        },
      }
    },
  } as unknown as D1Database
  return { db, rows }
}

function validPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    label: 'most_movies',
    stats: {
      movieCount: 1,
      totalTravelMin: 15,
      totalWaitMin: 0,
      endTime: '2026-08-01T03:45:00.000Z',
    },
    legs: [
      {
        kind: 'travel',
        fromTheaterId: null,
        toTheaterId: 'thr_a',
        departAt: '2026-08-01T01:10:00.000Z',
        arriveAt: '2026-08-01T01:25:00.000Z',
        durationMin: 15,
        summary: null,
      },
      {
        kind: 'screening',
        theaterId: 'thr_a',
        theaterName: 'シネ・ヌーヴォ',
        movieId: 'mov_a',
        movieTitle: '霧のごとく',
        format: null,
        startAt: '2026-08-01T01:30:00.000Z', // JST 10:30 → businessDate 2026-08-01
        endAt: '2026-08-01T03:45:00.000Z',
        officialUrl: 'http://www.cinenouveau.com/',
      },
    ],
    ...overrides,
  }
}

function env(db: D1Database, extra: Record<string, unknown> = {}) {
  return { DB: db, APP_ENV: 'test', WEB_BASE_URL: 'https://web.example.com', ...extra }
}

async function post(db: D1Database, body: unknown, extra: Record<string, unknown> = {}) {
  return app.request(
    '/v1/plans',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    },
    env(db, extra),
  )
}

describe('POST /v1/plans', () => {
  it('201: planId(pln_)・url({WEB_BASE_URL}/p/{id})・expiresAt(+30日) を返し D1 に保存する', async () => {
    const { db, rows } = createFakeDb()
    const before = Date.now()
    const res = await post(db, { plan: validPlan() })
    expect(res.status).toBe(201)
    const body = (await res.json()) as { planId: string; url: string; expiresAt: string }
    expect(body.planId).toMatch(/^pln_[1-9A-HJ-NP-Za-km-z]{12}$/)
    expect(body.url).toBe(`https://web.example.com/p/${body.planId}`)
    const ttlMs = new Date(body.expiresAt).getTime() - before
    expect(ttlMs).toBeGreaterThan(29.9 * 24 * 3600 * 1000)
    expect(ttlMs).toBeLessThan(30.1 * 24 * 3600 * 1000)
    const stored = rows.get(body.planId)
    expect(stored).toBeDefined()
    expect(JSON.parse(stored?.plan_json ?? '{}')).toEqual(validPlan())
  })

  it('WEB_BASE_URL の末尾スラッシュは正規化される（// にならない）', async () => {
    const { db } = createFakeDb()
    const res = await post(db, { plan: validPlan() }, { WEB_BASE_URL: 'https://web.example.com/' })
    const body = (await res.json()) as { planId: string; url: string }
    expect(body.url).toBe(`https://web.example.com/p/${body.planId}`)
  })

  it('zod 通過時に未知キーは strip され永続化されない', async () => {
    const { db, rows } = createFakeDb()
    const res = await post(db, { plan: { ...validPlan(), evil: 'x' } })
    expect(res.status).toBe(201)
    const { planId } = (await res.json()) as { planId: string }
    expect(JSON.parse(rows.get(planId)?.plan_json ?? '{}')).not.toHaveProperty('evil')
  })

  it('400: JSON でないボディ', async () => {
    const { db } = createFakeDb()
    const res = await post(db, 'not-json')
    expect(res.status).toBe(400)
    expect(((await res.json()) as { code: string }).code).toBe('VALIDATION_ERROR')
  })

  it('400: zod 不正（legs の leg が壊れている）', async () => {
    const { db } = createFakeDb()
    const res = await post(db, { plan: { ...validPlan(), legs: [{ kind: 'screening' }] } })
    expect(res.status).toBe(400)
  })

  it('400: screening を1件も含まないプランは共有できない（設計メモ8）', async () => {
    const { db } = createFakeDb()
    const plan = validPlan()
    plan.legs = plan.legs.filter((l) => l.kind !== 'screening')
    const res = await post(db, { plan })
    expect(res.status).toBe(400)
  })

  it('400: legs が上限 50 を超える（設計メモ8）', async () => {
    const { db } = createFakeDb()
    const plan = validPlan()
    const wait = { kind: 'wait' as const, minutes: 5 }
    plan.legs = [...plan.legs, ...Array.from({ length: 49 }, () => ({ ...wait }))]
    const res = await post(db, { plan })
    expect(res.status).toBe(400)
  })

  it('413: ボディ 64KB 超（設計メモ8）', async () => {
    const { db } = createFakeDb()
    const res = await post(db, `{"plan":"${'x'.repeat(64 * 1024)}"}`)
    expect(res.status).toBe(413)
  })
})

function seeded(plan: Plan, expiresAt: string): StoredRow {
  return { id: 'pln_TestSeed0001', plan_json: JSON.stringify(plan), expires_at: expiresAt }
}
const FUTURE = new Date(Date.now() + 86400_000).toISOString()
const PAST = new Date(Date.now() - 1000).toISOString()

describe('GET /v1/plans/:planId', () => {
  it('200: スナップショットをそのまま返す（cache-control 付き。設計メモ11）', async () => {
    const { db } = createFakeDb([seeded(validPlan(), FUTURE)])
    const res = await app.request('/v1/plans/pln_TestSeed0001', {}, env(db))
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('public, max-age=300')
    expect((await res.json()) as Plan).toEqual(validPlan())
  })

  it('404: 不存在（NOT_FOUND・キャッシュしない）', async () => {
    const { db } = createFakeDb()
    const res = await app.request('/v1/plans/pln_ZZZZZZZZZZZZ', {}, env(db))
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND')
    expect(res.headers.get('cache-control')).toBeNull()
  })

  it('404: 期限切れは不存在と同じ応答（存在の痕跡を返さない。設計メモ9）', async () => {
    const { db } = createFakeDb([seeded(validPlan(), PAST)])
    const res = await app.request('/v1/plans/pln_TestSeed0001', {}, env(db))
    expect(res.status).toBe(404)
    expect(((await res.json()) as { code: string }).code).toBe('NOT_FOUND')
  })
})

describe('GET /v1/plans/:planId/ics', () => {
  it('200: text/calendar・興行日ファイル名・VEVENT は screening のみ', async () => {
    const { db } = createFakeDb([seeded(validPlan(), FUTURE)])
    const res = await app.request('/v1/plans/pln_TestSeed0001/ics', {}, env(db))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/calendar; charset=utf-8')
    expect(res.headers.get('content-disposition')).toBe(
      'attachment; filename="hashigo-2026-08-01.ics"',
    )
    const ics = await res.text()
    expect(ics).toContain('BEGIN:VCALENDAR')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1) // travel leg は VEVENT にならない
    expect(ics).toContain('SUMMARY:🎬 霧のごとく')
  })

  it('404: 期限切れ', async () => {
    const { db } = createFakeDb([seeded(validPlan(), PAST)])
    const res = await app.request('/v1/plans/pln_TestSeed0001/ics', {}, env(db))
    expect(res.status).toBe(404)
  })
})
