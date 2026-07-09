import type { ExtractInput, LlmClient, LlmResult } from './types'

// 開発専用（ADR-0011）。/api/chat・format=json。vision は message.images に base64 を渡す。
// 品質確定は本番プロバイダ（Gemini）で行うこと（「Ollama で通った ≠ Gemini で通る」）。

interface OllamaChatResponse {
  message?: { content?: string }
  prompt_eval_count?: number
  eval_count?: number
}

export function createOllamaClient(opts: { baseUrl: string; model: string }): LlmClient {
  const modelId = `ollama:${opts.model}`
  const base = opts.baseUrl.replace(/\/$/, '')
  return {
    modelId,
    async extract(input: ExtractInput): Promise<LlmResult> {
      const userMsg: { role: 'user'; content: string; images?: string[] } = {
        role: 'user',
        content: input.userText ?? '添付画像から上映情報を抽出してください。',
      }
      if (input.images?.length) userMsg.images = input.images.map((i) => i.dataBase64)

      const body = {
        model: opts.model,
        messages: [{ role: 'system', content: input.systemPrompt }, userMsg],
        format: 'json',
        stream: false,
        options: { temperature: 0 },
      }
      const res = await fetch(`${base}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 500)}`)
      }
      const json = (await res.json()) as OllamaChatResponse
      return {
        raw: json.message?.content ?? '',
        model: modelId,
        inTokens: json.prompt_eval_count ?? null,
        outTokens: json.eval_count ?? null,
      }
    },
  }
}
