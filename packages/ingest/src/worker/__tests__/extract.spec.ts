import { beforeEach, describe, expect, it, vi } from 'vitest'
import { extractTextWithRetries, extractVisionWithRetries } from '../extract'

// review指摘#2の回帰テスト: LLM APIエラーは最大2回・JSONパース不能/zod NGは
// 合算で最大1回、fetch 済み画像を使い回してリトライする（再取得はしない）。docs/06 §7。

const okResponse = (json: unknown) => ({
  raw: JSON.stringify(json),
  model: 'stub:model',
  inTokens: 1,
  outTokens: 1,
})

const VALID = { businessDate: '2026-07-10', screenings: [], notes: '休館日' }

let extractMock: ReturnType<typeof vi.fn>

vi.mock('../../llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../llm')>()
  return {
    ...actual,
    createLlmClient: vi.fn(() => ({ modelId: 'stub:model', extract: extractMock })),
  }
})

beforeEach(() => {
  extractMock = vi.fn()
})

describe('extractVisionWithRetries', () => {
  it('1回目で成功すれば即座に返す（リトライ無し）', async () => {
    extractMock.mockResolvedValueOnce(okResponse(VALID))
    const { result } = await extractVisionWithRetries({}, [], '2026-07')
    expect(result.businessDate).toBe('2026-07-10')
    expect(extractMock).toHaveBeenCalledTimes(1)
  })

  it('LLM APIエラーは最大2回リトライして成功できる（計3回呼出）', async () => {
    extractMock
      .mockRejectedValueOnce(new Error('gemini 500'))
      .mockRejectedValueOnce(new Error('gemini 500'))
      .mockResolvedValueOnce(okResponse(VALID))
    const { result } = await extractVisionWithRetries({}, [], '2026-07')
    expect(result.businessDate).toBe('2026-07-10')
    expect(extractMock).toHaveBeenCalledTimes(3)
  })

  it('LLM APIエラーが3回連続だと予算超過で throw する（計3回呼出で打ち切り）', async () => {
    extractMock.mockRejectedValue(new Error('gemini 500'))
    await expect(extractVisionWithRetries({}, [], '2026-07')).rejects.toThrow('gemini 500')
    expect(extractMock).toHaveBeenCalledTimes(3) // 初回 + 2回リトライ
  })

  it('JSONパース不能は最大1回リトライして成功できる（計2回呼出）', async () => {
    extractMock
      .mockResolvedValueOnce({ raw: 'not json', model: 'stub:model', inTokens: 1, outTokens: 1 })
      .mockResolvedValueOnce(okResponse(VALID))
    const { result } = await extractVisionWithRetries({}, [], '2026-07')
    expect(result.businessDate).toBe('2026-07-10')
    expect(extractMock).toHaveBeenCalledTimes(2)
  })

  it('JSONパース不能が2回連続だと予算超過で throw する', async () => {
    extractMock.mockResolvedValue({
      raw: 'not json',
      model: 'stub:model',
      inTokens: 1,
      outTokens: 1,
    })
    await expect(extractVisionWithRetries({}, [], '2026-07')).rejects.toThrow(/パース不能/)
    expect(extractMock).toHaveBeenCalledTimes(2) // 初回 + 1回リトライ
  })

  it('zod NG は最大1回リトライして成功できる', async () => {
    extractMock
      .mockResolvedValueOnce(okResponse({ businessDate: 'invalid-date', screenings: [] }))
      .mockResolvedValueOnce(okResponse(VALID))
    const { result } = await extractVisionWithRetries({}, [], '2026-07')
    expect(result.businessDate).toBe('2026-07-10')
    expect(extractMock).toHaveBeenCalledTimes(2)
  })

  it('zod NG が2回連続だと予算超過で throw する', async () => {
    extractMock.mockResolvedValue(okResponse({ businessDate: 'invalid-date', screenings: [] }))
    await expect(extractVisionWithRetries({}, [], '2026-07')).rejects.toThrow()
    expect(extractMock).toHaveBeenCalledTimes(2)
  })

  it('JSONパース不能とzod NGは予算を共有する（パース不能1回消費後のzod NGはリトライされない）', async () => {
    extractMock
      .mockResolvedValueOnce({ raw: 'not json', model: 'stub:model', inTokens: 1, outTokens: 1 }) // 予算消費
      .mockResolvedValueOnce(okResponse({ businessDate: 'invalid-date', screenings: [] })) // 予算切れ
    await expect(extractVisionWithRetries({}, [], '2026-07')).rejects.toThrow()
    expect(extractMock).toHaveBeenCalledTimes(2)
  })
})

describe('extractTextWithRetries（P4-7。リトライ予算は vision と共有実装）', () => {
  it('成功時: text_v1 の prompt_version と <page> ラッパで LLM を呼ぶ', async () => {
    extractMock.mockResolvedValueOnce(okResponse(VALID))
    const { ext, result } = await extractTextWithRetries(
      {},
      '<table><tr><td>ニッポン狂想曲 10:00</td></tr></table>',
      '2026-07',
      'http://example.com/schedule',
    )
    expect(result.businessDate).toBe('2026-07-10')
    expect(ext.promptVersion).toBe('text_v1')
    const input = extractMock.mock.calls[0]?.[0] as { systemPrompt: string; userText?: string }
    expect(input.systemPrompt).toContain('2026-07')
    expect(input.userText).toContain('<page url="http://example.com/schedule"')
    expect(input.userText).toContain('ニッポン狂想曲')
  })

  it('LLM APIエラーのリトライ予算（最大2回）を vision と同様に消化する', async () => {
    extractMock
      .mockRejectedValueOnce(new Error('gemini 500'))
      .mockResolvedValueOnce(okResponse(VALID))
    const { result } = await extractTextWithRetries({}, 'x', '2026-07', 'http://e.com/')
    expect(result.businessDate).toBe('2026-07-10')
    expect(extractMock).toHaveBeenCalledTimes(2)
  })
})
