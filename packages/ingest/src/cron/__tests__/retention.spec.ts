import { describe, expect, it } from 'vitest'
import { runRetention } from '../retention'

// データ保持削除（P5-5・docs/spec/09 §7）。
// SQL の要点（datetime() ラップ・FK ガード・pending 除外・batch=1トランザクション）を固定する。
// 実データでの境界（30/90/180日・期限切れ）はローカル D1 E2E で確認する。

function createFakeDb() {
  const prepared: string[] = []
  let batched: string[] = []
  const db = {
    prepare(sql: string) {
      prepared.push(sql)
      return { sql }
    },
    async batch(stmts: { sql: string }[]) {
      batched = stmts.map((s) => s.sql)
      // meta.changes は削除件数（テーブルごとに異なる値を返し集計順の取り違えを検出する）
      return stmts.map((_, i) => ({ meta: { changes: i + 1 } }))
    },
  } as unknown as D1Database
  return { db, prepared, batchedRef: () => batched }
}

describe('runRetention', () => {
  it('4テーブルを1つの batch（=1トランザクション）で削除し、件数を返す', async () => {
    const { db, batchedRef } = createFakeDb()
    const r = await runRetention(db)
    expect(batchedRef()).toHaveLength(4)
    // batch の順序どおりに件数がマッピングされる（1:screenings 2:reviews 3:runs 4:sharedPlans）
    expect(r).toEqual({ screenings: 1, reviews: 2, ingestRuns: 3, sharedPlans: 4 })
  })

  it('削除順は参照元→参照先（screenings, reviews → runs）で shared_plans は独立', async () => {
    const { db, batchedRef } = createFakeDb()
    await runRetention(db)
    const [a, b, c, d] = batchedRef()
    expect(a).toContain('FROM screenings')
    expect(b).toContain('FROM extraction_reviews')
    expect(c).toContain('FROM ingest_runs')
    expect(d).toContain('FROM shared_plans')
  })

  it('ISO/スペース形式の比較非互換を避けるため、日時列は datetime() でラップする（docs/spec/09 §7）', async () => {
    const { db, batchedRef } = createFakeDb()
    await runRetention(db)
    const [scr, rev, runs, plans] = batchedRef()
    // business_date は YYYY-MM-DD 同士なのでラップ不要
    expect(scr).toContain(`business_date < date('now','-30 days')`)
    expect(rev).toContain(`datetime(created_at) < datetime('now','-90 days')`)
    expect(runs).toContain(`datetime(started_at) < datetime('now','-180 days')`)
    expect(plans).toContain(`datetime(expires_at) < datetime('now')`)
  })

  it('ingest_runs は extraction_reviews から参照されている行を消さない（FK ガード。pending 長期残存時に batch 全体が rollback するのを防ぐ）', async () => {
    const { db, batchedRef } = createFakeDb()
    await runRetention(db)
    expect(batchedRef()[2]).toContain('id NOT IN (SELECT ingest_run_id FROM extraction_reviews)')
  })

  it('extraction_reviews は pending を消さない（解決済みのみ90日）', async () => {
    const { db, batchedRef } = createFakeDb()
    await runRetention(db)
    expect(batchedRef()[1]).toContain(`status <> 'pending'`)
  })
})
