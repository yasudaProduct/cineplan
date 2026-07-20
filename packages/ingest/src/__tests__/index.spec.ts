import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Queue consumer の trigger 伝播（fix/p4-manual-ingest-orphan・fix/reextract-orphan・docs/06 §7）。
// 管理サイトの手動取込は Queue に trigger='manual' を積んで投入する。cron 投入
// （trigger 省略）が従来どおり 'cron' にフォールバックすることも回帰確認する。
// 再抽出（reextractRunId）も同じ Queue から処理する（大きな rendered ページで抽出自体が
// 数分かかり、同期実行だと接続断で孤児化することが実機で判明したため）。

const ingestTheaterMock = vi.fn(async () => ({
  runId: 'run_1',
  status: 'succeeded',
  theaterId: 'thr_a',
}))
const reextractFromSnapshotMock = vi.fn(async () => ({
  runId: 'run_2',
  status: 'succeeded',
  theaterId: 'thr_a',
}))

vi.mock('../worker/pipeline', () => ({
  FETCH_FAILED_NOTIFY_AT_ATTEMPT: 3,
  ingestTheater: ingestTheaterMock,
}))
vi.mock('../worker/reextract', () => ({
  reextractFromSnapshot: reextractFromSnapshotMock,
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
  reextractFromSnapshotMock.mockClear()
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

describe('queue() — 再抽出（fix/reextract-orphan）', () => {
  it('reextractRunId のメッセージは reextractFromSnapshot を呼び ingestTheater は呼ばない', async () => {
    const msg = fakeMessage({ reextractRunId: 'run_source' }, 1)
    await handler.queue({ messages: [msg] } as never, {} as never)
    expect(reextractFromSnapshotMock).toHaveBeenCalledWith({}, 'run_source')
    expect(ingestTheaterMock).not.toHaveBeenCalled()
    expect(msg.ack).toHaveBeenCalledTimes(1)
  })

  it('reextractFromSnapshot が結果を返した場合（succeeded/extraction_failed 等）は常に ack（Queue再試行しない）', async () => {
    reextractFromSnapshotMock.mockResolvedValueOnce({
      runId: 'run_2',
      status: 'extraction_failed',
      theaterId: 'thr_a',
    })
    const msg = fakeMessage({ reextractRunId: 'run_source' }, 1)
    await handler.queue({ messages: [msg] } as never, {} as never)
    expect(msg.ack).toHaveBeenCalledTimes(1)
    expect(msg.retry).not.toHaveBeenCalled()
  })

  it('reextractFromSnapshot が throw（SnapshotNotFoundError等の恒久的失敗）しても ack して打ち切る', async () => {
    reextractFromSnapshotMock.mockRejectedValueOnce(new Error('snapshot not found'))
    const msg = fakeMessage({ reextractRunId: 'run_source' }, 1)
    await handler.queue({ messages: [msg] } as never, {} as never)
    expect(msg.ack).toHaveBeenCalledTimes(1)
    expect(msg.retry).not.toHaveBeenCalled()
  })
})
