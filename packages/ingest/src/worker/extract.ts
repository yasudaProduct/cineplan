import type { ExtractionResult } from '@cinema/shared'
import {
  buildTextV1SystemPrompt,
  buildTextV1UserText,
  TEXT_V1_VERSION,
} from '../extraction/prompts/text_v1'
import { buildVisionV1SystemPrompt, VISION_V1_VERSION } from '../extraction/prompts/vision_v1'
import type { ExtractInput, ImagePart, LlmEnv } from '../llm'
import { createLlmClient, stripJsonFence } from '../llm'
import { errorFields, logError, logInfo } from '../log'
import { parseExtraction } from './validate'

export class ExtractionParseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message)
    this.name = 'ExtractionParseError'
  }
}

export interface ExtractOutcome {
  parsed: unknown // JSON.parse 結果（未検証。zod 検証は validate 段）
  raw: string
  model: string
  promptVersion: string
  inTokens: number | null
  outTokens: number | null
}

// LLM 呼出1回 + JSON パース（方式共通の下回り）
async function extractOnce(
  env: LlmEnv,
  input: ExtractInput,
  promptVersion: string,
): Promise<ExtractOutcome> {
  const client = createLlmClient(env)
  const result = await client.extract(input)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonFence(result.raw))
  } catch (e) {
    throw new ExtractionParseError(`JSON パース不能: ${(e as Error).message}`, result.raw)
  }
  return {
    parsed,
    raw: result.raw,
    model: result.model,
    promptVersion,
    inTokens: result.inTokens,
    outTokens: result.outTokens,
  }
}

// vision 抽出（P1-3）。businessMonth は 'YYYY-MM'（画像の日付補完用）。
export async function extractVision(
  env: LlmEnv,
  images: ImagePart[],
  businessMonth: string,
): Promise<ExtractOutcome> {
  return extractOnce(
    env,
    { systemPrompt: buildVisionV1SystemPrompt(businessMonth), images },
    VISION_V1_VERSION,
  )
}

// text 抽出（P4-7。rendered/static の HTML → htmlToText 済みテキスト）。
export async function extractText(
  env: LlmEnv,
  preprocessedText: string,
  businessMonth: string,
  scheduleUrl: string,
): Promise<ExtractOutcome> {
  return extractOnce(
    env,
    {
      systemPrompt: buildTextV1SystemPrompt(businessMonth),
      userText: buildTextV1UserText(scheduleUrl, businessMonth, preprocessedText),
    },
    TEXT_V1_VERSION,
  )
}

// docs/06 §7 のリトライ予算。LLM API エラー（client.extract 自体の失敗）と
// JSON パース不能/zod NG（LLM の出力が壊れていた場合）は別予算。
// いずれも fetch 済みの入力（メモリ上）を使い回すだけで再取得はしない。
const LLM_API_MAX_RETRIES = 2
const MALFORMED_OUTPUT_MAX_RETRIES = 1

export interface ExtractWithRetriesResult {
  ext: ExtractOutcome
  result: ExtractionResult
}

// 予算切れの最終エラーは経緯を前置して投げ直す。D1 の error_message（管理画面）だけで
// 「何をどれだけ試して失敗したか」が読めるように（feat/ingest-observability・docs/06 §7）。
function budgetExhausted(e: unknown, apiFailures: number, malformedFailures: number): Error {
  const detail = e instanceof Error ? e.message : String(e)
  return new Error(
    `抽出リトライ予算切れ（LLM呼出${apiFailures + malformedFailures}回: APIエラー${apiFailures}・出力不正${malformedFailures}）: ${detail.slice(0, 500)}`,
  )
}

// 抽出 + zod 検証を、docs/06 §7 のリトライ予算内でリトライしながら行う（方式共通）。
// 予算を使い切って尚失敗した場合はその時点のエラーを throw する（呼び出し側で extraction_failed 確定）。
async function withRetries(
  attempt: () => Promise<ExtractOutcome>,
): Promise<ExtractWithRetriesResult> {
  let apiRetriesLeft = LLM_API_MAX_RETRIES
  let malformedRetriesLeft = MALFORMED_OUTPUT_MAX_RETRIES
  let apiFailures = 0
  let malformedFailures = 0

  for (;;) {
    let ext: ExtractOutcome
    try {
      ext = await attempt()
    } catch (e) {
      if (e instanceof ExtractionParseError) {
        malformedFailures++
        if (malformedRetriesLeft > 0) {
          malformedRetriesLeft--
          logInfo('llm.retry', { kind: 'parse', malformedRetriesLeft, error: errorFields(e) })
          continue
        }
        logError('llm.giveup', e, { kind: 'parse', apiFailures, malformedFailures })
        throw budgetExhausted(e, apiFailures, malformedFailures)
      }
      apiFailures++
      if (apiRetriesLeft > 0) {
        apiRetriesLeft--
        // API 呼出自体の失敗詳細（timeout/http/network・ms・status）は llm.call.fail 済み
        logInfo('llm.retry', { kind: 'api', apiRetriesLeft, error: errorFields(e) })
        continue
      }
      logError('llm.giveup', e, { kind: 'api', apiFailures, malformedFailures })
      throw budgetExhausted(e, apiFailures, malformedFailures)
    }
    try {
      const result = parseExtraction(ext.parsed)
      return { ext, result }
    } catch (zodErr) {
      malformedFailures++
      if (malformedRetriesLeft > 0) {
        malformedRetriesLeft--
        logInfo('llm.retry', { kind: 'schema', malformedRetriesLeft, error: errorFields(zodErr) })
        continue
      }
      logError('llm.giveup', zodErr, { kind: 'schema', apiFailures, malformedFailures })
      throw budgetExhausted(zodErr, apiFailures, malformedFailures)
    }
  }
}

export async function extractVisionWithRetries(
  env: LlmEnv,
  images: ImagePart[],
  businessMonth: string,
): Promise<ExtractWithRetriesResult> {
  return withRetries(() => extractVision(env, images, businessMonth))
}

export async function extractTextWithRetries(
  env: LlmEnv,
  preprocessedText: string,
  businessMonth: string,
  scheduleUrl: string,
): Promise<ExtractWithRetriesResult> {
  return withRetries(() => extractText(env, preprocessedText, businessMonth, scheduleUrl))
}
