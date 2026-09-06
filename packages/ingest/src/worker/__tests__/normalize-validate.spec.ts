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
  // が invalid_string で落ちていた。docs/spec/06 §6.4「相対URLは scheduleUrl 基準で絶対化」が
  // 未実装だったことが原因。
  describe('detailUrl（相対URLの絶対化。docs/spec/06 §6.4）', () => {
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
  // ADR-0024: screenName を公開する劇場でのみ V5 は効く（非公開館は下の describe を参照）
  it('V5: 同一(date,title,startTime,screen)重複で DUPLICATE_ROW', () => {
    const dup = sc({ movieTitle: 'A', startTime: '10:00', screenName: 'シアター１' })
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

// V7（ADR-0020）。2026-07-26 にシネ・ヌーヴォで、月間グリッド画像（7/25〜8/28）の全日程が
// 単一日 2026-08-01 に潰れた抽出結果が V1〜V6 を素通りして書き込まれ、洗い替えで
// 7/26〜7/31 の6日分を失った。V7 は書込前に走るこの class の主防御。
describe('validateNormalized (V7 SCREEN_TIME_OVERLAP)', () => {
  const D = '2026-07-11'
  const X = 'シネ・ヌーヴォX'

  it('同一スクリーンで時間帯が重複したら NG（事故時の実データ形状）', () => {
    // 実際に書き込まれた行: 01:10〜02:35 と 01:20〜03:00 が同一スクリーンで重複していた
    const rows = normalize(
      result([
        sc({
          date: D,
          screenName: X,
          movieTitle: '少女シェット',
          startTime: '10:10',
          endTime: '11:35',
        }),
        sc({
          date: D,
          screenName: X,
          movieTitle: 'LOST LAND',
          startTime: '10:20',
          endTime: '12:00',
        }),
      ]),
      SCHEDULE_URL,
    )
    expect(validateNormalized(rows)?.code).toBe('SCREEN_TIME_OVERLAP')
  })

  it('同一スクリーンで別作品の開始時刻が完全一致したら NG（終了時刻が推定でも）', () => {
    const rows = normalize(
      result([
        sc({ date: D, screenName: X, movieTitle: '霧のごとく', startTime: '10:30' }),
        sc({ date: D, screenName: X, movieTitle: '野火', startTime: '10:30' }),
      ]),
      SCHEDULE_URL,
    )
    expect(validateNormalized(rows)?.code).toBe('SCREEN_TIME_OVERLAP')
  })

  it('別スクリーンなら同時刻でも通過（多スクリーン館の並行上映は正常）', () => {
    const rows = normalize(
      result([
        sc({
          date: D,
          screenName: 'シネマ1',
          movieTitle: 'A',
          startTime: '10:30',
          endTime: '12:30',
        }),
        sc({
          date: D,
          screenName: 'シネマ2',
          movieTitle: 'B',
          startTime: '10:30',
          endTime: '12:30',
        }),
      ]),
      SCHEDULE_URL,
    )
    expect(validateNormalized(rows)).toBeNull()
  })

  it('別日なら同一スクリーン・同時刻でも通過（日付ごとに独立して判定する）', () => {
    const rows = normalize(
      result([
        sc({
          date: '2026-07-11',
          screenName: X,
          movieTitle: 'A',
          startTime: '10:30',
          endTime: '12:30',
        }),
        sc({
          date: '2026-07-12',
          screenName: X,
          movieTitle: 'A',
          startTime: '10:30',
          endTime: '12:30',
        }),
      ]),
      SCHEDULE_URL,
    )
    expect(validateNormalized(rows)).toBeNull()
  })

  it('screenName 無しの劇場はスキップ（大阪ステーションシネマは355件すべて空。全件重複扱いになるのを防ぐ）', () => {
    const rows = normalize(
      result([
        sc({ date: D, movieTitle: 'A', startTime: '10:30', endTime: '12:30' }),
        sc({ date: D, movieTitle: 'B', startTime: '10:30', endTime: '12:30' }),
        sc({ date: D, movieTitle: 'C', startTime: '11:00', endTime: '13:00' }),
      ]),
      SCHEDULE_URL,
    )
    expect(validateNormalized(rows)).toBeNull()
  })

  it('終了時刻が推定のみの隣接上映は重複扱いしない（推定尺での誤検知を避ける）', () => {
    // endTime 無し → 推定120分。10:30 の推定終了 12:30 は 11:00 開始と重なるが NG にしない
    const rows = normalize(
      result([
        sc({ date: D, screenName: X, movieTitle: 'A', startTime: '10:30' }),
        sc({ date: D, screenName: X, movieTitle: 'B', startTime: '11:00' }),
      ]),
      SCHEDULE_URL,
    )
    expect(validateNormalized(rows)).toBeNull()
  })

  it('同一スクリーンの連続上映（前の終了 <= 次の開始）は通過', () => {
    const rows = normalize(
      result([
        sc({ date: D, screenName: X, movieTitle: 'A', startTime: '10:30', endTime: '12:20' }),
        sc({ date: D, screenName: X, movieTitle: 'B', startTime: '12:30', endTime: '14:15' }),
        sc({ date: D, screenName: X, movieTitle: 'C', startTime: '14:30', endTime: '16:10' }),
      ]),
      SCHEDULE_URL,
    )
    expect(validateNormalized(rows)).toBeNull()
  })

  it('入力順が時刻順でなくても検出する（startAt 昇順に並べ替えて隣接比較する）', () => {
    const rows = normalize(
      result([
        sc({ date: D, screenName: X, movieTitle: 'B', startTime: '10:20', endTime: '12:00' }),
        sc({ date: D, screenName: X, movieTitle: 'A', startTime: '10:10', endTime: '11:35' }),
      ]),
      SCHEDULE_URL,
    )
    expect(validateNormalized(rows)?.code).toBe('SCREEN_TIME_OVERLAP')
  })
})

describe('parseExtraction (zod)', () => {
  it('封筒（businessDate）のスキーマ不正は throw し、実値を添える', () => {
    expect(() => parseExtraction({ businessDate: 'bad', screenings: [], notes: null })).toThrow(
      /businessDate="bad"/,
    )
  })
  it('screenings が配列でなければ封筒 NG として throw', () => {
    expect(() => parseExtraction({ businessDate: '2026-07-10', screenings: null })).toThrow()
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

// ADR-0023 の回帰テスト: 大阪ステーションシネマの週間表は上映時刻が未確定のセルに
// "未定" と書く。LLM がこれを startTime に載せると TIME_RE を外れるが、その1行のために
// run 全体（＝同じ呼出で正しく取れた他の行・他の日）を捨ててはならない。
describe('parseExtraction — 行単位のスキーマ NG（ADR-0023）', () => {
  it('startTime="未定" の行だけを捨てて、正しい行は残す', () => {
    const r = parseExtraction({
      businessDate: '2026-09-07',
      screenings: [
        { movieTitle: '水曜どうでしょう祭UNITE2026', startTime: '未定' },
        { movieTitle: '冴えないボクと映えるキミ', startTime: '9:10' },
      ],
    })
    expect(r.screenings).toHaveLength(1)
    expect(r.screenings[0]?.movieTitle).toBe('冴えないボクと映えるキミ')
  })

  it('捨てた行の件数・パス・実値を notes に残す（error_message から原因が読めるように）', () => {
    const r = parseExtraction({
      businessDate: '2026-09-07',
      screenings: [{ movieTitle: 'A', startTime: '未定' }],
    })
    expect(r.notes).toBe(
      'スキーマ不正の1件を除外: screenings[0].startTime="未定"(invalid_string:regex)',
    )
  })

  it('既存の notes は保持して追記する', () => {
    const r = parseExtraction({
      businessDate: '2026-09-07',
      screenings: [{ movieTitle: 'A', startTime: '未定' }],
      notes: '休館日と記載',
    })
    expect(r.notes).toMatch(/^休館日と記載 \/ スキーマ不正の1件を除外/)
  })

  it('捨てる行が無ければ notes を変えない（undefined のまま）', () => {
    const r = parseExtraction({
      businessDate: '2026-09-07',
      screenings: [{ movieTitle: 'A', startTime: '9:10' }],
    })
    expect(r.notes).toBeUndefined()
  })

  it('全行が NG なら 0件 + notes になる（V1 は通り V2 COUNT_ANOMALY が拾う）', () => {
    const r = parseExtraction({
      businessDate: '2026-09-11',
      screenings: [
        { movieTitle: 'A', startTime: '未定' },
        { movieTitle: 'B', startTime: '未定' },
      ],
    })
    expect(r.screenings).toEqual([])
    expect(validateExtracted(r, {})).toBeNull() // V1: notes があるので通過
    expect(validateExtracted(r, { avgCount: 70 })?.code).toBe('COUNT_ANOMALY') // V2 が拾う
  })

  it('報告は先頭5件までに抑える（生出力の垂れ流しを防ぐ。log.ts のガードレール）', () => {
    const r = parseExtraction({
      businessDate: '2026-09-11',
      screenings: Array.from({ length: 8 }, (_, i) => ({ movieTitle: `M${i}`, startTime: '未定' })),
    })
    expect(r.notes).toMatch(/^スキーマ不正の8件を除外:/)
    expect(r.notes).toMatch(/ほか3件$/)
  })

  it('長すぎる実値は40字で切る', () => {
    const long = `${'あ'.repeat(60)}:00`
    const r = parseExtraction({
      businessDate: '2026-09-11',
      screenings: [{ movieTitle: 'A', startTime: long }],
    })
    expect(r.notes).toMatch(/…\(invalid_string:regex\)$/)
    expect(r.notes?.length ?? 0).toBeLessThan(120)
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

// ADR-0024 の回帰テスト: 大阪ステーションシネマはスクリーン名を公開しないため、
// ライブ・ビューイングの2スクリーン並行上映が同一行に見える。これを V5 で弾くと
// 取込も承認もできなくなる（承認は UNIQUE 違反で落ちる）。V7 と同じ carve-out を入れる。
describe('validateExtracted V5 — screenName 非公開館のスキップ（ADR-0024）', () => {
  const dup = (screenName: string | null) => [
    sc({
      movieTitle: '水曜どうでしょう祭UNITE2026 ライブ・ビューイング',
      startTime: '17:30',
      screenName,
    }),
    sc({
      movieTitle: '水曜どうでしょう祭UNITE2026 ライブ・ビューイング',
      startTime: '17:30',
      screenName,
    }),
  ]

  it('screenName が null（未公開）の同一行は DUPLICATE_ROW にしない', () => {
    expect(validateExtracted(result(dup(null)), {})).toBeNull()
  })

  it('screenName が空文字の同一行も DUPLICATE_ROW にしない', () => {
    expect(validateExtracted(result(dup('')), {})).toBeNull()
  })

  it('screenName を公開している劇場では従来どおり DUPLICATE_ROW（本物の異常）', () => {
    expect(validateExtracted(result(dup('シアター１')), {})?.code).toBe('DUPLICATE_ROW')
  })

  it('スクリーン名が異なれば重複ではない（多スクリーン館の並行上映）', () => {
    const rows = [
      sc({ movieTitle: 'A', startTime: '17:30', screenName: 'シアター１' }),
      sc({ movieTitle: 'A', startTime: '17:30', screenName: 'シアター２' }),
    ]
    expect(validateExtracted(result(rows), {})).toBeNull()
  })
})
