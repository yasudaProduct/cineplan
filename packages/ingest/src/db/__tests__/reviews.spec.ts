import { beforeEach, describe, expect, it, vi } from 'vitest'

// レビュー承認/破棄（P4-5。docs/11 §6）。承認は通常書込パス（normalizeResolveWrite）を
// payload.businessDate を coverageFloor として呼び、review→approved / run→succeeded を
// 1バッチで更新する。破棄はメモ必須（必須検証は route 側・ここでは更新の有無を返す）。

const writeMock = vi.fn(async () => 5)
vi.mock('../../worker/write', () => ({ normalizeResolveWrite: writeMock }))

const { approveReview, rejectReview, ReviewNotPendingError } = await import('../reviews')

interface Captured {
  sql: string
  binds: unknown[]
}

function createFakeDb(reviewRow: Record<string, unknown> | null, changes = 1) {
  const captured: Captured[] = []
  const batched: Captured[][] = []
  const db = {
    prepare(sql: string) {
      return {
        bind(...binds: unknown[]) {
          const stmt = { sql, binds }
          return {
            ...stmt,
            async first() {
              captured.push(stmt)
              return reviewRow
            },
            async run() {
              captured.push(stmt)
              return { meta: { changes } }
            },
          }
        },
      }
    },
    async batch(stmts: Captured[]) {
      batched.push(stmts)
      return []
    },
  }
  return { db: db as unknown as D1Database, captured, batched }
}

const PAYLOAD = {
  businessDate: '2026-08-15',
  screenings: [{ movieTitle: 'テスト作品', startTime: '10:00' }],
  notes: null,
}

beforeEach(() => writeMock.mockClear())

describe('approveReview', () => {
  it('pending の review を通常書込パスで反映し、review/run を更新する', async () => {
    const { db, batched } = createFakeDb({
      ingest_run_id: 'run_1',
      payload_json: JSON.stringify(PAYLOAD),
      theater_id: 'thr_a',
    })
    const r = await approveReview(db, 'rev_1', 'メモ')
    expect(r).toEqual({ written: 5, runId: 'run_1' })
    // coverageFloor は payload.businessDate（today ではない）
    expect(writeMock).toHaveBeenCalledWith(
      db,
      'thr_a',
      'run_1',
      expect.objectContaining({ businessDate: '2026-08-15' }),
      '2026-08-15',
    )
    // review→approved / run→succeeded が 1 バッチ
    expect(batched).toHaveLength(1)
    expect(batched[0][0].sql).toContain(`status='approved'`)
    expect(batched[0][0].binds).toContain('メモ')
    expect(batched[0][1].sql).toContain(`status='succeeded'`)
    expect(batched[0][1].binds).toContain(5)
  })

  it('pending でない/存在しない review は ReviewNotPendingError', async () => {
    const { db } = createFakeDb(null)
    await expect(approveReview(db, 'rev_x')).rejects.toBeInstanceOf(ReviewNotPendingError)
    expect(writeMock).not.toHaveBeenCalled()
  })

  it('payload が ExtractionResult として不正なら書込前に throw（D1 は無変更）', async () => {
    const { db, batched } = createFakeDb({
      ingest_run_id: 'run_1',
      payload_json: JSON.stringify({ businessDate: 'bad-date', screenings: [] }),
      theater_id: 'thr_a',
    })
    await expect(approveReview(db, 'rev_1')).rejects.toThrow()
    expect(writeMock).not.toHaveBeenCalled()
    expect(batched).toHaveLength(0)
  })
})

describe('rejectReview', () => {
  it('pending 行をメモ付きで rejected に更新し true を返す', async () => {
    const { db, captured } = createFakeDb(null, 1)
    expect(await rejectReview(db, 'rev_1', '別月の混入')).toBe(true)
    const upd = captured.find((s) => s.sql.includes(`status='rejected'`))
    expect(upd?.binds).toContain('別月の混入')
  })
  it('更新 0 件（pending でない）なら false', async () => {
    const { db } = createFakeDb(null, 0)
    expect(await rejectReview(db, 'rev_1', 'x')).toBe(false)
  })
})
