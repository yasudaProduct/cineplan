import { Hono } from 'hono'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// Queue consumer の trigger 伝播（fix/p4-manual-ingest-orphan・fix/reextract-orphan・docs/06 §7）。
// 管理サイトの手動取込は Queue に trigger='manual' を積んで投入する。cron 投入
// （trigger 省略）が従来どおり 'cron' にフォールバックすることも回帰確認する。
// 再抽出（reextractRunId）も同じ Queue から処理する（大きな rendered ページで抽出自体が
// 数分かかり、同期実行だと接続断で孤児化することが実機で判明したため）。
//
// P1-6（Cron + Queues 配線）の残作業は「実 Queues の再配信」「実 Cron 発火」の ST 確認だが、
// ST の検証機会は取得マナー（N-06: 1劇場1日1セッション）により1日1回しか無い。
// 実機を撃つ前に判定ロジックをここで固定する。

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
const buildTravelMatrixMock = vi.fn(async () => ({
  theaters: 5,
  pairs: 20,
  updated: 20,
  carried: 0,
  missing: 0,
  skippedWrite: false,
}))
const runRetentionMock = vi.fn(async () => ({
  screenings: 12,
  reviews: 1,
  ingestRuns: 3,
  sharedPlans: 2,
}))
const listActiveTheatersMock = vi.fn(async (): Promise<{ id: string }[]> => [])
const sendSlackMock = vi.fn(async () => {})

vi.mock('../worker/pipeline', () => ({
  FETCH_FAILED_NOTIFY_AT_ATTEMPT: 3,
  ingestTheater: ingestTheaterMock,
}))
vi.mock('../worker/reextract', () => ({
  reextractFromSnapshot: reextractFromSnapshotMock,
}))
vi.mock('../admin', () => ({ adminApp: new Hono() }))
vi.mock('../cron/travel-matrix', () => ({ buildTravelMatrix: buildTravelMatrixMock }))
vi.mock('../cron/retention', () => ({ runRetention: runRetentionMock }))
vi.mock('../db/theaters', () => ({ listActiveTheaters: listActiveTheatersMock }))
vi.mock('../worker/notify', () => ({ sendSlack: sendSlackMock }))

const handler = (await import('../index')).default

function fakeMessage(body: unknown, attempts = 1) {
  return {
    body,
    attempts,
    ack: vi.fn(),
    retry: vi.fn(),
  }
}

function fakeEnv() {
  const send = vi.fn(async () => {})
  const env = {
    DB: {} as never,
    INGEST_QUEUE: { send },
    SLACK_WEBHOOK_URL: 'https://hooks.example.test/webhook',
  }
  return { env, send }
}

beforeEach(() => {
  ingestTheaterMock.mockClear()
  reextractFromSnapshotMock.mockClear()
  buildTravelMatrixMock.mockClear()
  runRetentionMock.mockClear()
  listActiveTheatersMock.mockClear()
  sendSlackMock.mockClear()
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

// docs/06 §7: 再取得（先方サイトへの再アクセス）を伴うリトライは fetch_failed のみ。
// 指数バックオフ（初回5分後・以降倍々）は Queues 任せではなく consumer が
// msg.retry({delaySeconds}) で明示的に計算する（wrangler.toml のコメントと対）。
// 実キューでの再配信そのものは ST でしか確認できないが、「いつ retry を呼び、
// いつ ack で打ち切るか」の判定はここで固定する。
describe('queue() — fetch_failed の指数バックオフと打ち切り（docs/06 §7）', () => {
  function fetchFailedOnce() {
    ingestTheaterMock.mockResolvedValueOnce({
      runId: 'run_f',
      status: 'fetch_failed',
      theaterId: 'thr_a',
    })
  }

  it('1回目の fetch_failed は 300秒（5分）後に retry する', async () => {
    fetchFailedOnce()
    const msg = fakeMessage({ theaterId: 'thr_a', trigger: 'cron' }, 1)
    await handler.queue({ messages: [msg] } as never, {} as never)
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 300 })
    expect(msg.ack).not.toHaveBeenCalled()
  })

  it('2回目の fetch_failed は 600秒（10分）後に retry する（倍々）', async () => {
    fetchFailedOnce()
    const msg = fakeMessage({ theaterId: 'thr_a', trigger: 'cron' }, 2)
    await handler.queue({ messages: [msg] } as never, {} as never)
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 600 })
    expect(msg.ack).not.toHaveBeenCalled()
  })

  it('3回目（FETCH_FAILED_NOTIFY_AT_ATTEMPT 到達）は retry せず ack で打ち切る', async () => {
    fetchFailedOnce()
    const msg = fakeMessage({ theaterId: 'thr_a', trigger: 'cron' }, 3)
    await handler.queue({ messages: [msg] } as never, {} as never)
    expect(msg.retry).not.toHaveBeenCalled()
    expect(msg.ack).toHaveBeenCalledTimes(1)
  })

  it('msg.attempts を ingestTheater に渡す（Slack 通知を最終試行だけに絞る silent 判定の材料）', async () => {
    fetchFailedOnce()
    const msg = fakeMessage({ theaterId: 'thr_a', trigger: 'cron' }, 3)
    await handler.queue({ messages: [msg] } as never, {} as never)
    expect(ingestTheaterMock).toHaveBeenCalledWith({}, 'thr_a', 'cron', 3)
  })

  it('手動取込（trigger=manual）の fetch_failed も同じ再配信対象になる（Queue 経由化の帰結）', async () => {
    fetchFailedOnce()
    const msg = fakeMessage({ theaterId: 'thr_a', trigger: 'manual' }, 1)
    await handler.queue({ messages: [msg] } as never, {} as never)
    expect(msg.retry).toHaveBeenCalledWith({ delaySeconds: 300 })
  })

  it.each([
    'extraction_failed',
    'validation_failed',
    'succeeded',
  ])('status=%s は再取得を伴う再試行をしないので即 ack（fetch_failed 以外はリトライ対象外）', async (status) => {
    ingestTheaterMock.mockResolvedValueOnce({ runId: 'run_x', status, theaterId: 'thr_a' })
    const msg = fakeMessage({ theaterId: 'thr_a', trigger: 'cron' }, 1)
    await handler.queue({ messages: [msg] } as never, {} as never)
    expect(msg.retry).not.toHaveBeenCalled()
    expect(msg.ack).toHaveBeenCalledTimes(1)
  })
})

// scheduled() は controller.cron の**文字列リテラル完全一致**で分岐する（index.ts の MATRIX_CRON）。
// wrangler.toml [env.prod.triggers] の crons と1文字でもずれると、TravelMatrix 週次が
// 取込ディスパッチ側に落ちる（またはその逆）ため、両方の cron 式を実値で固定する。
describe('scheduled() — cron 分岐（docs/14 §3.2）', () => {
  const INGEST_CRON = '0 21 * * *' // 毎日 06:00 JST（N-02 の鮮度要件）
  const MATRIX_CRON = '0 18 * * 1' // 月曜 18:00 UTC = 火曜 03:00 JST（ADR-0014）
  const RETENTION_CRON = '0 17 * * *' // 毎日 02:00 JST（P5-5・docs/11 §7）

  it('取込 cron は active 劇場を全件 trigger=cron で Queue 投入する（P1-6 の本体）', async () => {
    listActiveTheatersMock.mockResolvedValueOnce([
      { id: 'thr_a' },
      { id: 'thr_b' },
      { id: 'thr_c' },
      { id: 'thr_d' },
      { id: 'thr_e' },
    ])
    const { env, send } = fakeEnv()
    await handler.scheduled({ cron: INGEST_CRON } as never, env as never)
    expect(send).toHaveBeenCalledTimes(5)
    expect(send).toHaveBeenNthCalledWith(1, { theaterId: 'thr_a', trigger: 'cron' })
    expect(send).toHaveBeenNthCalledWith(5, { theaterId: 'thr_e', trigger: 'cron' })
    expect(buildTravelMatrixMock).not.toHaveBeenCalled()
  })

  it('active 劇場が0件なら Queue に何も投入しない（全館 paused 時の回帰）', async () => {
    listActiveTheatersMock.mockResolvedValueOnce([])
    const { env, send } = fakeEnv()
    await handler.scheduled({ cron: INGEST_CRON } as never, env as never)
    expect(send).not.toHaveBeenCalled()
  })

  it('TravelMatrix cron は行列を再生成し、取込は一切ディスパッチしない', async () => {
    const { env, send } = fakeEnv()
    await handler.scheduled({ cron: MATRIX_CRON } as never, env as never)
    expect(buildTravelMatrixMock).toHaveBeenCalledTimes(1)
    expect(listActiveTheatersMock).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(sendSlackMock).toHaveBeenCalledTimes(1)
  })

  it('RETENTION_CRON はデータ保持削除のみ実行し、取込・行列は動かさない（P5-5）', async () => {
    const { env, send } = fakeEnv()
    await handler.scheduled({ cron: RETENTION_CRON } as never, env as never)
    expect(runRetentionMock).toHaveBeenCalledTimes(1)
    expect(listActiveTheatersMock).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(buildTravelMatrixMock).not.toHaveBeenCalled()
  })

  it('取込 cron はデータ保持削除を動かさない（分岐の排他）', async () => {
    listActiveTheatersMock.mockResolvedValueOnce([{ id: 'thr_a' }])
    const { env } = fakeEnv()
    await handler.scheduled({ cron: INGEST_CRON } as never, env as never)
    expect(runRetentionMock).not.toHaveBeenCalled()
  })

  it('MATRIX_CRON 以外の cron 式は取込ディスパッチに落ちる（ST 一時 cron が行列側に吸われない）', async () => {
    // ST の実 Cron 検証では消し忘れ対策に日付固定の one-shot 式を使う（docs/14 §3.2 の
    // 「検証したい期間だけ一時有効化」）。この式は MATRIX_CRON と一致しないため取込側に落ちる。
    listActiveTheatersMock.mockResolvedValueOnce([{ id: 'thr_a' }])
    const { env, send } = fakeEnv()
    await handler.scheduled({ cron: '30 6 28 7 *' } as never, env as never)
    expect(send).toHaveBeenCalledWith({ theaterId: 'thr_a', trigger: 'cron' })
    expect(buildTravelMatrixMock).not.toHaveBeenCalled()
  })
})
