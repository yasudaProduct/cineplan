import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Env } from '../../env'
import {
  checkDailyCostAlert,
  DEFAULT_DAILY_IN_TOKEN_ALERT,
  dailyInTokenThreshold,
} from '../cost-alert'

// LLM コスト急増アラート（P5-6・docs/spec/06 §8・N-07）。
// 閾値跨ぎ方式: 「この run で初めて閾値以上になった」ときだけ通知する。
// Queue は直列消費（max_concurrency=1）のため、通知済みフラグ無しで1日1回に収まる。

const slackCalls: string[] = []
vi.mock('../notify', () => ({
  sendSlack: vi.fn(async (_url: string | undefined, text: string) => {
    slackCalls.push(text)
  }),
}))

afterEach(() => {
  slackCalls.length = 0
})

function fakeEnv(row: { total: number; thisRun: number } | { throwError: true }): Env {
  return {
    DB: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                if ('throwError' in row) throw new Error('D1 down')
                return { total: row.total, thisRun: row.thisRun }
              },
            }
          },
        }
      },
    },
    SLACK_WEBHOOK_URL: 'https://hooks.example.test/x',
  } as unknown as Env
}

describe('dailyInTokenThreshold', () => {
  it('未設定は既定 500万（docs/spec/06 §8 の初期値）', () => {
    expect(dailyInTokenThreshold({} as Env)).toBe(DEFAULT_DAILY_IN_TOKEN_ALERT)
    expect(DEFAULT_DAILY_IN_TOKEN_ALERT).toBe(5_000_000)
  })
  it('var で上書きできる。不正値（非数・0・負）は既定に落ちる', () => {
    expect(dailyInTokenThreshold({ COST_ALERT_DAILY_IN_TOKENS: '1000000' } as Env)).toBe(1_000_000)
    expect(dailyInTokenThreshold({ COST_ALERT_DAILY_IN_TOKENS: 'abc' } as Env)).toBe(
      DEFAULT_DAILY_IN_TOKEN_ALERT,
    )
    expect(dailyInTokenThreshold({ COST_ALERT_DAILY_IN_TOKENS: '0' } as Env)).toBe(
      DEFAULT_DAILY_IN_TOKEN_ALERT,
    )
    expect(dailyInTokenThreshold({ COST_ALERT_DAILY_IN_TOKENS: '-5' } as Env)).toBe(
      DEFAULT_DAILY_IN_TOKEN_ALERT,
    )
  })
})

describe('checkDailyCostAlert — 閾値跨ぎ判定', () => {
  it('この run で閾値を跨いだら Slack 通知する（before < 閾値 <= total）', async () => {
    // total 5,100,000 のうちこの run が 200,000 → before 4,900,000 < 5,000,000
    await checkDailyCostAlert(fakeEnv({ total: 5_100_000, thisRun: 200_000 }), 'run_x')
    expect(slackCalls).toHaveLength(1)
    expect(slackCalls[0]).toContain('LLMトークン急増')
    expect(slackCalls[0]).toContain('5,100,000')
  })

  it('閾値未満なら通知しない', async () => {
    await checkDailyCostAlert(fakeEnv({ total: 4_999_999, thisRun: 100_000 }), 'run_x')
    expect(slackCalls).toHaveLength(0)
  })

  it('既に超過済み（前の run が跨いだ後）は再通知しない = 1日1回に収まる', async () => {
    // before = 5,200,000 - 100,000 = 5,100,000 >= 閾値 → この run は跨いでいない
    await checkDailyCostAlert(fakeEnv({ total: 5_200_000, thisRun: 100_000 }), 'run_x')
    expect(slackCalls).toHaveLength(0)
  })

  it('ちょうど閾値に到達した run も通知する（total >= threshold）', async () => {
    await checkDailyCostAlert(fakeEnv({ total: 5_000_000, thisRun: 1 }), 'run_x')
    expect(slackCalls).toHaveLength(1)
  })

  it('集計クエリの失敗は握りつぶす（アラートは運用補助で run の成否に影響させない）', async () => {
    await expect(
      checkDailyCostAlert(fakeEnv({ throwError: true }), 'run_x'),
    ).resolves.toBeUndefined()
    expect(slackCalls).toHaveLength(0)
  })
})
