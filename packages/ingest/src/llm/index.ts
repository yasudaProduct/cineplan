import { createGeminiClient } from './gemini'
import { createOllamaClient } from './ollama'
import type { LlmClient, LlmProvider } from './types'

export * from './types'

// LLM 設定は env（vars/secret）から。開発は ollama、本番/ST は gemini（ADR-0011）。
export interface LlmEnv {
  LLM_PROVIDER?: string
  GEMINI_API_KEY?: string
  GEMINI_MODEL?: string
  OLLAMA_BASE_URL?: string
  OLLAMA_MODEL?: string
}

export function createLlmClient(env: LlmEnv): LlmClient {
  const provider = (env.LLM_PROVIDER ?? 'gemini') as LlmProvider
  switch (provider) {
    case 'gemini': {
      if (!env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY が未設定です')
      return createGeminiClient({
        apiKey: env.GEMINI_API_KEY,
        model: env.GEMINI_MODEL ?? 'gemini-flash-latest',
      })
    }
    case 'ollama':
      return createOllamaClient({
        baseUrl: env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
        model: env.OLLAMA_MODEL ?? 'qwen2.5',
      })
    default:
      throw new Error(`LLM_PROVIDER=${provider} は未実装です（P1 は gemini / ollama）`)
  }
}

// ```json フェンス等を除去して JSON 本体を得る（docs/06 §4 の防御的処理）。
export function stripJsonFence(raw: string): string {
  const t = raw.trim()
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)
  return (fenced ? (fenced[1] ?? '') : t).trim()
}
