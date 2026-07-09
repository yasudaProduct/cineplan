// 抽出クライアントの抽象（ADR-0011/0012）。provider（gemini/ollama/…）× 方式（text/vision）を吸収する。

export type LlmProvider = 'gemini' | 'ollama' | 'workers-ai' | 'anthropic'

export interface ImagePart {
  mimeType: string // 例 'image/gif'
  dataBase64: string // base64（data: プレフィックス無し）
}

export interface ExtractInput {
  systemPrompt: string
  userText?: string // text 抽出（前処理済み HTML）
  images?: ImagePart[] // vision 抽出（スケジュール画像）
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
