import type { ExtractionResult, IngestTrigger, NormalizedScreening } from '@cinema/shared'
import { completeRun, createIngestRun, failRun, updateRunStatus } from '../db/ingest-runs'
import { resolveMovieId } from '../db/movies'
import { createReview, recentAvgCount } from '../db/reviews'
import { replaceScreeningsByDate } from '../db/screenings'
import { getTheater } from '../db/theaters'
import type { Env } from '../env'
import { assertComplianceGate } from './compliance-guard'
import { TheaterNotFoundError } from './errors'
import { extractVisionWithRetries } from './extract'
import { fetchSchedule } from './fetch'
import { normalize } from './normalize'
import { sendSlack } from './notify'
import { imagesToParts } from './preprocess'
import { type ValidationNg, validateExtracted, validateNormalized } from './validate'

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

  // 1. Fetch。失敗時は Queue の再配信に委ねる（Worker 側で意図的な再取得はしない）。
  //    Slack 通知は最終試行（attempt>=3）でのみ行う（毎回通知しない。docs/06 §7）。
  let fetched: Awaited<ReturnType<typeof fetchSchedule>>
  try {
    fetched = await fetchSchedule({
      scheduleUrl: theater.scheduleUrl,
      extractMethod: theater.extractMethod,
    })
  } catch (e) {
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

  // 2. R2 保存（再抽出は必ずこのスナップショットから。先方再取得はしない）
  const prefix = `raw/${theaterId}/${businessDate}/${fetched.fetchedAt}`
  await env.SNAPSHOTS.put(`${prefix}.html`, fetched.scheduleHtml)
  for (let i = 0; i < fetched.images.length; i++) {
    const img = fetched.images[i]
    if (!img) continue
    const ext = img.mimeType.includes('png') ? 'png' : img.mimeType.includes('jpeg') ? 'jpg' : 'gif'
    await env.SNAPSHOTS.put(`${prefix}_${i}.${ext}`, img.bytes)
  }
  await updateRunStatus(env.DB, runId, 'extracting')

  if (theater.extractMethod !== 'vision') {
    return await fail(
      env,
      runId,
      theaterId,
      theater.name,
      'extraction_failed',
      `extract_method=${theater.extractMethod} は P1 未対応（vision のみ）`,
      prefix,
    )
  }

  // 3〜4. 抽出（vision）+ zod 検証。LLM APIエラー/パース不能/zod NG は関数内でリトライ済み
  // （docs/06 §7 のリトライ予算。fetch 済み画像の使い回しのみで再取得はしない）。
  let outcome: Awaited<ReturnType<typeof extractVisionWithRetries>>
  try {
    outcome = await extractVisionWithRetries(env, imagesToParts(fetched.images), businessMonth)
  } catch (e) {
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

  // 5. 妥当性検証 V1/2/5/6（NG はレビューキュー行き＝validation_failed）
  const avgCount = await recentAvgCount(env.DB, theaterId)
  const ng1 = validateExtracted(result, { avgCount })
  if (ng1) return await toReview(env, runId, theaterId, theater.name, result, ng1, prefix)

  // 6. 正規化 + V3/4
  const pre = normalize(result)
  const ng2 = validateNormalized(pre)
  if (ng2) return await toReview(env, runId, theaterId, theater.name, result, ng2, prefix)

  // 7. movie 解決 → NormalizedScreening[]
  const rows: NormalizedScreening[] = []
  for (const p of pre) {
    const movieId = await resolveMovieId(env.DB, p.movieTitle, null)
    rows.push({
      businessDate: p.businessDate,
      movieId,
      startAt: p.startAt,
      endAt: p.endAt,
      endAtSource: p.endAtSource,
      format: p.format,
      screenName: p.screenName,
      detailUrl: p.detailUrl,
    })
  }

  // 8. 洗い替え書込（businessDate 別。coverageFloor=today で stale データを防ぐ）
  const written = await replaceScreeningsByDate(env.DB, theaterId, runId, rows, businessDate)
  await completeRun(env.DB, runId, {
    snapshotKey: prefix,
    extractedCount: result.screenings.length,
    writtenCount: written,
    llmModel: ext.model,
    inTokens: ext.inTokens,
    outTokens: ext.outTokens,
    promptVersion: ext.promptVersion,
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
  await sendSlack(env.SLACK_WEBHOOK_URL, `⚠️ 検証NG ${theaterName}: ${reason}（レビューキューへ）`)
  return { runId, status: 'validation_failed', theaterId, error: reason }
}
