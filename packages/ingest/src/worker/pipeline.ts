import type { ExtractionResult, IngestTrigger } from '@cinema/shared'
import { completeRun, createIngestRun, failRun, updateRunStatus } from '../db/ingest-runs'
import { createReview, recentAvgCount } from '../db/reviews'
import { getTheater } from '../db/theaters'
import type { Env } from '../env'
import { logError, logInfo } from '../log'
import { assertComplianceGate } from './compliance-guard'
import { TheaterNotFoundError } from './errors'
import {
  EXTRACTION_DEADLINE_MS,
  extractTextDaySplit,
  extractTextPerDocument,
  extractVisionWithRetries,
} from './extract'
import { fetchRenderedSchedule, fetchSchedule, fetchScheduleByDateTemplate } from './fetch'
import { normalize } from './normalize'
import { sendSlack } from './notify'
import { htmlToText, imagesToParts } from './preprocess'
import { type ValidationNg, validateExtracted, validateNormalized } from './validate'
import { normalizeResolveWrite } from './write'

export interface IngestResult {
  runId: string
  status: string
  theaterId: string
  extractedCount?: number
  writtenCount?: number
  error?: string
}

// fetch_failed の Queues 標準リトライで通知を打ち切るまでの試行数（docs/06 §7）。
export const FETCH_FAILED_NOTIFY_AT_ATTEMPT = 3

// run 全体（fetch + 抽出）の時間予算。Queue consumer の実行上限（約15分/起動）の内側に収める。
// 複数日取得（ADR-0019）は fetch にも時間を使うため、抽出デッドラインを残時間から算出する。
const RUN_BUDGET_MS = 12 * 60_000
// fetch が長引いても抽出に最低限は確保する（下回ると1日も抽出できない）。
const MIN_EXTRACTION_DEADLINE_MS = 3 * 60_000

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

// 1劇場・1回分の取込（fetch→R2→抽出→検証→正規化→D1 洗い替え）。docs/06 パイプライン。
// attempt: Queue 消費時点の配信試行回数（1始まり。docs/06 §7 の fetch_failed 通知タイミング判定に使用）。
// 手動取込は Queue を経由しないため常に 1（＝失敗したら即通知）。
export async function ingestTheater(
  env: Env,
  theaterId: string,
  trigger: IngestTrigger,
  attempt = 1,
): Promise<IngestResult> {
  const theater = await getTheater(env.DB, theaterId)
  if (!theater) throw new TheaterNotFoundError(theaterId)
  assertComplianceGate(theater, trigger) // 多層防御（docs/08 §0・§2）

  const businessDate = todayJst()
  const businessMonth = businessDate.slice(0, 7)
  const runId = await createIngestRun(env.DB, { theaterId, businessDate, trigger })
  logInfo('run.start', {
    runId,
    theaterId,
    trigger,
    businessDate,
    fetchMethod: theater.fetchMethod,
    extractMethod: theater.extractMethod,
    fetchDayMode: theater.fetchDayMode,
    fetchDays: theater.fetchDays,
  })

  // 1. Fetch（static=HTTP / rendered=Browser Rendering。docs/06 §2.0）。
  //    複数日取得（tabs / url_template。ADR-0019・docs/06 §2.2）はここで日ごとの文書を集める。
  //    失敗時は Queue の再配信に委ねる（Worker 側で意図的な再取得はしない）。
  //    Slack 通知は最終試行（attempt>=3）でのみ行う（毎回通知しない。docs/06 §7）。
  const fetchStartedAt = Date.now()
  // tabs はブラウザが必須（zod で担保済みだが、手書き SQL 対策に実行時も single へ縮退させる）
  const dayMode =
    theater.fetchDayMode === 'tabs' && theater.fetchMethod !== 'rendered'
      ? 'single'
      : theater.fetchDayMode
  let fetched: Awaited<ReturnType<typeof fetchSchedule>>
  try {
    fetched =
      dayMode === 'url_template'
        ? await fetchScheduleByDateTemplate({
            scheduleUrl: theater.scheduleUrl,
            businessDate,
            days: theater.fetchDays,
          })
        : theater.fetchMethod === 'rendered'
          ? await fetchRenderedSchedule(env.BROWSER, theater.scheduleUrl, {
              dayMode,
              days: theater.fetchDays,
              businessDate,
            })
          : await fetchSchedule({
              scheduleUrl: theater.scheduleUrl,
              extractMethod: theater.extractMethod,
            })
  } catch (e) {
    logError('run.fetch.fail', e, { runId, theaterId, ms: Date.now() - fetchStartedAt })
    return await fail(
      env,
      runId,
      theaterId,
      theater.name,
      'fetch_failed',
      (e as Error).message,
      null,
      {
        silent: attempt < FETCH_FAILED_NOTIFY_AT_ATTEMPT,
      },
    )
  }
  logInfo('run.fetch.ok', {
    runId,
    theaterId,
    ms: Date.now() - fetchStartedAt,
    htmlChars: fetched.scheduleHtml.length,
    images: fetched.images.length,
    days: fetched.days?.length ?? 1,
    dayNotes: fetched.dayNotes?.length ?? 0,
  })

  // 2. R2 保存（再抽出は必ずこのスナップショットから。先方再取得はしない）
  //    複数日取得は各日を _d{date}.html にも保存する（既定文書 .html は従来互換のため残す）
  const prefix = `raw/${theaterId}/${businessDate}/${fetched.fetchedAt}`
  await env.SNAPSHOTS.put(`${prefix}.html`, fetched.scheduleHtml)
  for (const day of fetched.days ?? []) {
    await env.SNAPSHOTS.put(`${prefix}_d${day.date}.html`, day.html)
  }
  for (let i = 0; i < fetched.images.length; i++) {
    const img = fetched.images[i]
    if (!img) continue
    const ext = img.mimeType.includes('png') ? 'png' : img.mimeType.includes('jpeg') ? 'jpg' : 'gif'
    await env.SNAPSHOTS.put(`${prefix}_${i}.${ext}`, img.bytes)
  }
  await updateRunStatus(env.DB, runId, 'extracting')
  logInfo('run.snapshot.saved', { runId, prefix, images: fetched.images.length })

  if (theater.extractMethod === 'vision' && fetched.images.length === 0) {
    return await fail(
      env,
      runId,
      theaterId,
      theater.name,
      'extraction_failed',
      'vision 抽出対象のスケジュール画像が見つかりません',
      prefix,
    )
  }

  // 3〜4. 抽出（vision=画像1呼出 / text=日単位分割 ADR-0017 / 複数日文書 ADR-0019）+ zod 検証。
  // LLM APIエラー/パース不能/zod NG は関数内でリトライ済み（docs/06 §7 のリトライ予算。
  // fetch 済み入力の使い回しのみで再取得はしない）。
  // 複数日取得は fetch に時間を使うため、run 全体の予算から残り時間を抽出デッドラインにする
  // （Queue consumer の実行上限 約15分/起動 の内側に必ず収める。docs/06 §7）。
  const extractStartedAt = Date.now()
  const deadlineMs = Math.max(
    MIN_EXTRACTION_DEADLINE_MS,
    Math.min(EXTRACTION_DEADLINE_MS, RUN_BUDGET_MS - (Date.now() - fetchStartedAt)),
  )
  // 相対 URL 解決の基準は実際に取得した URL（{date} 展開後）を使う
  const baseUrl = fetched.days?.[0]?.url ?? theater.scheduleUrl
  let outcome: Awaited<ReturnType<typeof extractVisionWithRetries>>
  try {
    outcome =
      theater.extractMethod === 'vision'
        ? await extractVisionWithRetries(env, imagesToParts(fetched.images), businessMonth)
        : fetched.days && fetched.days.length > 0
          ? await extractTextPerDocument(
              env,
              fetched.days.map((d) => ({ date: d.date, text: htmlToText(d.html), url: d.url })),
              businessMonth,
              businessDate,
              { deadlineMs, extraNotes: fetched.dayNotes },
            )
          : await extractTextDaySplit(
              env,
              htmlToText(fetched.scheduleHtml),
              businessMonth,
              theater.scheduleUrl,
              businessDate,
              { deadlineMs },
            )
  } catch (e) {
    logError('run.extract.fail', e, { runId, theaterId, ms: Date.now() - extractStartedAt })
    return await fail(
      env,
      runId,
      theaterId,
      theater.name,
      'extraction_failed',
      (e as Error).message,
      prefix,
    )
  }
  const { ext, result } = outcome
  logInfo('run.extract.ok', {
    runId,
    theaterId,
    ms: Date.now() - extractStartedAt,
    model: ext.model,
    inTokens: ext.inTokens,
    outTokens: ext.outTokens,
    screenings: result.screenings.length,
  })

  // 5. 妥当性検証 V1/2/5/6（NG はレビューキュー行き＝validation_failed）
  const avgCount = await recentAvgCount(env.DB, theaterId)
  const ng1 = validateExtracted(result, { avgCount })
  if (ng1) return await toReview(env, runId, theaterId, theater.name, result, ng1, prefix)

  // 6. 正規化 + V3/4
  const pre = normalize(result, baseUrl)
  const ng2 = validateNormalized(pre)
  if (ng2) return await toReview(env, runId, theaterId, theater.name, result, ng2, prefix)

  // 7〜8. 通常書込パス（正規化→movie解決→洗い替え。承認/再抽出と同一関数・write.ts）。
  //    coverageFloor=fetch 当日で stale データを防ぐ（docs/03 §7）。
  const written = await normalizeResolveWrite(
    env.DB,
    theaterId,
    runId,
    result,
    businessDate,
    baseUrl,
  )
  await completeRun(env.DB, runId, {
    snapshotKey: prefix,
    extractedCount: result.screenings.length,
    writtenCount: written,
    llmModel: ext.model,
    inTokens: ext.inTokens,
    outTokens: ext.outTokens,
    promptVersion: ext.promptVersion,
  })
  logInfo('run.done', {
    runId,
    theaterId,
    status: 'succeeded',
    extracted: result.screenings.length,
    written,
  })
  return {
    runId,
    status: 'succeeded',
    theaterId,
    extractedCount: result.screenings.length,
    writtenCount: written,
  }
}

async function fail(
  env: Env,
  runId: string,
  theaterId: string,
  theaterName: string,
  status: 'fetch_failed' | 'extraction_failed',
  msg: string,
  snapshotKey: string | null,
  opts?: { silent?: boolean },
): Promise<IngestResult> {
  await failRun(env.DB, runId, { status, errorMessage: msg, snapshotKey })
  logInfo('run.done', { runId, theaterId, status, error: msg.slice(0, 500) })
  if (!opts?.silent) {
    await sendSlack(env.SLACK_WEBHOOK_URL, `🛑 取込失敗(${status}) ${theaterName}: ${msg}`)
  }
  return { runId, status, theaterId, error: msg }
}

async function toReview(
  env: Env,
  runId: string,
  theaterId: string,
  theaterName: string,
  result: ExtractionResult,
  ng: ValidationNg,
  snapshotKey: string,
): Promise<IngestResult> {
  const reason = `${ng.code}: ${ng.detail}`
  await createReview(env.DB, { runId, reason, payloadJson: JSON.stringify(result) })
  await failRun(env.DB, runId, { status: 'validation_failed', errorMessage: reason, snapshotKey })
  logInfo('run.validate.ng', { runId, theaterId, code: ng.code, detail: ng.detail.slice(0, 500) })
  logInfo('run.done', {
    runId,
    theaterId,
    status: 'validation_failed',
    error: reason.slice(0, 500),
  })
  await sendSlack(env.SLACK_WEBHOOK_URL, `⚠️ 検証NG ${theaterName}: ${reason}（レビューキューへ）`)
  return { runId, status: 'validation_failed', theaterId, error: reason }
}
