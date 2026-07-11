import type { ExtractionResult } from '@cinema/shared'
import { buildVisionV1SystemPrompt, VISION_V1_VERSION } from '../extraction/prompts/vision_v1'
import type { ImagePart, LlmEnv } from '../llm'
import { createLlmClient, stripJsonFence } from '../llm'
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

// vision 抽出（P1-3）。businessMonth は 'YYYY-MM'（画像の日付補完用）。
export async function extractVision(
  env: LlmEnv,
  images: ImagePart[],
  businessMonth: string,
): Promise<ExtractOutcome> {
  const client = createLlmClient(env)
  const result = await client.extract({
    systemPrompt: buildVisionV1SystemPrompt(businessMonth),
    images,
  })
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
    promptVersion: VISION_V1_VERSION,
    inTokens: result.inTokens,
    outTokens: result.outTokens,
  }
}

// docs/06 §7 のリトライ予算。LLM API エラー（client.extract 自体の失敗）と
// JSON パース不能/zod NG（LLM の出力が壊れていた場合）は別予算。
// いずれも fetch 済みの画像（メモリ上）を使い回すだけで再取得はしない。
const LLM_API_MAX_RETRIES = 2
const MALFORMED_OUTPUT_MAX_RETRIES = 1

export interface ExtractWithRetriesResult {
  ext: ExtractOutcome
  result: ExtractionResult
}

// vision 抽出 + zod 検証を、docs/06 §7 のリトライ予算内でリトライしながら行う。
// 予算を使い切って尚失敗した場合はその時点のエラーを throw する（呼び出し側で extraction_failed 確定）。
export async function extractVisionWithRetries(
  env: LlmEnv,
  images: ImagePart[],
  businessMonth: string,
): Promise<ExtractWithRetriesResult> {
  let apiRetriesLeft = LLM_API_MAX_RETRIES
  let malformedRetriesLeft = MALFORMED_OUTPUT_MAX_RETRIES

  for (;;) {
    let ext: ExtractOutcome
    try {
      ext = await extractVision(env, images, businessMonth)
    } catch (e) {
      if (e instanceof ExtractionParseError) {
        if (malformedRetriesLeft > 0) {
          malformedRetriesLeft--
          continue
        }
        throw e
      }
      if (apiRetriesLeft > 0) {
        apiRetriesLeft--
        continue
      }
      throw e
    }
    try {
      const result = parseExtraction(ext.parsed)
      return { ext, result }
    } catch (zodErr) {
      if (malformedRetriesLeft > 0) {
        malformedRetriesLeft--
        continue
      }
      throw zodErr
    }
  }
}
