import { logError, logInfo } from '../log'
import {
  type ExtractInput,
  isTimeoutAbort,
  LlmApiError,
  type LlmClient,
  type LlmResult,
} from './types'

// ExtractionResult 対応の Gemini responseSchema（docs/06 §3）。
// regex（date/startTime 等）は Gemini schema では表現できないため zod 側（validate）で検証する。
const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    businessDate: { type: 'STRING' },
    notes: { type: 'STRING', nullable: true },
    screenings: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          date: { type: 'STRING', nullable: true },
          movieTitle: { type: 'STRING' },
          startTime: { type: 'STRING' },
          endTime: { type: 'STRING', nullable: true },
          format: { type: 'STRING', nullable: true },
          screenName: { type: 'STRING', nullable: true },
          detailPath: { type: 'STRING', nullable: true },
        },
        required: ['movieTitle', 'startTime'],
      },
    },
  },
  required: ['businessDate', 'screenings'],
}

// ExtractedDateList 対応（text 日分割の日付発見コール。docs/06 §4 text_v2・ADR-0017）。
const DATE_LIST_RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    dates: { type: 'ARRAY', items: { type: 'STRING' } },
    notes: { type: 'STRING', nullable: true },
  },
  required: ['dates'],
}

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } }

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

export function createGeminiClient(opts: { apiKey: string; model: string }): LlmClient {
  const modelId = `gemini:${opts.model}`
  return {
    modelId,
    async extract(input: ExtractInput): Promise<LlmResult> {
      const parts: GeminiPart[] = []
      if (input.userText) parts.push({ text: input.userText })
      for (const img of input.images ?? []) {
        parts.push({ inline_data: { mime_type: img.mimeType, data: img.dataBase64 } })
      }
      if (parts.length === 0) parts.push({ text: '(入力なし)' })

      const body = {
        systemInstruction: { parts: [{ text: input.systemPrompt }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          temperature: 0,
          responseMimeType: 'application/json',
          responseSchema:
            input.responseFormat === 'dateList' ? DATE_LIST_RESPONSE_SCHEMA : RESPONSE_SCHEMA,
        },
      }
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${opts.model}:generateContent`
      // タイムアウトでハングを LLM API エラーに変換（リトライ予算へ乗せる。docs/06 §7）。
      // 120秒: rendered 劇場（サイト全体を取得するため htmlToText 後も数万トークン規模になりうる）
      // では60秒では常時タイムアウトすることを実測で確認（テアトル梅田・約4.5万トークン入力で
      // 3回とも60秒ちょうどで打ち切られていた）。
      // 失敗は timeout / http / network に分類して投げる（error_message と Workers Logs の
      // 両方から「429=レート制限か・ハングか」を即断できるように。README イベント台帳）。
      const inputDesc = `text ${input.userText?.length ?? 0}字・画像${input.images?.length ?? 0}枚`
      const startedAt = Date.now()
      let res: Response
      try {
        res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(120_000),
        })
      } catch (e) {
        const ms = Date.now() - startedAt
        const err = isTimeoutAbort(e)
          ? new LlmApiError(`gemini timeout: ${ms}ms 経過（入力 ${inputDesc}）`, 'timeout', {
              provider: 'gemini',
              ms,
            })
          : new LlmApiError(`gemini network error: ${(e as Error).message}`, 'network', {
              provider: 'gemini',
              ms,
            })
        logError('llm.call.fail', err, { provider: 'gemini', model: modelId, ms, kind: err.kind })
        throw err
      }
      const ms = Date.now() - startedAt
      if (!res.ok) {
        const err = new LlmApiError(
          `gemini ${res.status}: ${(await res.text()).slice(0, 500)}`,
          'http',
          { provider: 'gemini', ms, status: res.status },
        )
        logError('llm.call.fail', err, {
          provider: 'gemini',
          model: modelId,
          ms,
          kind: 'http',
          status: res.status,
        })
        throw err
      }
      const json = (await res.json()) as GeminiResponse
      const raw = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
      logInfo('llm.call.ok', {
        provider: 'gemini',
        model: modelId,
        ms,
        inTokens: json.usageMetadata?.promptTokenCount ?? null,
        outTokens: json.usageMetadata?.candidatesTokenCount ?? null,
        rawChars: raw.length,
      })
      return {
        raw,
        model: modelId,
        inTokens: json.usageMetadata?.promptTokenCount ?? null,
        outTokens: json.usageMetadata?.candidatesTokenCount ?? null,
      }
    },
  }
}
