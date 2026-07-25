import { describe, expect, it } from 'vitest'
import { snapshotDateOf, snapshotDayDateOf } from '../reextract'

// 再抽出（P4-4）の coverageFloor/businessMonth はスナップショットの取得日を使う。
// today を使うと月跨ぎの古いスナップショット再抽出で「抽出がカバーしない日」まで
// 洗い替え範囲に入り、新しいデータを消しうる（write.ts のコメント参照）。

describe('snapshotDateOf', () => {
  it('snapshot_key（raw/{thr}/{date}/{fetchedAt}）から取得日を取り出す', () => {
    expect(snapshotDateOf('raw/thr_cnv01/2026-07-12/2026-07-12T04:34:07.786Z')).toBe('2026-07-12')
  })
  it('プレフィックスが raw/ でない・日付が無い形式は null', () => {
    expect(snapshotDateOf('foo/thr_cnv01/2026-07-12/x')).toBeNull()
    expect(snapshotDateOf('raw/thr_cnv01/not-a-date/x')).toBeNull()
    expect(snapshotDateOf('')).toBeNull()
  })
})

// 複数日取得（ADR-0019）の日別スナップショット判定。既存 run（単一 .html）は必ず null に
// なり従来経路へフォールバックする / vision の画像キーを誤って拾わない。
describe('snapshotDayDateOf', () => {
  it('_d{date}.html から日付を取り出す', () => {
    expect(
      snapshotDayDateOf('raw/thr_x/2026-07-25/2026-07-25T00:00:00.000Z_d2026-07-27.html'),
    ).toBe('2026-07-27')
  })

  it('既定文書・画像・非日付キーは null（既存 run は従来経路へ）', () => {
    expect(snapshotDayDateOf('raw/thr_x/2026-07-25/2026-07-25T00:00:00.000Z.html')).toBeNull()
    expect(snapshotDayDateOf('raw/thr_x/2026-07-25/2026-07-25T00:00:00.000Z_0.gif')).toBeNull()
    expect(snapshotDayDateOf('raw/thr_x/2026-07-25/x_dnot-a-date.html')).toBeNull()
    expect(snapshotDayDateOf('')).toBeNull()
  })
})
