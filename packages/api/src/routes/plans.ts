import type { Plan } from '@cinema/shared'
import {
  buildIcs,
  icsFilename,
  MAX_SHARED_PLAN_LEGS,
  newId,
  SHARED_PLAN_TTL_DAYS,
  SharePlanRequest,
  toBusinessDate,
} from '@cinema/shared'
import { Hono } from 'hono'
import { getSharedPlan, insertSharedPlan } from '../db/shared-plans'
import type { Env } from '../env'

// 共有プラン（P5-1。F-12/F-13・docs/spec/04 /plans）。
// POST: 表示中の Plan を永続化して共有 URL を発行（共有ボタンを押した Plan だけを書く。設計メモ2）。
// GET: スナップショットをそのまま返す（再計算しない）。期限切れ・不存在は同じ 404（設計メモ9）。

const BODY_LIMIT_BYTES = 64 * 1024 // 設計メモ8: 認証なし公開 API の書込防御

// 不変スナップショットのため短時間の共有キャッシュを許可（設計メモ11。404 には付けない）
const CACHE_CONTROL = 'public, max-age=300'

export const plansRoute = new Hono<{ Bindings: Env }>()

plansRoute.post('/', async (c) => {
  const raw = await c.req.text()
  if (raw.length > BODY_LIMIT_BYTES) {
    return c.json({ code: 'VALIDATION_ERROR', message: 'リクエストが大きすぎます' }, 413)
  }
  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return c.json({ code: 'VALIDATION_ERROR', message: 'JSON ボディが必要です' }, 400)
  }
  const parsed = SharePlanRequest.safeParse(body)
  if (!parsed.success) {
    return c.json(
      {
        code: 'VALIDATION_ERROR',
        message: '入力が不正です',
        details: { issues: parsed.error.issues },
      },
      400,
    )
  }
  const plan = parsed.data.plan
  if (plan.legs.length > MAX_SHARED_PLAN_LEGS) {
    return c.json(
      { code: 'VALIDATION_ERROR', message: `legs は最大 ${MAX_SHARED_PLAN_LEGS} 件です` },
      400,
    )
  }
  if (!plan.legs.some((l) => l.kind === 'screening')) {
    return c.json(
      { code: 'VALIDATION_ERROR', message: '上映を1件以上含むプランのみ共有できます' },
      400,
    )
  }

  const planId = newId('pln')
  const expiresAt = new Date(Date.now() + SHARED_PLAN_TTL_DAYS * 24 * 3600 * 1000).toISOString()
  await insertSharedPlan(c.env.DB, {
    id: planId,
    // zod .parse 通過後を保存（strip 済み＝未知キーを永続化しない）
    plan_json: JSON.stringify(plan),
    expires_at: expiresAt,
  })
  const base = (c.env.WEB_BASE_URL ?? 'http://localhost:5173').replace(/\/$/, '')
  return c.json({ planId, url: `${base}/p/${planId}`, expiresAt }, 201)
})

// 期限切れは不存在と同じ 404（存在の痕跡を返さない。物理削除は P5-5 の Cron・設計メモ9）
async function loadActivePlan(env: Env, planId: string): Promise<Plan | null> {
  const row = await getSharedPlan(env.DB, planId)
  if (!row) return null
  if (new Date(row.expires_at).getTime() <= Date.now()) return null
  return JSON.parse(row.plan_json) as Plan
}

plansRoute.get('/:planId', async (c) => {
  const plan = await loadActivePlan(c.env, c.req.param('planId'))
  if (!plan) {
    return c.json({ code: 'NOT_FOUND', message: '共有プランが見つからないか期限切れです' }, 404)
  }
  return c.json(plan, 200, { 'cache-control': CACHE_CONTROL })
})

// 共有ページ用の .ics（docs/spec/04 設計メモ3。結果画面はクライアント生成で本エンドポイントを使わない）
plansRoute.get('/:planId/ics', async (c) => {
  const plan = await loadActivePlan(c.env, c.req.param('planId'))
  if (!plan) {
    return c.json({ code: 'NOT_FOUND', message: '共有プランが見つからないか期限切れです' }, 404)
  }
  const first = plan.legs.find((l) => l.kind === 'screening')
  // POST 時に screening >=1 を検証済みだが、防御的に fallback を持つ
  const date = first ? toBusinessDate(first.startAt) : 'plan'
  return c.body(buildIcs(plan), 200, {
    'content-type': 'text/calendar; charset=utf-8',
    'content-disposition': `attachment; filename="${icsFilename(date)}"`,
    'cache-control': CACHE_CONTROL,
  })
})
