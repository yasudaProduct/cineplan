import { describe, expect, it } from 'vitest'
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
