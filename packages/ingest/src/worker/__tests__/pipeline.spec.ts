import type { TheaterRecord } from '@cinema/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// review指摘#2の回帰テスト: fetch_failed は最終試行(attempt>=3)のときのみ Slack 通知する
// （毎回通知すると Queues の再配信のたびにスパムになるため）。docs/06 §7。

const compliantTheater: TheaterRecord = {
  id: 'thr_test',
  name: 'テスト劇場',
  shortName: null,
  status: 'active',
  lat: 34.7,
  lng: 135.5,
  nearestStation: '大阪',
  walkMinFromSta: 5,
  scheduleUrl: 'http://example.com/schedule',
  fetchMethod: 'static',
  extractMethod: 'vision',
  officialUrl: 'http://example.com/',
  termsNote: null,
  termsCheckedAt: '2026-07-10T00:00:00Z',
  robotsStatus: 'allowed',
}

const getTheaterMock = vi.fn(async () => compliantTheater)
const createIngestRunMock = vi.fn(async () => 'run_1')
const failRunMock = vi.fn(async () => {})
const fetchScheduleMock = vi.fn()
const sendSlackMock = vi.fn(async () => {})

vi.mock('../../db/theaters', () => ({ getTheater: getTheaterMock, listActiveTheaters: vi.fn() }))
vi.mock('../../db/ingest-runs', () => ({
  createIngestRun: createIngestRunMock,
  updateRunStatus: vi.fn(async () => {}),
  completeRun: vi.fn(async () => {}),
  failRun: failRunMock,
}))
vi.mock('../fetch', () => ({ fetchSchedule: fetchScheduleMock }))
vi.mock('../notify', () => ({ sendSlack: sendSlackMock }))

const { ingestTheater } = await import('../pipeline')

beforeEach(() => {
  vi.clearAllMocks()
  getTheaterMock.mockResolvedValue(compliantTheater)
  createIngestRunMock.mockResolvedValue('run_1')
  fetchScheduleMock.mockRejectedValue(new Error('network error'))
})

describe('ingestTheater — fetch_failed の通知タイミング（review指摘#2）', () => {
  it('attempt=1（Queue初回）は fetch_failed でも Slack 通知しない', async () => {
    const r = await ingestTheater({} as never, 'thr_test', 'cron', 1)
    expect(r.status).toBe('fetch_failed')
    expect(failRunMock).toHaveBeenCalledTimes(1)
    expect(sendSlackMock).not.toHaveBeenCalled()
  })

  it('attempt=2 もまだ通知しない', async () => {
    await ingestTheater({} as never, 'thr_test', 'cron', 2)
    expect(sendSlackMock).not.toHaveBeenCalled()
  })

  it('attempt=3（最終試行）で Slack 通知する', async () => {
    await ingestTheater({} as never, 'thr_test', 'cron', 3)
    expect(sendSlackMock).toHaveBeenCalledTimes(1)
    expect(sendSlackMock).toHaveBeenCalledWith(undefined, expect.stringContaining('fetch_failed'))
  })

  it('手動取込(manual)は attempt 省略時デフォルト1でも即通知する必要はない（現状の仕様: attempt=1は非通知）', async () => {
    // 手動取込は Queue 経由しないため常に attempt=1（デフォルト）。
    // fetch_failed 自体はレスポンスの error フィールドでユーザーに即時可視化されるため、
    // Slack 通知が無くても取込失敗はレスポンスから分かる。
    const r = await ingestTheater({} as never, 'thr_test', 'manual')
    expect(r.status).toBe('fetch_failed')
    expect(r.error).toBe('network error')
  })

  it('failRun には常に記録する（通知の有無に関わらず ingest_runs の状態は正しく残す）', async () => {
    await ingestTheater({} as never, 'thr_test', 'cron', 1)
    expect(failRunMock).toHaveBeenCalledWith(
      undefined,
      'run_1',
      expect.objectContaining({ status: 'fetch_failed', errorMessage: 'network error' }),
    )
  })
})
