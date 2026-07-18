import type { ExtractedScreening, ExtractionResult } from '@cinema/shared'
import { describe, expect, it } from 'vitest'
import { inBusinessWindow, normalize } from '../normalize'
import { parseExtraction, validateExtracted, validateNormalized } from '../validate'

function sc(
  p: Partial<ExtractedScreening> & { movieTitle: string; startTime: string },
): ExtractedScreening {
  return {
    date: null,
    endTime: null,
    format: null,
    screenName: null,
    detailPath: null,
    ...p,
  }
}
function result(screenings: ExtractedScreening[], notes: string | null = null): ExtractionResult {
  return { businessDate: '2026-07-10', screenings, notes }
}
const SCHEDULE_URL = 'https://example.com/schedule/'

describe('normalize', () => {
  it('通常時刻を UTC 化し、endTime 無しは推定(+130分)', () => {
    const [row] = normalize(
      result([sc({ date: '2026-07-11', movieTitle: 'X', startTime: '10:30' })]),
      SCHEDULE_URL,
    )
    expect(row.startAt).toBe('2026-07-11T01:30:00.000Z') // 10:30 JST
    expect(row.endAtSource).toBe('estimated')
    expect(row.endAt).toBe('2026-07-11T03:40:00.000Z') // +130分
    expect(row.businessDate).toBe('2026-07-11')
  })
  it('24時超え表記を翌日に正規化', () => {
    const [row] = normalize(
      result([sc({ date: '2026-07-11', movieTitle: 'Late', startTime: '25:10' })]),
      SCHEDULE_URL,
    )
    expect(row.startAt).toBe('2026-07-11T16:10:00.000Z') // 翌 01:10 JST
  })
  it('date 省略時は ExtractionResult.businessDate を使う', () => {
    const [row] = normalize(result([sc({ movieTitle: 'Y', startTime: '12:00' })]), SCHEDULE_URL)
    expect(row.businessDate).toBe('2026-07-10')
  })
  it('endTime 記載はそのまま site', () => {
    const [row] = normalize(
      result([sc({ date: '2026-07-11', movieTitle: 'Z', startTime: '10:30', endTime: '12:30' })]),
      SCHEDULE_URL,
    )
    expect(row.endAtSource).toBe('site')
    expect(row.endAt).toBe('2026-07-11T03:30:00.000Z')
  })
  it('screenName を引き継ぐ（null は ""）', () => {
    const [a] = normalize(
      result([sc({ movieTitle: 'A', startTime: '10:00', screenName: 'シネ・ヌーヴォX' })]),
      SCHEDULE_URL,
    )
    expect(a.screenName).toBe('シネ・ヌーヴォX')
    const [b] = normalize(result([sc({ movieTitle: 'B', startTime: '10:00' })]), SCHEDULE_URL)
    expect(b.screenName).toBe('')
  })

  // review指摘: テアトル梅田で /ttcg_umeda/movie/xxx.html のような相対 detailPath が
  // そのまま D1 に保存され、Plan の ScreeningLeg.officialUrl（z.string().url() 必須）
  // が invalid_string で落ちていた。docs/06 §6.4「相対URLは scheduleUrl 基準で絶対化」が
  // 未実装だったことが原因。
  describe('detailUrl（相対URLの絶対化。docs/06 §6.4）', () => {
    it('相対パスは scheduleUrl 基準で絶対化する', () => {
      const [row] = normalize(
        result([
          sc({ movieTitle: 'A', startTime: '10:00', detailPath: '/ttcg_umeda/movie/123.html' }),
        ]),
        'https://ttcg.jp/ttcg_umeda/',
      )
      expect(row.detailUrl).toBe('https://ttcg.jp/ttcg_umeda/movie/123.html')
    })
    it('絶対URL（外部ドメイン・チケットベンダー等）はそのまま保持する', () => {
      const [row] = normalize(
        result([
          sc({
            movieTitle: 'A',
            startTime: '10:00',
            detailPath: 'https://reserve.example.net/reserve?schedule=1',
          }),
        ]),
        'https://theater.example.com/schedule/',
      )
      expect(row.detailUrl).toBe('https://reserve.example.net/reserve?schedule=1')
    })
    it('detailPath が null/undefined なら detailUrl も null（呼び出し側で officialUrl にフォールバック）', () => {
      const [row] = normalize(
        result([sc({ movieTitle: 'A', startTime: '10:00', detailPath: null })]),
        SCHEDULE_URL,
      )
      expect(row.detailUrl).toBeNull()
    })
    it('http(s) 以外のスキーム（javascript: 等、href 誤抽出の混入を想定）は null にする', () => {
      const [row] = normalize(
        result([sc({ movieTitle: 'A', startTime: '10:00', detailPath: 'javascript:void(0)' })]),
        SCHEDULE_URL,
      )
      expect(row.detailUrl).toBeNull()
    })
    it('絶対化してもパース不能な文字列は null にする（クラッシュしない）', () => {
      // 'http://'（スキームのみでホスト無し）は new URL() が Invalid URL を throw する実例
      const [row] = normalize(
        result([sc({ movieTitle: 'A', startTime: '10:00', detailPath: 'http://' })]),
        SCHEDULE_URL,
      )
      expect(row.detailUrl).toBeNull()
    })
  })
})

describe('inBusinessWindow (V3)', () => {
  it('昼公演は範囲内', () => {
    expect(inBusinessWindow('2026-07-11', '2026-07-11T01:30:00.000Z')).toBe(true) // 10:30 JST
  })
  it('深夜25:10(翌01:10)も範囲内', () => {
    expect(inBusinessWindow('2026-07-11', '2026-07-11T16:10:00.000Z')).toBe(true)
  })
  it('05:00 JST(前日20:00Z)は範囲外', () => {
    expect(inBusinessWindow('2026-07-11', '2026-07-10T20:00:00.000Z')).toBe(false)
  })
})

describe('validateExtracted (V1/V2/V5/V6)', () => {
  it('V1: 0件+notes無し は EMPTY_WITHOUT_REASON', () => {
    expect(validateExtracted(result([]), {})?.code).toBe('EMPTY_WITHOUT_REASON')
  })
  it('V1: 0件でも notes があれば通過', () => {
    expect(validateExtracted(result([], '休館日'), {})).toBeNull()
  })
  it('V2: 平均比 50%未満で COUNT_ANOMALY', () => {
    const rows = [
      sc({ movieTitle: 'A', startTime: '10:00' }),
      sc({ movieTitle: 'B', startTime: '12:00' }),
    ]
    expect(validateExtracted(result(rows), { avgCount: 10 })?.code).toBe('COUNT_ANOMALY')
  })
  it('V5: 同一(date,title,startTime)重複で DUPLICATE_ROW', () => {
    const dup = sc({ movieTitle: 'A', startTime: '10:00' })
    expect(validateExtracted(result([dup, { ...dup }]), {})?.code).toBe('DUPLICATE_ROW')
  })
  it('V5: 同時刻同作品でもスクリーンが違えば重複でない（多スクリーン・migration 0003）', () => {
    const s1 = sc({ movieTitle: 'A', startTime: '10:00', screenName: 'シネ・ヌーヴォ' })
    const s2 = sc({ movieTitle: 'A', startTime: '10:00', screenName: 'シネ・ヌーヴォX' })
    expect(validateExtracted(result([s1, s2]), {})).toBeNull()
  })
  it('V6: タイトルに HTML/URL 混入で DIRTY_TITLE', () => {
    expect(
      validateExtracted(result([sc({ movieTitle: '<b>x</b>', startTime: '10:00' })]), {})?.code,
    ).toBe('DIRTY_TITLE')
    expect(
      validateExtracted(result([sc({ movieTitle: 'http://x', startTime: '10:00' })]), {})?.code,
    ).toBe('DIRTY_TITLE')
  })
  it('正常データは通過', () => {
    const rows = [
      sc({ movieTitle: 'A', startTime: '10:00' }),
      sc({ movieTitle: 'B', startTime: '13:00' }),
    ]
    expect(validateExtracted(result(rows), {})).toBeNull()
  })
})

describe('validateNormalized (V3/V4)', () => {
  it('V4: endTime指定で end<=start は NEGATIVE_DURATION', () => {
    const rows = normalize(
      result([sc({ date: '2026-07-11', movieTitle: 'Bad', startTime: '12:00', endTime: '11:00' })]),
      SCHEDULE_URL,
    )
    expect(validateNormalized(rows)?.code).toBe('NEGATIVE_DURATION')
  })
  it('V3: 範囲外時刻は TIME_OUT_OF_RANGE', () => {
    const rows = normalize(
      result([sc({ date: '2026-07-11', movieTitle: 'Early', startTime: '05:00' })]),
      SCHEDULE_URL,
    )
    expect(validateNormalized(rows)?.code).toBe('TIME_OUT_OF_RANGE')
  })
  it('正常は通過', () => {
    const rows = normalize(
      result([sc({ date: '2026-07-11', movieTitle: 'OK', startTime: '10:30', endTime: '12:30' })]),
      SCHEDULE_URL,
    )
    expect(validateNormalized(rows)).toBeNull()
  })
})

describe('parseExtraction (zod)', () => {
  it('スキーマ不正は throw', () => {
    expect(() => parseExtraction({ businessDate: 'bad', screenings: [], notes: null })).toThrow()
  })
  it('正しい形は通る', () => {
    const r = parseExtraction(result([sc({ movieTitle: 'A', startTime: '10:00' })]))
    expect(r.screenings).toHaveLength(1)
  })
  it('notes が省略(undefined)されても throw しない（Gemini は required に notes を含めない。review指摘#5の回帰テスト）', () => {
    const raw = { businessDate: '2026-07-10', screenings: [] } // notes キー自体が無い
    const r = parseExtraction(raw)
    expect(r.notes).toBeUndefined()
  })
})

describe('validateExtracted — notes が undefined のケース（review指摘#5の回帰テスト）', () => {
  it('V1: notes 省略(undefined)+0件は EMPTY_WITHOUT_REASON を返す（旧実装は TypeError で落ちていた）', () => {
    const raw = { businessDate: '2026-07-10', screenings: [] }
    const parsed = parseExtraction(raw)
    expect(() => validateExtracted(parsed, {})).not.toThrow()
    expect(validateExtracted(parsed, {})?.code).toBe('EMPTY_WITHOUT_REASON')
  })
  it('V1: notes 省略(undefined)でも中身があれば通過', () => {
    const raw = {
      businessDate: '2026-07-10',
      screenings: [sc({ movieTitle: 'A', startTime: '10:00' })],
    }
    const parsed = parseExtraction(raw)
    expect(validateExtracted(parsed, {})).toBeNull()
  })
})
