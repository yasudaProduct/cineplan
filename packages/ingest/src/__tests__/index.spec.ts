import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Queue consumer の trigger 伝播（fix/p4-manual-ingest-orphan・docs/06 §7）。
// 管理サイトの手動取込は Queue に trigger='manual' を積んで投入する。cron 投入
// （trigger 省略）が従来どおり 'cron' にフォールバックすることも回帰確認する。

const ingestTheaterMock = vi.fn(async () => ({
  runId: 'run_1',
  status: 'succeeded',
  theaterId: 'thr_a',
}))

vi.mock('../worker/pipeline', () => ({
  FETCH_FAILED_NOTIFY_AT_ATTEMPT: 3,
  ingestTheater: ingestTheaterMock,
}))
vi.mock('../admin', () => ({ adminApp: new Hono() }))
vi.mock('../cron/travel-matrix', () => ({ buildTravelMatrix: vi.fn() }))
vi.mock('../db/theaters', () => ({ listActiveTheaters: vi.fn(async () => []) }))
vi.mock('../worker/notify', () => ({ sendSlack: vi.fn(async () => {}) }))

const handler = (await import('../index')).default

function fakeMessage(body: unknown, attempts = 1) {
  return {
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

beforeEach(() => {
  ingestTheaterMock.mockClear()
})

describe('queue() — trigger 伝播', () => {
  it('trigger=manual のメッセージは ingestTheater に manual を渡す（管理サイトの手動取込）', async () => {
    const msg = fakeMessage({ theaterId: 'thr_a', trigger: 'manual' }, 1)
    await handler.queue({ messages: [msg] } as never, {} as never)
    expect(ingestTheaterMock).toHaveBeenCalledWith({}, 'thr_a', 'manual', 1)
    expect(msg.ack).toHaveBeenCalledTimes(1)
  })

  it('trigger 省略のメッセージは従来どおり cron にフォールバックする（回帰）', async () => {
    const msg = fakeMessage({ theaterId: 'thr_a' }, 1)
    await handler.queue({ messages: [msg] } as never, {} as never)
    expect(ingestTheaterMock).toHaveBeenCalledWith({}, 'thr_a', 'cron', 1)
  })

  it('theaterId が無いメッセージは ingestTheater を呼ばず ack する', async () => {
    const msg = fakeMessage({}, 1)
    await handler.queue({ messages: [msg] } as never, {} as never)
    expect(ingestTheaterMock).not.toHaveBeenCalled()
    expect(msg.ack).toHaveBeenCalledTimes(1)
  })
})
