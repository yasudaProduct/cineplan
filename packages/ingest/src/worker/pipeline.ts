import type { ExtractionResult, IngestTrigger, NormalizedScreening } from '@cinema/shared'
import { completeRun, createIngestRun, failRun, updateRunStatus } from '../db/ingest-runs'
import { resolveMovieId } from '../db/movies'
import { createReview, recentAvgCount } from '../db/reviews'
import { replaceScreeningsByDate } from '../db/screenings'
import { getTheater } from '../db/theaters'
import type { Env } from '../env'
import { ExtractionParseError, extractVision } from './extract'
import { fetchSchedule } from './fetch'
import { normalize } from './normalize'
import { sendSlack } from './notify'
import { imagesToParts } from './preprocess'
import {
  parseExtraction,
  type ValidationNg,
  validateExtracted,
  validateNormalized,
} from './validate'

export interface IngestResult {
  runId: string
  status: string
  theaterId: string
  extractedCount?: number
  writtenCount?: number
  error?: string
}

function todayJst(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

// 1劇場・1回分の取込（fetch→R2→抽出→検証→正規化→D1 洗い替え）。docs/06 パイプライン。
export async function ingestTheater(
  env: Env,
  theaterId: string,
  trigger: IngestTrigger,
): Promise<IngestResult> {
  const theater = await getTheater(env.DB, theaterId)
  if (!theater) throw new Error(`theater not found: ${theaterId}`)

  const businessDate = todayJst()
  const businessMonth = businessDate.slice(0, 7)
  const runId = await createIngestRun(env.DB, { theaterId, businessDate, trigger })

  // 1. Fetch（失敗時のみ先方再取得のリトライ対象。docs/06 §7）
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

  // 3. 抽出（vision）
  let ext: Awaited<ReturnType<typeof extractVision>>
  try {
    ext = await extractVision(env, imagesToParts(fetched.images), businessMonth)
  } catch (e) {
    const msg = e instanceof ExtractionParseError ? `parse: ${e.message}` : (e as Error).message
    return await fail(env, runId, theaterId, theater.name, 'extraction_failed', msg, prefix)
  }

  // 4. zod 検証（失敗は extraction_failed）
  let result: ExtractionResult
  try {
    result = parseExtraction(ext.parsed)
  } catch (e) {
    return await fail(
      env,
      runId,
      theaterId,
      theater.name,
      'extraction_failed',
      `zod: ${(e as Error).message}`,
      prefix,
    )
  }

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

  // 8. 洗い替え書込（businessDate 別）
  const written = await replaceScreeningsByDate(env.DB, theaterId, runId, rows)
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
): Promise<IngestResult> {
  await failRun(env.DB, runId, { status, errorMessage: msg, snapshotKey })
  await sendSlack(env.SLACK_WEBHOOK_URL, `🛑 取込失敗(${status}) ${theaterName}: ${msg}`)
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
