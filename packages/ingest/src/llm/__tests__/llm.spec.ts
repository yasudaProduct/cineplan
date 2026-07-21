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
    expect(() => createLlmClient({ LLM_PROVIDER: 'gemini' })).toThrow(/GEMINI_API_KEY/)
  })
  it('gemini は modelId が gemini:*', () => {
    const c = createLlmClient({
      LLM_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'x',
      GEMINI_MODEL: 'gemini-flash-latest',
    })
    expect(c.modelId).toBe('gemini:gemini-flash-latest')
  })
  it('ollama は modelId が ollama:*', () => {
    const c = createLlmClient({ LLM_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen2-vl' })
    expect(c.modelId).toBe('ollama:qwen2-vl')
  })
  it('未実装 provider はエラー', () => {
    expect(() => createLlmClient({ LLM_PROVIDER: 'workers-ai' })).toThrow(/未実装/)
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
    const c = createLlmClient({ LLM_PROVIDER: 'gemini', GEMINI_API_KEY: 'x' })
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
    const c = createLlmClient({ LLM_PROVIDER: 'ollama', OLLAMA_MODEL: 'qwen2.5' })
    await c.extract({ systemPrompt: 's', userText: 'u', responseFormat: 'dateList' })
    await c.extract({ systemPrompt: 's', userText: 'u' })
    const formatOf = (b: Record<string, unknown>) =>
      (b.format as { properties: Record<string, unknown> }).properties
    expect(Object.keys(formatOf(bodies[0] ?? {}))).toEqual(['dates', 'notes'])
    expect(Object.keys(formatOf(bodies[1] ?? {}))).toContain('screenings')
  })
})
