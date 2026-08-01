import type { ExtractMethod } from '@cinema/shared'
import { createGeminiClient } from './gemini'
import { createOllamaClient } from './ollama'
import type { LlmClient, LlmProvider } from './types'

export * from './types'

// LLM 設定は env（vars/secret）から。開発は ollama、本番/ST は gemini（ADR-0011）。
export interface LlmEnv {
  LLM_PROVIDER?: string
  GEMINI_API_KEY?: string
  // text 抽出のモデル。ST/prod は gemini-flash-lite-latest（ADR-0018）。
  GEMINI_MODEL?: string
  // vision 抽出のモデル（ADR-0020）。text とは別に指定する。
  GEMINI_MODEL_VISION?: string
  OLLAMA_BASE_URL?: string
  OLLAMA_MODEL?: string
}

// Flash 最上位系の最新安定版。vision の既定であり、GEMINI_MODEL 未設定時の text の既定でもある。
// 固定IDでなくエイリアスを使う理由は ADR-0018（旧世代の提供打ち切りで 404 になるリスクの方が大きい）。
const GEMINI_DEFAULT_MODEL = 'gemini-flash-latest'

// modality ごとのモデルを解決する（ADR-0020）。
// **vision は GEMINI_MODEL にフォールバックしない。** ST/prod の GEMINI_MODEL は text の
// 事情（容量逼迫・出力律速）で Flash-Lite に設定されているが、Flash-Lite は月間グリッド画像の
// 日付列を読めず全日程を単一日に潰す。フォールバックさせると同じ事故を再現してしまう。
function geminiModelFor(env: LlmEnv, modality: ExtractMethod): string {
  return modality === 'vision'
    ? (env.GEMINI_MODEL_VISION ?? GEMINI_DEFAULT_MODEL)
    : (env.GEMINI_MODEL ?? GEMINI_DEFAULT_MODEL)
}

// modality は呼出側が明示的に渡す（ExtractInput.images の有無から推測しない。モデル選択を
// 付随的なプロパティに結び付けると、text 呼出に画像を添えるような変更で静かに壊れる。ADR-0020）。
export function createLlmClient(env: LlmEnv, modality: ExtractMethod): LlmClient {
  const provider = (env.LLM_PROVIDER ?? 'gemini') as LlmProvider
  switch (provider) {
    case 'gemini': {
      if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY が未設定です')
      return createGeminiClient({
        apiKey: env.GEMINI_API_KEY,
        model: geminiModelFor(env, modality),
      })
    }
    case 'ollama':
      // ollama は local 開発専用で、モデルは開発者が .dev.vars で明示設定する（vision を試すなら
      // qwen2.5vl 等のビジョンモデルを OLLAMA_MODEL に入れる）。ST/prod の共有 var による
      // 取り違えが起きないため、現時点では modality 別の分離を持たない。
      return createOllamaClient({
        baseUrl: env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
        model: env.OLLAMA_MODEL ?? 'qwen2.5',
      })
    default:
      throw new Error(`LLM_PROVIDER=${provider} は未実装です（P1 は gemini / ollama）`)
  }
}

// ```json フェンス等を除去して JSON 本体を得る（docs/spec/06 §4 の防御的処理）。
export function stripJsonFence(raw: string): string {
  const t = raw.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return (fenced ? (fenced[1] ?? '') : t).trim()
}
