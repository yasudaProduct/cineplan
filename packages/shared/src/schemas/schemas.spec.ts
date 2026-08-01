import { describe, expect, it } from 'vitest'
import { ExtractedDateList, ExtractedScreening } from './extraction'
import { TheaterUpsert } from './ingest'
import { HHMM } from './plan'

// review指摘#6の回帰テスト: 時刻の分に 00-59 制約が無いと、LLM の幻覚や不正入力
// （例 "10:75"）が regex を素通りし、normalizeStart の setHours が silent に
// 別時刻（11:15）へ丸めてしまう。時・分双方の値域を境界で弾く。

describe('ExtractedScreening.startTime（時0〜29・分00〜59。docs/spec/06 §3・§6）', () => {
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

describe('ExtractedDateList（text 日分割の日付発見コール。docs/spec/06 §4・ADR-0017）', () => {
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

describe('PlanRequest の HHMM（時00〜23・分00〜59・24時超え不可。docs/spec/04）', () => {
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

  it('1桁時は拒否する（API 入力は常に2桁固定。docs/spec/04 example "09:00"）', () => {
    expect(valid('9:00')).toBe(false)
  })
})

// 複数日取得（ADR-0019）の組合せ検証。手書き設定でも矛盾した状態を作らせない。
describe('TheaterUpsert の複数日取得の組合せ検証（ADR-0019）', () => {
  const base = {
    name: 'T',
    shortName: null,
    lat: '34.7',
    lng: '135.5',
    nearestStation: '梅田',
    walkMinFromSta: '5',
    scheduleUrl: 'http://example.com/s',
    fetchMethod: 'static' as const,
    extractMethod: 'text' as const,
    fetchDayMode: 'single' as const,
    fetchDays: '1',
    officialUrl: 'http://example.com/',
    termsNote: null,
    termsCheckedAt: null,
    robotsStatus: 'allowed' as const,
  }
  const parse = (over: Record<string, unknown>) => TheaterUpsert.safeParse({ ...base, ...over })

  it('既定（single / 1）は通る', () => {
    expect(parse({}).success).toBe(true)
  })

  it('tabs は fetchMethod=rendered が必須', () => {
    expect(parse({ fetchDayMode: 'tabs', fetchDays: '3' }).success).toBe(false)
    expect(parse({ fetchDayMode: 'tabs', fetchDays: '3', fetchMethod: 'rendered' }).success).toBe(
      true,
    )
  })

  it('tabs は fetchDays=0（タブ全件）を許容する', () => {
    expect(parse({ fetchDayMode: 'tabs', fetchDays: '0', fetchMethod: 'rendered' }).success).toBe(
      true,
    )
  })

  it('url_template は {date} と static が必須', () => {
    expect(parse({ fetchDayMode: 'url_template', fetchDays: '3' }).success).toBe(false) // {date} なし
    expect(
      parse({
        fetchDayMode: 'url_template',
        fetchDays: '3',
        scheduleUrl: 'http://example.com/s?d={date}',
      }).success,
    ).toBe(true)
    expect(
      parse({
        fetchDayMode: 'url_template',
        fetchDays: '3',
        fetchMethod: 'rendered',
        scheduleUrl: 'http://example.com/s?d={date}',
      }).success,
    ).toBe(false) // rendered は非対応
  })

  it('{date} を含む URL は url_template 以外では拒否する', () => {
    expect(parse({ scheduleUrl: 'http://example.com/s?d={date}' }).success).toBe(false)
  })

  it('url_template は fetchDays=0 を拒否する（タブ全件は tabs 専用）', () => {
    expect(
      parse({
        fetchDayMode: 'url_template',
        fetchDays: '0',
        scheduleUrl: 'http://example.com/s?d={date}',
      }).success,
    ).toBe(false)
  })

  it('複数日取得は extractMethod=text のみ', () => {
    expect(
      parse({
        fetchDayMode: 'tabs',
        fetchDays: '3',
        fetchMethod: 'rendered',
        extractMethod: 'vision',
      }).success,
    ).toBe(false)
  })

  it('single のとき fetchDays は 1 でなければならない', () => {
    expect(parse({ fetchDays: '3' }).success).toBe(false)
  })

  it('fetchDays は上限10（MAX_FETCH_DAYS）を超えられない', () => {
    expect(parse({ fetchDayMode: 'tabs', fetchDays: '11', fetchMethod: 'rendered' }).success).toBe(
      false,
    )
    expect(parse({ fetchDayMode: 'tabs', fetchDays: '10', fetchMethod: 'rendered' }).success).toBe(
      true,
    )
  })
})
