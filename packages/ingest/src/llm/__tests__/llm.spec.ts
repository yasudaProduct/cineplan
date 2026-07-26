import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLlmClient, stripJsonFence } from '../index'

describe('stripJsonFence', () => {
  it('```json フェンスを除去', () => {
    expect(stripJsonFence('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })
  it('フェンス無しはそのまま trim', () => {
    expect(stripJsonFence('  {"a":1}  ')).toBe('{"a":1}')
  })
  it('言語指定なしフェンスも除去', () => {
    expect(stripJsonFence('```\n{"a":1}\n```')).toBe('{"a":1}')
  })
})

describe('createLlmClient', () => {
  it('gemini は API キー未設定でエラー', () => {
    expect(() => createLlmClient({ LLM_PROVIDER: 'gemini' }, 'text')).toThrow(/GEMINI_API_KEY/)
  })
  it('gemini は modelId が gemini:*', () => {
    const c = createLlmClient(
      {
        LLM_PROVIDER: 'gemini',
        GEMINI_API_KEY: 'x',
        GEMINI_MODEL: 'gemini-flash-latest',
      },
      'text',
    )
    expect(c.modelId).toBe('gemini:gemini-flash-latest')
  })
  it('ollama は modelId が ollama:*', () => {
    const c = createLlmClient({ LLM_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen2-vl' }, 'text')
    expect(c.modelId).toBe('ollama:qwen2-vl')
  })
  it('未実装 provider はエラー', () => {
    expect(() => createLlmClient({ LLM_PROVIDER: 'workers-ai' }, 'text')).toThrow(/未実装/)
  })
})

// modality（vision/text）ごとのモデル選択（ADR-0020）。
// ADR-0018 で ST/prod の GEMINI_MODEL を Flash-Lite にしたことが vision パスにも波及し、
// 月間グリッド画像の全日程が単一日に潰れて6日分のデータを失う事故が起きた。
// **vision は GEMINI_MODEL にフォールバックしない**ことが再発防止の核心なので、そこを固定する。
describe('createLlmClient — vision/text のモデル分離（ADR-0020）', () => {
  const ST_LIKE = {
    LLM_PROVIDER: 'gemini',
    GEMINI_API_KEY: 'x',
    GEMINI_MODEL: 'gemini-flash-lite-latest',
    GEMINI_MODEL_VISION: 'gemini-flash-latest',
  }

  it('text は GEMINI_MODEL を使う', () => {
    expect(createLlmClient(ST_LIKE, 'text').modelId).toBe('gemini:gemini-flash-lite-latest')
  })

  it('vision は GEMINI_MODEL_VISION を使う', () => {
    expect(createLlmClient(ST_LIKE, 'vision').modelId).toBe('gemini:gemini-flash-latest')
  })

  it('GEMINI_MODEL_VISION 未設定でも vision は GEMINI_MODEL に落ちず既定 flash-latest を使う（事故の再発防止）', () => {
    const c = createLlmClient(
      { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'x', GEMINI_MODEL: 'gemini-flash-lite-latest' },
      'vision',
    )
    expect(c.modelId).toBe('gemini:gemini-flash-latest')
    expect(c.modelId).not.toContain('lite')
  })

  it('両 var 未設定なら text/vision とも既定 flash-latest（従来の既定を維持）', () => {
    const env = { LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'x' }
    expect(createLlmClient(env, 'text').modelId).toBe('gemini:gemini-flash-latest')
    expect(createLlmClient(env, 'vision').modelId).toBe('gemini:gemini-flash-latest')
  })

  it('ollama は modality によらず OLLAMA_MODEL（local 専用のため分離しない）', () => {
    const env = { LLM_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen2.5vl' }
    expect(createLlmClient(env, 'text').modelId).toBe('ollama:qwen2.5vl')
    expect(createLlmClient(env, 'vision').modelId).toBe('ollama:qwen2.5vl')
  })
})

// responseFormat による構造化出力スキーマの切替（text 日分割の日付発見コール。ADR-0017）
describe('responseFormat スキーマ切替', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const captureFetchBody = () => {
    const bodies: Array<Record<string, unknown>> = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { body: string }) => {
        bodies.push(JSON.parse(init.body))
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{}' }] } }], // gemini 形
            message: { content: '{}' }, // ollama 形（余分なキーは無視される）
          }),
          { status: 200 },
        )
      }),
    )
    return bodies
  }

  it('gemini: dateList 指定で responseSchema が dates スキーマに切り替わる', async () => {
    const bodies = captureFetchBody()
    const c = createLlmClient({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'x' }, 'text')
    await c.extract({ systemPrompt: 's', userText: 'u', responseFormat: 'dateList' })
    await c.extract({ systemPrompt: 's', userText: 'u' }) // 既定は extraction
    const schemaOf = (b: Record<string, unknown>) =>
      (b.generationConfig as { responseSchema: { properties: Record<string, unknown> } })
        .responseSchema.properties
    expect(Object.keys(schemaOf(bodies[0] ?? {}))).toEqual(['dates', 'notes'])
    expect(Object.keys(schemaOf(bodies[1] ?? {}))).toContain('screenings')
  })

  it('ollama: dateList 指定で format が dates スキーマに切り替わる', async () => {
    const bodies = captureFetchBody()
    const c = createLlmClient({ LLM_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen2.5' }, 'text')
    await c.extract({ systemPrompt: 's', userText: 'u', responseFormat: 'dateList' })
    await c.extract({ systemPrompt: 's', userText: 'u' })
    const formatOf = (b: Record<string, unknown>) =>
      (b.format as { properties: Record<string, unknown> }).properties
    expect(Object.keys(formatOf(bodies[0] ?? {}))).toEqual(['dates', 'notes'])
    expect(Object.keys(formatOf(bodies[1] ?? {}))).toContain('screenings')
  })
})
