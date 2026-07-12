import { describe, expect, it } from 'vitest'
import { snapshotDateOf } from '../reextract'

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
