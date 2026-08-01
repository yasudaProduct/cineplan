import { describe, expect, it } from 'vitest'
import type { Score } from '../schemas/plan'
import { compareScore, isBetter } from './compare'
import { newId } from './id'
import { normalizeStart, titleKey, toBusinessDate } from './time'

describe('newId', () => {
  it('プレフィックス付きの base58 短ID を返す', () => {
    expect(newId('scr')).toMatch(/^scr_[123456789A-HJ-NP-Za-km-z]{12}$/)
  })
  it('呼ぶたびに異なる', () => {
    expect(newId('mov')).not.toBe(newId('mov'))
  })
})

describe('normalizeStart / toBusinessDate', () => {
  it('通常時刻を UTC ISO に正規化（10:30 JST = 01:30Z）', () => {
    expect(normalizeStart('2026-07-12', '10:30')).toBe('2026-07-12T01:30:00.000Z')
  })
  it('24時超え表記を翌日として正規化（25:10 → 翌 01:10 JST = 16:10Z 前日）', () => {
    expect(normalizeStart('2026-07-12', '25:10')).toBe('2026-07-12T16:10:00.000Z')
  })
  it('深夜(05:00 JST 未満)は前日を興行日とする', () => {
    // 2026-07-12T16:10Z = 07-13 01:10 JST → businessDate 07-12
    expect(toBusinessDate('2026-07-12T16:10:00.000Z')).toBe('2026-07-12')
  })
  it('昼は当日を興行日とする', () => {
    expect(toBusinessDate('2026-07-12T01:30:00.000Z')).toBe('2026-07-12')
  })
})

describe('titleKey', () => {
  it('全半角の括弧違いを同一キーに名寄せする', () => {
    expect(titleKey('君の名は。 (IMAX)')).toBe(titleKey('君の名は。（IMAX）'))
  })
  it('空白除去と小文字化', () => {
    expect(titleKey('The MATRIX')).toBe('thematrix')
  })
})

describe('compareScore', () => {
  const base: Score = { count: 3, travel: 30, wait: 45, endMin: 1080, lastId: 's5' }

  it('本数が多い方が良い', () => {
    expect(isBetter(base, { ...base, count: 2 })).toBe(true)
  })
  it('同本数なら移動が少ない方が良い', () => {
    expect(isBetter(base, { ...base, travel: 50 })).toBe(true)
  })
  it('本数・移動が同値なら待ちが少ない方が良い（docs/spec/05 §8 のタイブレーク）', () => {
    const a: Score = { count: 3, travel: 30, wait: 45, endMin: 1080, lastId: 's5' }
    const b: Score = { count: 3, travel: 30, wait: 65, endMin: 1080, lastId: 's5' }
    expect(isBetter(a, b)).toBe(true)
  })
  it('全項目同値なら 0（決定性の担保）', () => {
    expect(compareScore(base, { ...base })).toBe(0)
  })
})
