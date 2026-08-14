// 抽出クライアントの抽象（ADR-0011/0012）。provider（gemini/ollama/…）× 方式（text/vision）を吸収する。

export type LlmProvider = 'gemini' | 'ollama' | 'workers-ai' | 'anthropic'

export interface ImagePart {
  mimeType: string // 例 'image/gif'
  dataBase64: string // base64（data: プレフィックス無し）
}

// 構造化出力のスキーマ種別（ADR-0017）。スキーマ実体はプロバイダごとの表現差
// （Gemini=大文字型 / Ollama=JSON Schema）があるため各クライアント内に持つ。
// extraction: ExtractionResult / dateList: ExtractedDateList（text 日分割の日付発見コール）
export type ResponseFormat = 'extraction' | 'dateList'

export interface ExtractInput {
  systemPrompt: string
  userText?: string // text 抽出（前処理済み HTML）
  images?: ImagePart[] // vision 抽出（スケジュール画像）
  responseFormat?: ResponseFormat // 省略時 'extraction'
}

export interface LlmResult {
  raw: string // モデルが返した JSON テキスト（フェンス除去前）
  model: string // ingest_runs.llm_model 用の識別子（例 'gemini:gemini-flash-latest'）
  inTokens: number | null
  outTokens: number | null
}

export interface LlmClient {
  readonly modelId: string
  extract(input: ExtractInput): Promise<LlmResult>
}

// LLM API 呼出の失敗分類（feat/ingest-observability）。
// timeout: AbortSignal.timeout 発火（応答が返らないままクライアント側で打ち切り）
// http: HTTP エラー応答（429=レート制限・503=過負荷 等。status とボディ断片を保持）
// network: fetch 自体の失敗（DNS・接続断 等）
export type LlmApiErrorKind = 'timeout' | 'http' | 'network'

export class LlmApiError extends Error {
  constructor(
    message: string,
    readonly kind: LlmApiErrorKind,
    readonly meta: { provider: string; ms: number; status?: number },
  ) {
    super(message)
    this.name = 'LlmApiError'
  }
}

// AbortSignal.timeout の発火は環境により TimeoutError / AbortError の DOMException になる。
export function isTimeoutAbort(e: unknown): boolean {
  const name = (e as { name?: string } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError'
}
