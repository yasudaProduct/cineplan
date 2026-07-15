import { completeRun, createIngestRun, failRun, getRun } from '../db/ingest-runs'
import { createReview, recentAvgCount } from '../db/reviews'
import { getTheater } from '../db/theaters'
import type { Env } from '../env'
import { TheaterNotFoundError } from './errors'
import { extractTextWithRetries, extractVisionWithRetries } from './extract'
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

const extOf = (key: string): string => key.slice(key.lastIndexOf('.') + 1).toLowerCase()
const MIME: Record<string, string> = {
  gif: 'image/gif',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
}

// R2 スナップショットからの再抽出（P4-4/F-21）。**先方サイトへの再取得は行わない**
// （docs/08 §3・docs/06 §7。入力は保存済み画像のみ）。新しい run（trigger='retry'）を起票し、
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
  // vision: 保存済み画像（{prefix}_{n}.{ext}）/ text: 保存済み HTML（{prefix}.html。P4-7）
  let extractInput:
    | { kind: 'vision'; images: ReturnType<typeof imagesToParts> }
    | { kind: 'text'; text: string }
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
    const obj = await env.SNAPSHOTS.get(`${source.snapshot_key}.html`)
    if (!obj) {
      throw new SnapshotNotFoundError(
        `HTML スナップショットがありません（${source.snapshot_key}.html）`,
      )
    }
    extractInput = { kind: 'text', text: htmlToText(await obj.text()) }
  }

  // 新しい run として記録（business_date は実行日ではなくスナップショットの取得日:
  // 「そのデータがどの日の取得か」を保つ。docs/11 §5.4 の ready 判定とも整合）
  const runId = await createIngestRun(env.DB, {
    theaterId: theater.id,
    businessDate: snapshotDate,
    trigger: 'retry',
    status: 'extracting',
  })

  // 抽出（リトライ込み・docs/06 §7）→ 検証 → 通常書込パス（pipeline と同一）
  let outcome: Awaited<ReturnType<typeof extractVisionWithRetries>>
  try {
    outcome =
      extractInput.kind === 'vision'
        ? await extractVisionWithRetries(env, extractInput.images, snapshotDate.slice(0, 7))
        : await extractTextWithRetries(
            env,
            extractInput.text,
            snapshotDate.slice(0, 7),
            theater.scheduleUrl,
          )
  } catch (e) {
    const msg = (e as Error).message
    await failRun(env.DB, runId, {
      status: 'extraction_failed',
      errorMessage: msg,
      snapshotKey: source.snapshot_key,
    })
    await sendSlack(
      env.SLACK_WEBHOOK_URL,
      `🛑 再抽出失敗(extraction_failed) ${theater.name}: ${msg}`,
    )
    return { runId, status: 'extraction_failed', theaterId: theater.id, error: msg }
  }
  const { ext, result } = outcome

  const avgCount = await recentAvgCount(env.DB, theater.id)
  const ng = validateExtracted(result, { avgCount }) ?? validateNormalized(normalize(result))
  if (ng) {
    const reason = `${ng.code}: ${ng.detail}`
    await createReview(env.DB, { runId, reason, payloadJson: JSON.stringify(result) })
    await failRun(env.DB, runId, {
      status: 'validation_failed',
      errorMessage: reason,
      snapshotKey: source.snapshot_key,
    })
    await sendSlack(
      env.SLACK_WEBHOOK_URL,
      `⚠️ 再抽出の検証NG ${theater.name}: ${reason}（レビューキューへ）`,
    )
    return { runId, status: 'validation_failed', theaterId: theater.id, error: reason }
  }

  const written = await normalizeResolveWrite(env.DB, theater.id, runId, result, snapshotDate)
  await completeRun(env.DB, runId, {
    snapshotKey: source.snapshot_key,
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
    theaterId: theater.id,
    extractedCount: result.screenings.length,
    writtenCount: written,
  }
}
