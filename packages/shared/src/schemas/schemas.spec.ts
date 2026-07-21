import { describe, expect, it } from 'vitest'
import { ExtractedDateList, ExtractedScreening } from './extraction'
import { HHMM } from './plan'

// review指摘#6の回帰テスト: 時刻の分に 00-59 制約が無いと、LLM の幻覚や不正入力
// （例 "10:75"）が regex を素通りし、normalizeStart の setHours が silent に
// 別時刻（11:15）へ丸めてしまう。時・分双方の値域を境界で弾く。

describe('ExtractedScreening.startTime（時0〜29・分00〜59。docs/06 §3・§6）', () => {
  const valid = (startTime: string) =>
    ExtractedScreening.safeParse({ movieTitle: 'x', startTime }).success

  it('分が00-59の通常時刻・24時超え表記を許容する', () => {
    expect(valid('09:30')).toBe(true)
    expect(valid('9:30')).toBe(true) // 1桁時も許容（サイト表記ゆれ）
    expect(valid('25:10')).toBe(true) // 24時超え
    expect(valid('29:59')).toBe(true) // 境界値
    expect(valid('00:00')).toBe(true)
  })

  it('分が60以上は拒否する（"10:75" 等の不正時刻が normalizeStart で別時刻に丸まるのを防ぐ）', () => {
    expect(valid('10:75')).toBe(false)
    expect(valid('10:60')).toBe(false)
  })

  it('時が30以上は拒否する', () => {
    expect(valid('30:00')).toBe(false)
    expect(valid('99:00')).toBe(false)
  })
})

describe('ExtractedDateList（text 日分割の日付発見コール。docs/06 §4・ADR-0017）', () => {
  it('YYYY-MM-DD の配列を許容し、notes は省略・null とも可', () => {
    expect(ExtractedDateList.safeParse({ dates: ['2026-07-21', '2026-07-22'] }).success).toBe(true)
    expect(ExtractedDateList.safeParse({ dates: [], notes: null }).success).toBe(true)
    expect(ExtractedDateList.safeParse({ dates: [], notes: '休館中' }).success).toBe(true)
  })

  it('日付形式でない要素は拒否する（LLM の "7/21" 等の未補完出力を弾く）', () => {
    expect(ExtractedDateList.safeParse({ dates: ['7/21'] }).success).toBe(false)
    expect(ExtractedDateList.safeParse({ dates: ['2026-7-21'] }).success).toBe(false)
    expect(ExtractedDateList.safeParse({ dates: [null] }).success).toBe(false)
  })

  it('dates 欠落は拒否する', () => {
    expect(ExtractedDateList.safeParse({}).success).toBe(false)
  })
})

describe('PlanRequest の HHMM（時00〜23・分00〜59・24時超え不可。docs/04）', () => {
  const valid = (s: string) => HHMM.safeParse(s).success

  it('通常の時刻表記を許容する', () => {
    expect(valid('09:00')).toBe(true)
    expect(valid('23:59')).toBe(true)
    expect(valid('00:00')).toBe(true)
  })

  it('分が60以上は拒否する', () => {
    expect(valid('10:75')).toBe(false)
    expect(valid('10:60')).toBe(false)
  })

  it('24時超え表記は拒否する（利用可能時間帯は当日のみ）', () => {
    expect(valid('24:00')).toBe(false)
    expect(valid('25:10')).toBe(false)
  })

  it('1桁時は拒否する（API 入力は常に2桁固定。docs/04 example "09:00"）', () => {
    expect(valid('9:00')).toBe(false)
  })
})
