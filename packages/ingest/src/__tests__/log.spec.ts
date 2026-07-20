import { afterEach, describe, expect, it, vi } from 'vitest'
import { errorFields, logError, logInfo } from '../log'

// 構造化ログ（feat/ingest-observability）。Workers Logs はオブジェクトをフィールド単位で
// インデックスするため、「単一オブジェクト・event キー必須・エラーは name+message(500字上限)」
// の形をここで固定する。

afterEach(() => {
  vi.restoreAllMocks()
})

describe('logInfo', () => {
  it('event とフィールドを1つのオブジェクトにして console.log に渡す', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logInfo('run.done', { runId: 'run_1', status: 'succeeded' })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith({ event: 'run.done', runId: 'run_1', status: 'succeeded' })
  })

  it('フィールド省略時は event のみのオブジェクト', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logInfo('cron.dispatch.done')
    expect(spy).toHaveBeenCalledWith({ event: 'cron.dispatch.done' })
  })
})

describe('logError', () => {
  it('Error は name + message に変換して console.error に渡す', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('queue.error', new TypeError('boom'), { theaterId: 'thr_a' })
    expect(spy).toHaveBeenCalledWith({
      event: 'queue.error',
      theaterId: 'thr_a',
      error: { name: 'TypeError', message: 'boom' },
    })
  })

  it('Error でない値も message に文字列化される', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('queue.error', 'raw string failure')
    expect(spy).toHaveBeenCalledWith({
      event: 'queue.error',
      error: { name: 'unknown', message: 'raw string failure' },
    })
  })
})

describe('errorFields', () => {
  it('message は500文字で打ち切る（巨大な LLM エラーボディをログへ流し込まない）', () => {
    const { message } = errorFields(new Error('x'.repeat(2000)))
    expect(message).toHaveLength(500)
  })
})
