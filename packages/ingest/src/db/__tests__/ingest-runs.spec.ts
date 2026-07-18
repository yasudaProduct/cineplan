import { describe, expect, it } from 'vitest'
import { reapStaleRuns } from '../ingest-runs'

// 孤児run の掃除（fix/p4-manual-ingest-orphan・docs/06 §7）。ブラウザ接続断などで
// Workers の実行がキャンセルされ queued/fetching/extracting のまま更新が止まった run を
// extraction_failed に確定する。

interface Row {
  id: string
  status: string
  started_at: string
  error_message: string | null
  finished_at: string | null
}

// D1Database の最小フェイク。実際の UPDATE 文の WHERE 条件（status IN (...) AND started_at < ?）
// を bind 引数から再現し、インメモリ行に適用する。
function createFakeDb(seed: Row[]) {
  const rows = seed.map((r) => ({ ...r }))
  const db = {
    prepare(_sql: string) {
      return {
        bind(...args: unknown[]) {
          return {
            async run() {
              const [errorMessage, finishedAt, cutoff] = args as [string, string, string]
              const target = new Set(['queued', 'fetching', 'extracting'])
              let changes = 0
              for (const r of rows) {
                if (target.has(r.status) && r.started_at < cutoff) {
                  r.status = 'extraction_failed'
                  r.error_message = errorMessage
                  r.finished_at = finishedAt
                  changes++
                }
              }
              return { meta: { changes } }
            },
          }
        },
      }
    },
  }
  return { db: db as unknown as D1Database, rows }
}

const NOW = new Date('2026-07-15T12:00:00.000Z')

describe('reapStaleRuns', () => {
  it('15分より前に開始し extracting のままの run を extraction_failed に確定する', async () => {
    const { db, rows } = createFakeDb([
      {
        id: 'run_old',
        status: 'extracting',
        started_at: '2026-07-15T11:00:00.000Z',
        error_message: null,
        finished_at: null,
      },
    ])
    const n = await reapStaleRuns(db, NOW)
    expect(n).toBe(1)
    expect(rows[0]?.status).toBe('extraction_failed')
    expect(rows[0]?.error_message).toContain('タイムアウト')
    expect(rows[0]?.finished_at).toBe(NOW.toISOString())
  })

  it('15分以内に開始した run（処理中の可能性がある）は触らない', async () => {
    const { db, rows } = createFakeDb([
      {
        id: 'run_fresh',
        status: 'extracting',
        started_at: '2026-07-15T11:50:00.000Z',
        error_message: null,
        finished_at: null,
      },
    ])
    const n = await reapStaleRuns(db, NOW)
    expect(n).toBe(0)
    expect(rows[0]?.status).toBe('extracting')
  })

  it('succeeded / 既に失敗確定済みの run は対象外（十分古くても触らない）', async () => {
    const { db, rows } = createFakeDb([
      {
        id: 'run_ok',
        status: 'succeeded',
        started_at: '2026-07-15T00:00:00.000Z',
        error_message: null,
        finished_at: '2026-07-15T00:01:00.000Z',
      },
      {
        id: 'run_failed',
        status: 'fetch_failed',
        started_at: '2026-07-15T00:00:00.000Z',
        error_message: 'x',
        finished_at: '2026-07-15T00:01:00.000Z',
      },
    ])
    const n = await reapStaleRuns(db, NOW)
    expect(n).toBe(0)
    expect(rows[0]?.status).toBe('succeeded')
    expect(rows[1]?.status).toBe('fetch_failed')
  })

  it('queued/fetching/extracting のいずれも対象 status になる', async () => {
    const { db, rows } = createFakeDb([
      {
        id: 'q',
        status: 'queued',
        started_at: '2026-07-15T00:00:00.000Z',
        error_message: null,
        finished_at: null,
      },
      {
        id: 'f',
        status: 'fetching',
        started_at: '2026-07-15T00:00:00.000Z',
        error_message: null,
        finished_at: null,
      },
      {
        id: 'e',
        status: 'extracting',
        started_at: '2026-07-15T00:00:00.000Z',
        error_message: null,
        finished_at: null,
      },
    ])
    const n = await reapStaleRuns(db, NOW)
    expect(n).toBe(3)
    expect(rows.every((r) => r.status === 'extraction_failed')).toBe(true)
  })

  it('戻り値は更新件数と一致する（stale/fresh/対象外が混在）', async () => {
    const { db } = createFakeDb([
      {
        id: 'stale',
        status: 'extracting',
        started_at: '2026-07-15T00:00:00.000Z',
        error_message: null,
        finished_at: null,
      },
      {
        id: 'fresh',
        status: 'extracting',
        started_at: '2026-07-15T11:59:00.000Z',
        error_message: null,
        finished_at: null,
      },
      {
        id: 'done',
        status: 'succeeded',
        started_at: '2026-07-15T00:00:00.000Z',
        error_message: null,
        finished_at: '2026-07-15T00:01:00.000Z',
      },
    ])
    expect(await reapStaleRuns(db, NOW)).toBe(1)
  })
})
