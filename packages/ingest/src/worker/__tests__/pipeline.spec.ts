import type { TheaterRecord } from '@cinema/shared'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// review指摘#2の回帰テスト: fetch_failed は最終試行(attempt>=3)のときのみ Slack 通知する
// （毎回通知すると Queues の再配信のたびにスパムになるため）。docs/spec/06 §7。

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
  fetchDayMode: 'single',
  fetchDays: 1,
  officialUrl: 'http://example.com/',
  termsNote: null,
  termsCheckedAt: '2026-07-10T00:00:00Z',
  robotsStatus: 'allowed',
}

const getTheaterMock = vi.fn(async () => compliantTheater)
const createIngestRunMock = vi.fn(async () => 'run_1')
const failRunMock = vi.fn(async () => {})
const fetchScheduleMock = vi.fn()
const fetchRenderedMock = vi.fn()
const sendSlackMock = vi.fn(async () => {})
const extractVisionMock = vi.fn()
const extractTextDaySplitMock = vi.fn()
const extractPerDocumentMock = vi.fn()
const fetchTemplateMock = vi.fn()

vi.mock('../../db/theaters', () => ({ getTheater: getTheaterMock, listActiveTheaters: vi.fn() }))
vi.mock('../../db/ingest-runs', () => ({
  createIngestRun: createIngestRunMock,
  updateRunStatus: vi.fn(async () => {}),
  completeRun: vi.fn(async () => {}),
  failRun: failRunMock,
}))
vi.mock('../fetch', () => ({
  fetchSchedule: fetchScheduleMock,
  fetchRenderedSchedule: fetchRenderedMock,
  fetchScheduleByDateTemplate: fetchTemplateMock,
}))
vi.mock('../notify', () => ({ sendSlack: sendSlackMock }))
vi.mock('../extract', () => ({
  extractVisionWithRetries: extractVisionMock,
  extractTextDaySplit: extractTextDaySplitMock,
  extractTextPerDocument: extractPerDocumentMock,
  EXTRACTION_DEADLINE_MS: 10 * 60_000,
}))
vi.mock('../../db/movies', () => ({ resolveMovieId: vi.fn(async () => 'mov_1') }))
vi.mock('../../db/screenings', () => ({ replaceScreeningsByDate: vi.fn(async () => 1) }))
vi.mock('../../db/reviews', () => ({
  createReview: vi.fn(async () => 'rev_1'),
  recentAvgCount: vi.fn(async () => undefined),
}))

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

// P4-7: fetch_method / extract_method の分岐
describe('ingestTheater — rendered + text 分岐（P4-7）', () => {
  const okOutcome = {
    ext: {
      parsed: {},
      raw: '{}',
      model: 'stub:m',
      promptVersion: 'text_v1',
      inTokens: 1,
      outTokens: 1,
    },
    result: {
      businessDate: '2026-07-13',
      screenings: [
        {
          date: '2026-07-14',
          movieTitle: 'A',
          startTime: '10:00',
          endTime: null,
          screenName: null,
          format: null,
          detailPath: null,
        },
      ],
      notes: null,
    },
  }

  it('fetchMethod=rendered は Browser Rendering 経由で取得し、text 抽出（日分割）で succeeded になる', async () => {
    getTheaterMock.mockResolvedValue({
      ...compliantTheater,
      fetchMethod: 'rendered',
      extractMethod: 'text',
    })
    fetchRenderedMock.mockResolvedValue({
      scheduleHtml: '<div id="app"><table>…</table></div>',
      images: [],
      fetchedAt: '2026-07-13T00:00:00.000Z',
    })
    extractTextDaySplitMock.mockResolvedValue(okOutcome)
    const r = await ingestTheater({ SNAPSHOTS: { put: vi.fn() } } as never, 'thr_test', 'manual')
    expect(r.status).toBe('succeeded')
    expect(fetchRenderedMock).toHaveBeenCalledTimes(1)
    expect(fetchScheduleMock).not.toHaveBeenCalled()
    expect(extractTextDaySplitMock).toHaveBeenCalledTimes(1)
    expect(extractVisionMock).not.toHaveBeenCalled()
    // htmlToText 済みテキスト（タグ簡約）・scheduleUrl・取込日（businessDate）が渡る
    const args = extractTextDaySplitMock.mock.calls[0] as unknown[]
    expect(String(args[1])).toContain('<table>')
    expect(args[3]).toBe('http://example.com/schedule')
    expect(String(args[4])).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('static+vision は従来どおり fetchSchedule + vision 抽出（回帰）', async () => {
    getTheaterMock.mockResolvedValue(compliantTheater)
    fetchScheduleMock.mockResolvedValue({
      scheduleHtml: '<html/>',
      images: [{ url: 'u', mimeType: 'image/gif', bytes: new ArrayBuffer(4), lastModified: null }],
      fetchedAt: '2026-07-13T00:00:00.000Z',
    })
    extractVisionMock.mockResolvedValue(okOutcome)
    const r = await ingestTheater({ SNAPSHOTS: { put: vi.fn() } } as never, 'thr_test', 'manual')
    expect(r.status).toBe('succeeded')
    expect(extractVisionMock).toHaveBeenCalledTimes(1)
    expect(extractTextDaySplitMock).not.toHaveBeenCalled()
  })

  it('vision なのに画像 0 件は extraction_failed', async () => {
    getTheaterMock.mockResolvedValue(compliantTheater)
    fetchScheduleMock.mockResolvedValue({
      scheduleHtml: '<html/>',
      images: [],
      fetchedAt: '2026-07-13T00:00:00.000Z',
    })
    const r = await ingestTheater({ SNAPSHOTS: { put: vi.fn() } } as never, 'thr_test', 'manual')
    expect(r.status).toBe('extraction_failed')
    expect(r.error).toContain('スケジュール画像')
  })
})

// ADR-0019: 複数日取得（tabs / url_template）
describe('ingestTheater — 複数日取得（ADR-0019）', () => {
  const okOutcome = {
    ext: {
      parsed: {},
      raw: '',
      model: 'stub:m',
      promptVersion: 'text_v3',
      inTokens: 2,
      outTokens: 2,
    },
    result: {
      businessDate: '2026-07-25',
      screenings: [
        {
          date: '2026-07-25',
          movieTitle: 'A',
          startTime: '10:00',
          endTime: null,
          screenName: null,
          format: null,
          detailPath: null,
        },
      ],
      notes: null,
    },
  }

  it('tabs: 日別文書を _d{date}.html に保存し、extractTextPerDocument で抽出する', async () => {
    getTheaterMock.mockResolvedValue({
      ...compliantTheater,
      fetchMethod: 'rendered',
      extractMethod: 'text',
      fetchDayMode: 'tabs',
      fetchDays: 2,
    })
    fetchRenderedMock.mockResolvedValue({
      scheduleHtml: '<table>day1</table>',
      images: [],
      fetchedAt: '2026-07-25T00:00:00.000Z',
      days: [
        { date: '2026-07-25', html: '<table>day1</table>', url: 'http://example.com/schedule' },
        { date: '2026-07-26', html: '<table>day2</table>', url: 'http://example.com/schedule' },
      ],
      dayNotes: [],
    })
    extractPerDocumentMock.mockResolvedValue(okOutcome)
    const put = vi.fn()
    const r = await ingestTheater({ SNAPSHOTS: { put } } as never, 'thr_test', 'manual')
    expect(r.status).toBe('succeeded')
    // 既定文書 .html + 日別 _d{date}.html × 2
    const keys = put.mock.calls.map((c) => String(c[0]))
    expect(keys.filter((k) => k.endsWith('_d2026-07-25.html'))).toHaveLength(1)
    expect(keys.filter((k) => k.endsWith('_d2026-07-26.html'))).toHaveLength(1)
    expect(keys.filter((k) => /\/[^/]*\.html$/.test(k) && !k.includes('_d'))).toHaveLength(1)
    // 日付発見コール経路（単日分割）ではなく文書ごとの抽出が呼ばれる
    expect(extractPerDocumentMock).toHaveBeenCalledTimes(1)
    expect(extractTextDaySplitMock).not.toHaveBeenCalled()
    const docs = extractPerDocumentMock.mock.calls[0]?.[1] as Array<{ date: string; text: string }>
    expect(docs.map((d) => d.date)).toEqual(['2026-07-25', '2026-07-26'])
    // tabs でも rendered fetch に dayMode が渡る
    expect(fetchRenderedMock.mock.calls[0]?.[2]).toMatchObject({ dayMode: 'tabs', days: 2 })
  })

  it('tabs でタブ0件（days 無し）なら従来の単日分割経路にフォールバックする', async () => {
    getTheaterMock.mockResolvedValue({
      ...compliantTheater,
      fetchMethod: 'rendered',
      extractMethod: 'text',
      fetchDayMode: 'tabs',
      fetchDays: 3,
    })
    fetchRenderedMock.mockResolvedValue({
      scheduleHtml: '<table>only</table>',
      images: [],
      fetchedAt: '2026-07-25T00:00:00.000Z',
    })
    extractTextDaySplitMock.mockResolvedValue(okOutcome)
    const r = await ingestTheater({ SNAPSHOTS: { put: vi.fn() } } as never, 'thr_test', 'manual')
    expect(r.status).toBe('succeeded')
    expect(extractTextDaySplitMock).toHaveBeenCalledTimes(1)
    expect(extractPerDocumentMock).not.toHaveBeenCalled()
  })

  it('url_template: static でもブラウザを使わず日付ごとに取得する', async () => {
    getTheaterMock.mockResolvedValue({
      ...compliantTheater,
      fetchMethod: 'static',
      extractMethod: 'text',
      scheduleUrl: 'http://example.com/s?d={date}',
      fetchDayMode: 'url_template',
      fetchDays: 2,
    })
    fetchTemplateMock.mockResolvedValue({
      scheduleHtml: '<table>d1</table>',
      images: [],
      fetchedAt: '2026-07-25T00:00:00.000Z',
      days: [
        { date: '2026-07-25', html: '<table>d1</table>', url: 'http://example.com/s?d=2026-07-25' },
        { date: '2026-07-26', html: '<table>d2</table>', url: 'http://example.com/s?d=2026-07-26' },
      ],
      dayNotes: [],
    })
    extractPerDocumentMock.mockResolvedValue(okOutcome)
    const r = await ingestTheater({ SNAPSHOTS: { put: vi.fn() } } as never, 'thr_test', 'manual')
    expect(r.status).toBe('succeeded')
    expect(fetchTemplateMock).toHaveBeenCalledTimes(1)
    expect(fetchScheduleMock).not.toHaveBeenCalled()
    expect(fetchRenderedMock).not.toHaveBeenCalled()
  })

  it('tabs なのに fetchMethod=static の不正設定は single に縮退する（手書きSQL対策）', async () => {
    getTheaterMock.mockResolvedValue({
      ...compliantTheater,
      fetchMethod: 'static',
      extractMethod: 'text',
      fetchDayMode: 'tabs',
      fetchDays: 3,
    })
    fetchScheduleMock.mockResolvedValue({
      scheduleHtml: '<table>x</table>',
      images: [],
      fetchedAt: '2026-07-25T00:00:00.000Z',
    })
    extractTextDaySplitMock.mockResolvedValue(okOutcome)
    const r = await ingestTheater({ SNAPSHOTS: { put: vi.fn() } } as never, 'thr_test', 'manual')
    expect(r.status).toBe('succeeded')
    expect(fetchScheduleMock).toHaveBeenCalledTimes(1)
    expect(fetchRenderedMock).not.toHaveBeenCalled()
    expect(fetchTemplateMock).not.toHaveBeenCalled()
  })
})
