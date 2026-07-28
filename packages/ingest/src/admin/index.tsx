import { TheaterStatus, TheaterUpsert } from '@cinema/shared'
import { Hono } from 'hono'
import { runRetention } from '../cron/retention'
import { buildTravelMatrix, readTravelMatrixMeta } from '../cron/travel-matrix'
import { jstDayStartIso, loadDashboard, todayJst } from '../db/admin-queries'
import {
  countTodaySiteFetches,
  getRun,
  listRuns,
  reapStaleRuns,
  recentRunsForTheater,
} from '../db/ingest-runs'
import {
  approveReview,
  getReview,
  listReviews,
  ReviewNotPendingError,
  rejectReview,
} from '../db/reviews'
import { listScreeningDates, listScreeningsForDate, pickDefaultDate } from '../db/screenings'
import {
  createTheater,
  getTheater,
  listAllTheaters,
  updateTheater,
  updateTheaterStatus,
} from '../db/theaters'
import type { Env } from '../env'
import { logError, logInfo } from '../log'
import { assertComplianceGate } from '../worker/compliance-guard'
import { ComplianceGateError, TheaterNotFoundError } from '../worker/errors'
import { ingestTheater } from '../worker/pipeline'
import { Layout } from './components'
import { adminGuard } from './guard'
import { DashboardPage } from './pages/dashboard'
import { ReviewDetailPage, ReviewListPage } from './pages/reviews'
import { RunDetailPage, RunListPage } from './pages/runs'
import { ScreeningsPage } from './pages/screenings'
import { TheaterEditPage, TheaterListPage, TheaterNewPage } from './pages/theaters'

// 管理サイト（docs/07 §2）。エッジの Cloudflare Access（P4-1）+ コード側 adminGuard の多層。
// SSR のみ・フォーム POST → リダイレクト（PRG）。クライアント JS なし（docs/07 §3）。
export const adminApp = new Hono<{ Bindings: Env }>()

adminApp.use('*', adminGuard)

const env = (c: { env: Env }) => c.env.APP_ENV ?? 'local'

// ---- 手動取込 API（P1-6 から継続。curl 用。UI とは別に残す）----
// POST /admin/ingest?theaterId=thr_xxx
adminApp.post('/ingest', async (c) => {
  if (c.env.APP_ENV === 'prod') return c.text('forbidden (prod は cron)', 403)
  const theaterId = c.req.query('theaterId')
  if (!theaterId) return c.json({ error: 'theaterId required' }, 400)
  try {
    logInfo('admin.ingest.sync', { theaterId })
    const result = await ingestTheater(c.env, theaterId, 'manual')
    return c.json(result)
  } catch (e) {
    if (e instanceof TheaterNotFoundError) return c.json({ error: e.message }, 404)
    if (e instanceof ComplianceGateError) return c.json({ error: e.message }, 403)
    throw e
  }
})

// ---- ダッシュボード（P4-2）----
adminApp.get('/', async (c) => {
  // 孤児run の掃除（fix/p4-manual-ingest-orphan）。掃除した run はログに残す。
  const reaped = await reapStaleRuns(c.env.DB)
  if (reaped.length > 0) logInfo('reap.done', { count: reaped.length, runIds: reaped })
  const d = await loadDashboard(c.env.DB)
  const matrix = await readTravelMatrixMeta(c.env.KV)
  return c.html(
    <Layout title="ダッシュボード" active="dashboard" env={env(c)}>
      <DashboardPage d={d} matrix={matrix} msg={c.req.query('msg')} err={c.req.query('err')} />
    </Layout>,
  )
})

// TravelMatrix 手動再生成（P4-6・ADR-0014）。外部は経路探索 API のみ（先方劇場サイトへは
// アクセスしないため prod でも実行可）。劇場数 n の直列リクエスト n(n-1) 件・1秒間隔。
adminApp.post('/travel-matrix/rebuild', async (c) => {
  logInfo('admin.matrix.rebuild', {})
  const r = await buildTravelMatrix(c.env)
  const msg = `TravelMatrix 再生成: ${r.theaters}劇場 ${r.pairs}ペア（更新${r.updated}/温存${r.carried}/欠損${r.missing}${r.skippedWrite ? '・全滅のため未書込' : ''}）`
  return c.redirect(`/admin?msg=${encodeURIComponent(msg)}`)
})

// データ保持の期限削除を手動実行（P5-5・docs/11 §7）。prod は日次 Cron が回すが、
// Cron を持たない ST での検証・随時実行用に置く（外部アクセスなし・D1 の削除のみ）。
adminApp.post('/retention/run', async (c) => {
  const r = await runRetention(c.env.DB)
  logInfo('retention.done', { ...r, trigger: 'manual' })
  const msg = `データ保持削除: screenings ${r.screenings} / reviews ${r.reviews} / runs ${r.ingestRuns} / sharedPlans ${r.sharedPlans} 件`
  return c.redirect(`/admin?msg=${encodeURIComponent(msg)}`)
})

// ---- 劇場マスタ（P4-3）----
adminApp.get('/theaters', async (c) => {
  const theaters = await listAllTheaters(c.env.DB)
  const lastRuns = new Map<string, { status: string; started_at: string }>()
  for (const t of theaters) {
    const [last] = await recentRunsForTheater(c.env.DB, t.id, 1)
    if (last) lastRuns.set(t.id, last)
  }
  return c.html(
    <Layout title="劇場マスタ" active="theaters" env={env(c)}>
      <TheaterListPage
        theaters={theaters}
        lastRuns={lastRuns}
        msg={c.req.query('msg')}
        err={c.req.query('err')}
      />
    </Layout>,
  )
})

adminApp.get('/theaters/new', (c) =>
  c.html(
    <Layout title="新規劇場" active="theaters" env={env(c)}>
      <TheaterNewPage err={c.req.query('err')} />
    </Layout>,
  ),
)

// フォーム値 → TheaterUpsert（空文字は null に・date は UTC 00:00 の ISO に整形）
async function parseTheaterForm(c: { req: { formData: () => Promise<FormData> } }) {
  const f = await c.req.formData()
  const s = (name: string): string => String(f.get(name) ?? '').trim()
  const date = s('termsCheckedAt')
  return TheaterUpsert.safeParse({
    name: s('name'),
    shortName: s('shortName') || null,
    lat: s('lat'),
    lng: s('lng'),
    nearestStation: s('nearestStation'),
    walkMinFromSta: s('walkMinFromSta'),
    scheduleUrl: s('scheduleUrl'),
    fetchMethod: s('fetchMethod'),
    extractMethod: s('extractMethod'),
    fetchDayMode: s('fetchDayMode'),
    fetchDays: s('fetchDays'),
    officialUrl: s('officialUrl'),
    termsNote: s('termsNote') || null,
    termsCheckedAt: date ? `${date}T00:00:00.000Z` : null,
    robotsStatus: s('robotsStatus'),
  })
}

adminApp.post('/theaters', async (c) => {
  const parsed = await parseTheaterForm(c)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' / ')
    return c.redirect(`/admin/theaters/new?err=${encodeURIComponent(msg)}`)
  }
  const id = await createTheater(c.env.DB, parsed.data)
  return c.redirect(`/admin/theaters/${id}?msg=${encodeURIComponent('paused で登録しました')}`)
})

adminApp.get('/theaters/:id', async (c) => {
  const id = c.req.param('id')
  const t = await getTheater(c.env.DB, id)
  if (!t) return c.notFound()
  const recentRuns = await recentRunsForTheater(c.env.DB, id, 10)
  const todayFetches = await countTodaySiteFetches(c.env.DB, id, jstDayStartIso(todayJst()))
  return c.html(
    <Layout title={t.name} active="theaters" env={env(c)}>
      <TheaterEditPage
        t={t}
        recentRuns={recentRuns}
        todayFetches={todayFetches}
        isProd={c.env.APP_ENV === 'prod'}
        msg={c.req.query('msg')}
        err={c.req.query('err')}
      />
    </Layout>,
  )
})

adminApp.post('/theaters/:id', async (c) => {
  const id = c.req.param('id')
  const t = await getTheater(c.env.DB, id)
  if (!t) return c.notFound()
  const parsed = await parseTheaterForm(c)
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(' / ')
    return c.redirect(`/admin/theaters/${id}?err=${encodeURIComponent(msg)}`)
  }
  await updateTheater(c.env.DB, id, parsed.data)
  return c.redirect(`/admin/theaters/${id}?msg=${encodeURIComponent('保存しました')}`)
})

// status 変更。active 昇格は robots/terms のゲートをサーバ側で強制（docs/08 §0 ルール5）。
adminApp.post('/theaters/:id/status', async (c) => {
  const id = c.req.param('id')
  const t = await getTheater(c.env.DB, id)
  if (!t) return c.notFound()
  const f = await c.req.formData()
  const parsed = TheaterStatus.safeParse(String(f.get('status') ?? ''))
  if (!parsed.success) return c.redirect(`/admin/theaters/${id}?err=invalid+status`)
  if (parsed.data === 'active' && (t.robotsStatus !== 'allowed' || !t.termsCheckedAt)) {
    const msg = `active 昇格不可: robots_status=allowed かつ terms_checked_at 記入済みが必要です（現在 robots=${t.robotsStatus}, terms=${t.termsCheckedAt ?? '未確認'}。docs/08 §0 ルール5）`
    return c.redirect(`/admin/theaters/${id}?err=${encodeURIComponent(msg)}`)
  }
  await updateTheaterStatus(c.env.DB, id, parsed.data)
  logInfo('admin.theater.status', { theaterId: id, from: t.status, to: parsed.data })
  return c.redirect(
    `/admin/theaters/${id}?msg=${encodeURIComponent(`status を ${parsed.data} にしました`)}`,
  )
})

// 手動取込（F-33。先方サイトへアクセスする）。prod は cron のみ。
// 同一サイト1日1回（docs/08 §3）: 本日取得済みなら force チェック（人間の明示判断）を要求。
// Queue に trigger='manual' で投入し cron と同じ consumer 経路で処理する
// （fix/p4-manual-ingest-orphan・docs/06 §7）。ブラウザ接続に処理を同期させないため、
// 接続断で run が extracting のまま孤児化する不具合が起きない。
// コンプライアンスチェックはここで即時実行（ユーザーへの即時フィードバック用）+
// Queue消費時にも ingestTheater 内で再実行される（cron と同じ多層防御。compliance-guard.ts）。
adminApp.post('/theaters/:id/ingest', async (c) => {
  const id = c.req.param('id')
  if (c.env.APP_ENV === 'prod') {
    return c.redirect(`/admin/theaters/${id}?err=${encodeURIComponent('prod は cron のみ')}`)
  }
  const t = await getTheater(c.env.DB, id)
  if (!t) return c.notFound()
  try {
    assertComplianceGate(t, 'manual')
  } catch (e) {
    if (e instanceof ComplianceGateError) {
      return c.redirect(`/admin/theaters/${id}?err=${encodeURIComponent(e.message)}`)
    }
    throw e
  }
  const f = await c.req.formData()
  const force = f.get('force') === '1'
  const todayFetches = await countTodaySiteFetches(c.env.DB, id, jstDayStartIso(todayJst()))
  if (todayFetches > 0 && !force) {
    const msg = `本日すでに ${todayFetches} 回取得済みです。2回目を実行するには「許可する」にチェックしてください（docs/08 §3）`
    return c.redirect(`/admin/theaters/${id}?err=${encodeURIComponent(msg)}`)
  }
  await c.env.INGEST_QUEUE.send({ theaterId: id, trigger: 'manual' })
  logInfo('admin.enqueue.ingest', { theaterId: id, force, todayFetches })
  const msg =
    '取込をキューに投入しました。数秒後にページを更新すると直近の取込に結果が反映されます。'
  return c.redirect(`/admin/theaters/${id}?msg=${encodeURIComponent(msg)}`)
})

// ---- 取込履歴（P4-4）----
adminApp.get('/runs', async (c) => {
  const theaterId = c.req.query('theaterId') || undefined
  const status = c.req.query('status') || undefined
  const page = Math.max(1, Number(c.req.query('page') ?? '1') || 1)
  const runs = await listRuns(c.env.DB, { theaterId, status, limit: 50, offset: (page - 1) * 50 })
  const theaters = await listAllTheaters(c.env.DB)
  return c.html(
    <Layout title="取込履歴" active="runs" env={env(c)}>
      <RunListPage
        runs={runs}
        theaters={theaters}
        filter={{ theaterId, status, page }}
        msg={c.req.query('msg')}
        err={c.req.query('err')}
      />
    </Layout>,
  )
})

// run の R2 スナップショット一覧（.html + 画像）
async function listSnapshotKeys(env: Env, snapshotKey: string | null): Promise<string[]> {
  if (!snapshotKey) return []
  const keys: string[] = []
  const html = await env.SNAPSHOTS.head(`${snapshotKey}.html`)
  if (html) keys.push(`${snapshotKey}.html`)
  const listed = await env.SNAPSHOTS.list({ prefix: `${snapshotKey}_` })
  keys.push(...listed.objects.map((o) => o.key).sort())
  return keys
}

adminApp.get('/runs/:id', async (c) => {
  const run = await getRun(c.env.DB, c.req.param('id'))
  if (!run) return c.notFound()
  const theater = await getTheater(c.env.DB, run.theater_id)
  const snapshotKeys = await listSnapshotKeys(c.env, run.snapshot_key)
  return c.html(
    <Layout title="取込詳細" active="runs" env={env(c)}>
      <RunDetailPage
        run={run}
        theaterName={theater?.name ?? run.theater_id}
        snapshotKeys={snapshotKeys}
        msg={c.req.query('msg')}
        err={c.req.query('err')}
      />
    </Layout>,
  )
})

// R2 再抽出（F-21。先方再取得なし）。prod でも実行可（サイトアクセスが無いため）。
// Queue に {reextractRunId} で投入し cron/手動取込と同じ consumer 経路で処理する
// （fix/reextract-orphan・docs/06 §7）。ブラウザ接続に処理を同期させないため、大きな
// rendered ページで抽出（Gemini呼出）が数分かかっても接続断で孤児化しない。
adminApp.post('/runs/:id/reextract', async (c) => {
  const id = c.req.param('id')
  await c.env.INGEST_QUEUE.send({ reextractRunId: id })
  logInfo('admin.enqueue.reextract', { sourceRunId: id })
  const msg =
    '再抽出をキューに投入しました。数秒後に劇場詳細の直近取込一覧を更新すると結果が反映されます。'
  return c.redirect(`/admin/runs/${id}?msg=${encodeURIComponent(msg)}`)
})

// ---- レビューキュー（P4-5）----
adminApp.get('/reviews', async (c) => {
  const filter = c.req.query('status') === 'all' ? 'all' : 'pending'
  const reviews = await listReviews(c.env.DB, filter)
  return c.html(
    <Layout title="レビューキュー" active="reviews" env={env(c)}>
      <ReviewListPage
        reviews={reviews}
        filter={filter}
        msg={c.req.query('msg')}
        err={c.req.query('err')}
      />
    </Layout>,
  )
})

adminApp.get('/reviews/:id', async (c) => {
  const review = await getReview(c.env.DB, c.req.param('id'))
  if (!review) return c.notFound()
  const keys = await listSnapshotKeys(c.env, review.snapshot_key)
  const imageKeys = keys.filter((k) => !k.endsWith('.html'))
  return c.html(
    <Layout title="レビュー詳細" active="reviews" env={env(c)}>
      <ReviewDetailPage
        review={review}
        imageKeys={imageKeys}
        msg={c.req.query('msg')}
        err={c.req.query('err')}
      />
    </Layout>,
  )
})

adminApp.post('/reviews/:id/approve', async (c) => {
  const id = c.req.param('id')
  const f = await c.req.formData()
  const note = String(f.get('note') ?? '').trim() || undefined
  try {
    const { written } = await approveReview(c.env.DB, id, note)
    logInfo('admin.review.approve', { reviewId: id, written })
    return c.redirect(
      `/admin/reviews/${id}?msg=${encodeURIComponent(`承認して ${written} 件を反映しました`)}`,
    )
  } catch (e) {
    if (e instanceof ReviewNotPendingError) {
      return c.redirect(`/admin/reviews/${id}?err=${encodeURIComponent(e.message)}`)
    }
    // payload の zod 不整合等は err として画面に返す（500 にしない）
    logError('admin.review.approve.fail', e, { reviewId: id })
    return c.redirect(
      `/admin/reviews/${id}?err=${encodeURIComponent(`反映失敗: ${(e as Error).message.slice(0, 200)}`)}`,
    )
  }
})

adminApp.post('/reviews/:id/reject', async (c) => {
  const id = c.req.param('id')
  const f = await c.req.formData()
  const note = String(f.get('note') ?? '').trim()
  if (!note) {
    return c.redirect(
      `/admin/reviews/${id}?err=${encodeURIComponent('破棄には理由メモが必須です（docs/07 §2.5）')}`,
    )
  }
  const ok = await rejectReview(c.env.DB, id, note)
  if (ok) logInfo('admin.review.reject', { reviewId: id })
  return ok
    ? c.redirect(`/admin/reviews/${id}?msg=${encodeURIComponent('破棄しました')}`)
    : c.redirect(`/admin/reviews/${id}?err=${encodeURIComponent('pending ではありません')}`)
})

// ---- 上映データ（抽出検証・ADR-0015。docs/07 §2.6）----
// 取込済み screenings の検証閲覧。D1 読取のみで先方サイトへのアクセスは無い。
// 利用者向けに出さない・JSON API 化しない（docs/08 §1 原則1 注記の条件）。
adminApp.get('/screenings', async (c) => {
  const theaters = await listAllTheaters(c.env.DB)
  const qid = c.req.query('theaterId')
  const theater = theaters.find((t) => t.id === qid) ?? theaters[0]
  const dates = theater ? await listScreeningDates(c.env.DB, theater.id) : []
  const date =
    c.req.query('date') ??
    pickDefaultDate(
      dates.map((d) => d.business_date),
      todayJst(),
    )
  const rows = theater && date ? await listScreeningsForDate(c.env.DB, theater.id, date) : []
  return c.html(
    <Layout title="上映データ" active="screenings" env={env(c)}>
      <ScreeningsPage theaters={theaters} theater={theater} dates={dates} date={date} rows={rows} />
    </Layout>,
  )
})

// ---- R2 スナップショット配信（レビュー突合・詳細表示用）----
// raw/ 配下のみ許可。保存 HTML は text/plain で返す（取得元サイトのスクリプトを
// admin オリジンで実行させない）。
const R2_MIME: Record<string, string> = {
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  html: 'text/plain; charset=utf-8',
}
adminApp.get('/r2/*', async (c) => {
  const key = decodeURIComponent(c.req.path.replace(/^\/admin\/r2\//, ''))
  if (!key.startsWith('raw/')) return c.text('forbidden', 403)
  const obj = await c.env.SNAPSHOTS.get(key)
  if (!obj) return c.notFound()
  const ext = key.slice(key.lastIndexOf('.') + 1).toLowerCase()
  return new Response(obj.body, {
    headers: {
      'content-type': R2_MIME[ext] ?? 'application/octet-stream',
      'cache-control': 'private, max-age=3600',
    },
  })
})
