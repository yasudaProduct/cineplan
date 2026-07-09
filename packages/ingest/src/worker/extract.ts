import { buildVisionV1SystemPrompt, VISION_V1_VERSION } from '../extraction/prompts/vision_v1'
import type { ImagePart, LlmEnv } from '../llm'
import { createLlmClient, stripJsonFence } from '../llm'

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
