import { completeRun, createIngestRun, failRun, getRun } from '../db/ingest-runs'
import { createReview, recentAvgCount } from '../db/reviews'
import { getTheater } from '../db/theaters'
import type { Env } from '../env'
import { logError, logInfo } from '../log'
import { TheaterNotFoundError } from './errors'
import {
  type DayDocument,
  extractTextDaySplit,
  extractTextPerDocument,
  extractVisionWithRetries,
} from './extract'
import type { FetchedImage } from './fetch'
import { normalize } from './normalize'
import { sendSlack } from './notify'
import type { IngestResult } from './pipeline'
import { htmlToText, imagesToParts } from './preprocess'
import { validateExtracted, validateNormalized } from './validate'
import { normalizeResolveWrite } from './write'

export class SnapshotNotFoundError extends Error {
  constructor(msg: string) {
    super(msg)
    this.name = 'SnapshotNotFoundError'
  }
}

// snapshot_key（raw/{theaterId}/{businessDate}/{fetchedAt}）から取得日を得る。
// 再抽出の coverageFloor と businessMonth はこの日を使う（today だと古いスナップショットの
// 再抽出時に、抽出がカバーしない日まで洗い替え範囲へ入り新しいデータを消しうる）。
export function snapshotDateOf(snapshotKey: string): string | null {
  const m = snapshotKey.match(/^raw\/[^/]+\/(\d{4}-\d{2}-\d{2})\//)
  return m ? (m[1] ?? null) : null
}

// 複数日取得（ADR-0019）の日別スナップショットキー（{prefix}_d{date}.html）から日付を得る。
export function snapshotDayDateOf(key: string): string | null {
  const m = key.match(/_d(\d{4}-\d{2}-\d{2})\.html$/)
  return m ? (m[1] ?? null) : null
}

const extOf = (key: string): string => key.slice(key.lastIndexOf('.') + 1).toLowerCase()
const MIME: Record<string, string> = {
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

// R2 スナップショットからの再抽出（P4-4/F-21）。**先方サイトへの再取得は行わない**
// （docs/spec/08 §3・docs/spec/06 §7。入力は保存済み画像のみ）。新しい run（trigger='retry'）を起票し、
// 抽出→検証→通常書込パスは取込と同一の関数を通る。
export async function reextractFromSnapshot(env: Env, sourceRunId: string): Promise<IngestResult> {
  const source = await getRun(env.DB, sourceRunId)
  if (!source) throw new SnapshotNotFoundError(`run ${sourceRunId} が見つかりません`)
  if (!source.snapshot_key) {
    throw new SnapshotNotFoundError(`run ${sourceRunId} にスナップショットがありません`)
  }
  const snapshotDate = snapshotDateOf(source.snapshot_key)
  if (!snapshotDate) {
    throw new SnapshotNotFoundError(`snapshot_key の形式が不正です: ${source.snapshot_key}`)
  }
  const theater = await getTheater(env.DB, source.theater_id)
  if (!theater) throw new TheaterNotFoundError(source.theater_id)

  // 抽出入力をスナップショットから復元する。
  // vision: 保存済み画像（{prefix}_{n}.{ext}）
  // text:   複数日取得（ADR-0019）は日別 HTML（{prefix}_d{date}.html）、
  //         無ければ従来の単一 HTML（{prefix}.html。P4-7。既存 run はすべてこちら）
  let extractInput:
    | { kind: 'vision'; images: ReturnType<typeof imagesToParts> }
    | { kind: 'text'; text: string }
    | { kind: 'text-days'; docs: DayDocument[] }
  if (theater.extractMethod === 'vision') {
    const listed = await env.SNAPSHOTS.list({ prefix: `${source.snapshot_key}_` })
    const imageKeys = listed.objects
      .map((o) => o.key)
      .filter((k) => MIME[extOf(k)])
      .sort()
    if (imageKeys.length === 0) {
      throw new SnapshotNotFoundError(
        `画像スナップショットがありません（${source.snapshot_key}_*）`,
      )
    }
    const fetchedImages: FetchedImage[] = []
    for (const key of imageKeys) {
      const obj = await env.SNAPSHOTS.get(key)
      if (!obj) continue
      fetchedImages.push({
        url: `r2://${key}`,
        mimeType: MIME[extOf(key)] ?? 'image/gif',
        bytes: await obj.arrayBuffer(),
        lastModified: null,
      })
    }
    extractInput = { kind: 'vision', images: imagesToParts(fetchedImages) }
  } else {
    const listed = await env.SNAPSHOTS.list({ prefix: `${source.snapshot_key}_` })
    const dayKeys = listed.objects
      .map((o) => o.key)
      .filter((k) => snapshotDayDateOf(k))
      .sort()
    if (dayKeys.length > 0) {
      const docs: DayDocument[] = []
      for (const key of dayKeys) {
        const obj = await env.SNAPSHOTS.get(key)
        const date = snapshotDayDateOf(key)
        if (!obj || !date) continue
        docs.push({ date, text: htmlToText(await obj.text()), url: theater.scheduleUrl })
      }
      extractInput = { kind: 'text-days', docs }
    } else {
      const obj = await env.SNAPSHOTS.get(`${source.snapshot_key}.html`)
      if (!obj) {
        throw new SnapshotNotFoundError(
          `HTML スナップショットがありません（${source.snapshot_key}.html）`,
        )
      }
      extractInput = { kind: 'text', text: htmlToText(await obj.text()) }
    }
  }

  // 新しい run として記録（business_date は実行日ではなくスナップショットの取得日:
  // 「そのデータがどの日の取得か」を保つ。docs/spec/09 §5.4 の ready 判定とも整合）
  const runId = await createIngestRun(env.DB, {
    theaterId: theater.id,
    businessDate: snapshotDate,
    trigger: 'retry',
    status: 'extracting',
  })
  logInfo('run.start', {
    runId,
    theaterId: theater.id,
    trigger: 'retry',
    businessDate: snapshotDate,
    sourceRunId,
    extractMethod: theater.extractMethod,
    inputChars: extractInput.kind === 'text' ? extractInput.text.length : undefined,
    images: extractInput.kind === 'vision' ? extractInput.images.length : undefined,
    docs: extractInput.kind === 'text-days' ? extractInput.docs.length : undefined,
  })

  // 抽出（リトライ込み・docs/spec/06 §7。text は日単位分割 ADR-0017 / 複数日文書 ADR-0019）
  // → 検証 → 通常書込パス（pipeline と同一）
  const extractStartedAt = Date.now()
  let outcome: Awaited<ReturnType<typeof extractVisionWithRetries>>
  try {
    outcome =
      extractInput.kind === 'vision'
        ? await extractVisionWithRetries(env, extractInput.images, snapshotDate.slice(0, 7))
        : extractInput.kind === 'text-days'
          ? await extractTextPerDocument(
              env,
              extractInput.docs,
              snapshotDate.slice(0, 7),
              snapshotDate,
            )
          : await extractTextDaySplit(
              env,
              extractInput.text,
              snapshotDate.slice(0, 7),
              theater.scheduleUrl,
              snapshotDate,
            )
  } catch (e) {
    const msg = (e as Error).message
    logError('run.extract.fail', e, {
      runId,
      theaterId: theater.id,
      ms: Date.now() - extractStartedAt,
    })
    await failRun(env.DB, runId, {
      status: 'extraction_failed',
      errorMessage: msg,
      snapshotKey: source.snapshot_key,
    })
    logInfo('run.done', {
      runId,
      theaterId: theater.id,
      status: 'extraction_failed',
      error: msg.slice(0, 500),
    })
    await sendSlack(
      env.SLACK_WEBHOOK_URL,
      `🛑 再抽出失敗(extraction_failed) ${theater.name}: ${msg}`,
    )
    return { runId, status: 'extraction_failed', theaterId: theater.id, error: msg }
  }
  const { ext, result } = outcome
  logInfo('run.extract.ok', {
    runId,
    theaterId: theater.id,
    ms: Date.now() - extractStartedAt,
    model: ext.model,
    inTokens: ext.inTokens,
    outTokens: ext.outTokens,
    screenings: result.screenings.length,
  })

  const avgCount = await recentAvgCount(env.DB, theater.id)
  const ng =
    validateExtracted(result, { avgCount }) ??
    validateNormalized(normalize(result, theater.scheduleUrl))
  if (ng) {
    const reason = `${ng.code}: ${ng.detail}`
    await createReview(env.DB, { runId, reason, payloadJson: JSON.stringify(result) })
    await failRun(env.DB, runId, {
      status: 'validation_failed',
      errorMessage: reason,
      snapshotKey: source.snapshot_key,
    })
    logInfo('run.validate.ng', {
      runId,
      theaterId: theater.id,
      code: ng.code,
      detail: ng.detail.slice(0, 500),
    })
    logInfo('run.done', {
      runId,
      theaterId: theater.id,
      status: 'validation_failed',
      error: reason.slice(0, 500),
    })
    await sendSlack(
      env.SLACK_WEBHOOK_URL,
      `⚠️ 再抽出の検証NG ${theater.name}: ${reason}（レビューキューへ）`,
    )
    return { runId, status: 'validation_failed', theaterId: theater.id, error: reason }
  }

  const written = await normalizeResolveWrite(
    env.DB,
    theater.id,
    runId,
    result,
    snapshotDate,
    theater.scheduleUrl,
  )
  await completeRun(env.DB, runId, {
    snapshotKey: source.snapshot_key,
    extractedCount: result.screenings.length,
    writtenCount: written,
    llmModel: ext.model,
    inTokens: ext.inTokens,
    outTokens: ext.outTokens,
    promptVersion: ext.promptVersion,
  })
  logInfo('run.done', {
    runId,
    theaterId: theater.id,
    status: 'succeeded',
    extracted: result.screenings.length,
    written,
  })
  return {
    runId,
    status: 'succeeded',
    theaterId: theater.id,
    extractedCount: result.screenings.length,
    writtenCount: written,
  }
}
