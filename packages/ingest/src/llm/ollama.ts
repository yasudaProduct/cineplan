import { logError, logInfo } from '../log'
import {
  type ExtractInput,
  isTimeoutAbort,
  LlmApiError,
  type LlmClient,
  type LlmResult,
} from './types'

// 開発専用（ADR-0011）。/api/chat・format=JSONスキーマ（構造化出力）。vision は message.images に base64。
// 品質確定は本番プロバイダ（Gemini）で行うこと（「Ollama で通った ≠ Gemini で通る」）。

// ExtractionResult 対応の JSON Schema（docs/spec/06 §3）。Gemini の responseSchema と同等の担保を
// Ollama にも与える（format='json' だけでは businessDate 欠落等のスキーマ逸脱が起きる）。
// regex（date/startTime 等）は zod 側（validate）で検証する。
const FORMAT_SCHEMA = {
  type: 'object',
  properties: {
    businessDate: { type: 'string' },
    notes: { type: ['string', 'null'] },
    screenings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          date: { type: ['string', 'null'] },
          movieTitle: { type: 'string' },
          startTime: { type: 'string' },
          endTime: { type: ['string', 'null'] },
          format: { type: ['string', 'null'] },
          screenName: { type: ['string', 'null'] },
          detailPath: { type: ['string', 'null'] },
        },
        required: ['movieTitle', 'startTime'],
      },
    },
  },
  required: ['businessDate', 'screenings'],
}

// ExtractedDateList 対応（text 日分割の日付発見コール。docs/spec/06 §4 text_v2・ADR-0017）。
const DATE_LIST_FORMAT_SCHEMA = {
  type: 'object',
  properties: {
    dates: { type: 'array', items: { type: 'string' } },
    notes: { type: ['string', 'null'] },
  },
  required: ['dates'],
}

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
        format: input.responseFormat === 'dateList' ? DATE_LIST_FORMAT_SCHEMA : FORMAT_SCHEMA,
        stream: false,
        options: { temperature: 0 },
      }
      // 失敗は timeout / http / network に分類して投げる（gemini.ts と同じ。README イベント台帳）。
      const startedAt = Date.now()
      let res: Response
      try {
        res = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(300_000), // ローカルモデルは遅いため長め
        })
      } catch (e) {
        const ms = Date.now() - startedAt
        const err = isTimeoutAbort(e)
          ? new LlmApiError(`ollama timeout: ${ms}ms 経過`, 'timeout', { provider: 'ollama', ms })
          : new LlmApiError(`ollama network error: ${(e as Error).message}`, 'network', {
              provider: 'ollama',
              ms,
            })
        logError('llm.call.fail', err, { provider: 'ollama', model: modelId, ms, kind: err.kind })
        throw err
      }
      const ms = Date.now() - startedAt
      if (!res.ok) {
        const err = new LlmApiError(
          `ollama ${res.status}: ${(await res.text()).slice(0, 500)}`,
          'http',
          { provider: 'ollama', ms, status: res.status },
        )
        logError('llm.call.fail', err, {
          provider: 'ollama',
          model: modelId,
          ms,
          kind: 'http',
          status: res.status,
        })
        throw err
      }
      const json = (await res.json()) as OllamaChatResponse
      const raw = json.message?.content ?? ''
      logInfo('llm.call.ok', {
        provider: 'ollama',
        model: modelId,
        ms,
        inTokens: json.prompt_eval_count ?? null,
        outTokens: json.eval_count ?? null,
        rawChars: raw.length,
      })
      return {
        raw,
        model: modelId,
        inTokens: json.prompt_eval_count ?? null,
        outTokens: json.eval_count ?? null,
      }
    },
  }
}
