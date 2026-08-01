import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  extractTextDaySplit,
  extractTextPerDocument,
  extractTextWithRetries,
  extractVisionWithRetries,
  MAX_DATES,
} from '../extract'

// review指摘#2の回帰テスト: LLM APIエラーは最大2回・JSONパース不能/zod NGは
// 合算で最大1回、fetch 済み画像を使い回してリトライする（再取得はしない）。docs/spec/06 §7。

const okResponse = (json: unknown) => ({
  raw: JSON.stringify(json),
  model: 'stub:model',
  inTokens: 1,
  outTokens: 1,
})

const VALID = { businessDate: '2026-07-10', screenings: [], notes: '休館日' }

let extractMock: ReturnType<typeof vi.fn>

vi.mock('../../llm', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../llm')>()
  return {
    ...actual,
    createLlmClient: vi.fn(() => ({ modelId: 'stub:model', extract: extractMock })),
  }
})

beforeEach(() => {
  extractMock = vi.fn()
})

describe('extractVisionWithRetries', () => {
  it('1回目で成功すれば即座に返す（リトライ無し）', async () => {
    extractMock.mockResolvedValueOnce(okResponse(VALID))
    const { result } = await extractVisionWithRetries({}, [], '2026-07')
    expect(result.businessDate).toBe('2026-07-10')
    expect(extractMock).toHaveBeenCalledTimes(1)
  })

  it('LLM APIエラーは最大2回リトライして成功できる（計3回呼出）', async () => {
    extractMock
      .mockRejectedValueOnce(new Error('gemini 500'))
      .mockRejectedValueOnce(new Error('gemini 500'))
      .mockResolvedValueOnce(okResponse(VALID))
    const { result } = await extractVisionWithRetries({}, [], '2026-07')
    expect(result.businessDate).toBe('2026-07-10')
    expect(extractMock).toHaveBeenCalledTimes(3)
  })

  it('LLM APIエラーが3回連続だと予算超過で throw する（計3回呼出で打ち切り）', async () => {
    extractMock.mockRejectedValue(new Error('gemini 500'))
    await expect(extractVisionWithRetries({}, [], '2026-07')).rejects.toThrow('gemini 500')
    expect(extractMock).toHaveBeenCalledTimes(3) // 初回 + 2回リトライ
  })

  it('JSONパース不能は最大1回リトライして成功できる（計2回呼出）', async () => {
    extractMock
      .mockResolvedValueOnce({ raw: 'not json', model: 'stub:model', inTokens: 1, outTokens: 1 })
      .mockResolvedValueOnce(okResponse(VALID))
    const { result } = await extractVisionWithRetries({}, [], '2026-07')
    expect(result.businessDate).toBe('2026-07-10')
    expect(extractMock).toHaveBeenCalledTimes(2)
  })

  it('JSONパース不能が2回連続だと予算超過で throw する', async () => {
    extractMock.mockResolvedValue({
      raw: 'not json',
      model: 'stub:model',
      inTokens: 1,
      outTokens: 1,
    })
    await expect(extractVisionWithRetries({}, [], '2026-07')).rejects.toThrow(/パース不能/)
    expect(extractMock).toHaveBeenCalledTimes(2) // 初回 + 1回リトライ
  })

  it('zod NG は最大1回リトライして成功できる', async () => {
    extractMock
      .mockResolvedValueOnce(okResponse({ businessDate: 'invalid-date', screenings: [] }))
      .mockResolvedValueOnce(okResponse(VALID))
    const { result } = await extractVisionWithRetries({}, [], '2026-07')
    expect(result.businessDate).toBe('2026-07-10')
    expect(extractMock).toHaveBeenCalledTimes(2)
  })

  it('zod NG が2回連続だと予算超過で throw する', async () => {
    extractMock.mockResolvedValue(okResponse({ businessDate: 'invalid-date', screenings: [] }))
    await expect(extractVisionWithRetries({}, [], '2026-07')).rejects.toThrow()
    expect(extractMock).toHaveBeenCalledTimes(2)
  })

  it('JSONパース不能とzod NGは予算を共有する（パース不能1回消費後のzod NGはリトライされない）', async () => {
    extractMock
      .mockResolvedValueOnce({ raw: 'not json', model: 'stub:model', inTokens: 1, outTokens: 1 }) // 予算消費
      .mockResolvedValueOnce(okResponse({ businessDate: 'invalid-date', screenings: [] })) // 予算切れ
    await expect(extractVisionWithRetries({}, [], '2026-07')).rejects.toThrow()
    expect(extractMock).toHaveBeenCalledTimes(2)
  })
})

describe('extractTextWithRetries（P4-7。リトライ予算は vision と共有実装）', () => {
  it('成功時: text_v1 の prompt_version と <page> ラッパで LLM を呼ぶ', async () => {
    extractMock.mockResolvedValueOnce(okResponse(VALID))
    const { ext, result } = await extractTextWithRetries(
      {},
      '<table><tr><td>ニッポン狂想曲 10:00</td></tr></table>',
      '2026-07',
      'http://example.com/schedule',
    )
    expect(result.businessDate).toBe('2026-07-10')
    expect(ext.promptVersion).toBe('text_v1')
    const input = extractMock.mock.calls[0]?.[0] as { systemPrompt: string; userText?: string }
    expect(input.systemPrompt).toContain('2026-07')
    expect(input.userText).toContain('<page url="http://example.com/schedule"')
    expect(input.userText).toContain('ニッポン狂想曲')
  })

  it('LLM APIエラーのリトライ予算（最大2回）を vision と同様に消化する', async () => {
    extractMock
      .mockRejectedValueOnce(new Error('gemini 500'))
      .mockResolvedValueOnce(okResponse(VALID))
    const { result } = await extractTextWithRetries({}, 'x', '2026-07', 'http://e.com/')
    expect(result.businessDate).toBe('2026-07-10')
    expect(extractMock).toHaveBeenCalledTimes(2)
  })
})

// text 日単位分割（text_v3・ADR-0017）: 日付発見コール → 日別抽出コール → マージ
describe('extractTextDaySplit', () => {
  const dayResult = (date: string, titles: string[], notes: string | null = null) =>
    okResponse({
      businessDate: date,
      screenings: titles.map((movieTitle) => ({ movieTitle, startTime: '10:00' })),
      notes,
    })

  it('発見1回+日別N回を呼び、全日の screenings を date 付きでマージする（トークンは合算）', async () => {
    extractMock
      .mockResolvedValueOnce(okResponse({ dates: ['2026-07-22', '2026-07-21'] })) // 発見（順不同）
      .mockResolvedValueOnce(dayResult('2026-07-21', ['A', 'B'])) // 昇順ソート後の1日目
      .mockResolvedValueOnce(dayResult('2026-07-22', ['C']))
    const { ext, result } = await extractTextDaySplit(
      {},
      '<table>x</table>',
      '2026-07',
      'http://e.com/week',
      '2026-07-21',
    )
    expect(extractMock).toHaveBeenCalledTimes(3)
    expect(result.screenings.map((s) => [s.date, s.movieTitle])).toEqual([
      ['2026-07-21', 'A'],
      ['2026-07-21', 'B'],
      ['2026-07-22', 'C'],
    ])
    expect(result.businessDate).toBe('2026-07-21')
    expect(ext.promptVersion).toBe('text_v3')
    expect(ext.inTokens).toBe(3) // 1×3呼出の合算
    expect(ext.outTokens).toBe(3)
  })

  it('発見コールは responseFormat=dateList・日別は既定（extraction）で、<page> の後に <task> を置く', async () => {
    extractMock
      .mockResolvedValueOnce(okResponse({ dates: ['2026-07-21'] }))
      .mockResolvedValueOnce(dayResult('2026-07-21', ['A']))
    await extractTextDaySplit({}, '<t>x</t>', '2026-07', 'http://e.com/week', '2026-07-21')
    const discovery = extractMock.mock.calls[0]?.[0] as {
      userText: string
      responseFormat?: string
    }
    const day = extractMock.mock.calls[1]?.[0] as { userText: string; responseFormat?: string }
    expect(discovery.responseFormat).toBe('dateList')
    expect(day.responseFormat).toBeUndefined()
    for (const input of [discovery, day]) {
      expect(input.userText.indexOf('</page>')).toBeGreaterThan(-1)
      expect(input.userText.indexOf('<task>')).toBeGreaterThan(input.userText.indexOf('</page>'))
    }
    expect(day.userText).toContain('2026-07-21')
    // v3: 基準日（当日）を <page> 属性で両コールに渡す（日付見出しの無い当日ブロック対策・ADR-0017）
    expect(discovery.userText).toContain('businessDate="2026-07-21"')
    expect(day.userText).toContain('businessDate="2026-07-21"')
    // 全呼出でプレフィックス（<page>…</page>）が同一（キャッシュ親和レイアウト）
    const prefixOf = (t: string) => t.slice(0, t.indexOf('</page>'))
    expect(prefixOf(discovery.userText)).toBe(prefixOf(day.userText))
  })

  it('日別呼出の応答に対象日以外の行が混ざったら除外し notes に記録する（date null は対象日に補完）', async () => {
    extractMock.mockResolvedValueOnce(okResponse({ dates: ['2026-07-21'] })).mockResolvedValueOnce(
      okResponse({
        businessDate: '2026-07-21',
        screenings: [
          { movieTitle: 'A', startTime: '10:00', date: null },
          { movieTitle: 'B', startTime: '12:00', date: '2026-07-22' }, // 対象日外 → 除外
          { movieTitle: 'C', startTime: '14:00', date: '2026-07-21' },
        ],
        notes: null,
      }),
    )
    const { result } = await extractTextDaySplit({}, 'x', '2026-07', 'http://e.com/', '2026-07-21')
    expect(result.screenings.map((s) => s.movieTitle)).toEqual(['A', 'C'])
    expect(result.screenings.every((s) => s.date === '2026-07-21')).toBe(true)
    expect(result.notes).toContain('対象日外1件を除外')
  })

  it('発見が空配列なら日別呼出をせず 0件+notes で成功する（businessDate はフォールバック値）', async () => {
    extractMock.mockResolvedValueOnce(okResponse({ dates: [] }))
    const { result } = await extractTextDaySplit({}, 'x', '2026-07', 'http://e.com/', '2026-07-21')
    expect(extractMock).toHaveBeenCalledTimes(1)
    expect(result.screenings).toEqual([])
    expect(result.businessDate).toBe('2026-07-21')
    expect(result.notes).toBeTruthy() // V1（EMPTY_WITHOUT_REASON）を通すため必ず理由が入る
  })

  it('発見日付が上限を超えたら昇順で切詰め、notes に記録する', async () => {
    const dates = Array.from(
      { length: MAX_DATES + 2 },
      (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`,
    )
    extractMock.mockResolvedValueOnce(okResponse({ dates }))
    for (const d of dates.slice(0, MAX_DATES)) {
      extractMock.mockResolvedValueOnce(dayResult(d, ['X']))
    }
    const { result } = await extractTextDaySplit({}, 'x', '2026-08', 'http://e.com/', '2026-08-01')
    expect(extractMock).toHaveBeenCalledTimes(1 + MAX_DATES)
    expect(result.screenings).toHaveLength(MAX_DATES)
    expect(result.notes).toContain(`営業日${MAX_DATES + 2}件中${MAX_DATES}件のみ抽出`)
  })

  it('リトライ予算は呼出ごとに独立（発見で2回失敗しても日別はフル予算で成功できる）', async () => {
    extractMock
      .mockRejectedValueOnce(new Error('gemini 500'))
      .mockRejectedValueOnce(new Error('gemini 500'))
      .mockResolvedValueOnce(okResponse({ dates: ['2026-07-21'] })) // 発見: 3回目で成功
      .mockRejectedValueOnce(new Error('gemini 500'))
      .mockResolvedValueOnce(dayResult('2026-07-21', ['A'])) // 日別: 2回目で成功
    const { result } = await extractTextDaySplit({}, 'x', '2026-07', 'http://e.com/', '2026-07-21')
    expect(result.screenings).toHaveLength(1)
    expect(extractMock).toHaveBeenCalledTimes(5)
  })

  it('日別呼出が予算切れになると run 全体が失敗し、どの日で失敗したかを前置する', async () => {
    extractMock
      .mockResolvedValueOnce(okResponse({ dates: ['2026-07-21', '2026-07-22'] }))
      .mockResolvedValueOnce(dayResult('2026-07-21', ['A']))
      .mockRejectedValue(new Error('gemini timeout: 120000ms 経過'))
    await expect(
      extractTextDaySplit({}, 'x', '2026-07', 'http://e.com/', '2026-07-21'),
    ).rejects.toThrow(/日別抽出\(2026-07-22\).*予算切れ.*timeout/s)
    expect(extractMock).toHaveBeenCalledTimes(2 + 3) // 発見+1日目 + 2日目3試行で打ち切り
  })

  it('発見コールの zod NG（dateList スキーマ逸脱）は malformed 予算でリトライされる', async () => {
    extractMock
      .mockResolvedValueOnce(okResponse({ dates: ['not-a-date'] })) // zod NG
      .mockResolvedValueOnce(okResponse({ dates: [] }))
    const { result } = await extractTextDaySplit({}, 'x', '2026-07', 'http://e.com/', '2026-07-21')
    expect(result.screenings).toEqual([])
    expect(extractMock).toHaveBeenCalledTimes(2)
  })

  it('トークンが全呼出 null なら合算も null（混在時は非nullのみ合算）', async () => {
    extractMock
      .mockResolvedValueOnce({
        raw: JSON.stringify({ dates: ['2026-07-21'] }),
        model: 'stub:model',
        inTokens: null,
        outTokens: null,
      })
      .mockResolvedValueOnce({
        raw: JSON.stringify({ businessDate: '2026-07-21', screenings: [], notes: '休映' }),
        model: 'stub:model',
        inTokens: null,
        outTokens: 5,
      })
    const { ext } = await extractTextDaySplit({}, 'x', '2026-07', 'http://e.com/', '2026-07-21')
    expect(ext.inTokens).toBeNull()
    expect(ext.outTokens).toBe(5)
  })

  it('デッドライン超過で残りの日別呼出を打ち切る（リトライ予算を消費しない）', async () => {
    let clock = 0
    extractMock.mockImplementation(async (input: { responseFormat?: string }) => {
      clock += 400 // 1呼出=400ms 経過する偽時計
      if (input.responseFormat === 'dateList') {
        return okResponse({ dates: ['2026-07-21', '2026-07-22'] })
      }
      return dayResult('2026-07-21', ['A'])
    })
    await expect(
      extractTextDaySplit({}, 'x', '2026-07', 'http://e.com/', '2026-07-21', {
        deadlineMs: 500,
        now: () => clock,
      }),
    ).rejects.toThrow(/デッドライン超過.*1\/2日処理済み/)
    // 発見(t:0→400) + 1日目(t:400→800) の2呼出のみ。2日目は呼出前判定で打ち切り（リトライもされない）
    expect(extractMock).toHaveBeenCalledTimes(2)
  })
})

// 複数日取得の抽出（ADR-0019）: 文書ごとに日付が既知なので日付発見コールを行わない
describe('extractTextPerDocument', () => {
  const dayResult = (date: string, titles: string[], notes: string | null = null) =>
    okResponse({
      businessDate: date,
      screenings: titles.map((movieTitle) => ({ movieTitle, startTime: '10:00' })),
      notes,
    })

  const docs = (dates: string[]) =>
    dates.map((date) => ({ date, text: `<t>${date}</t>`, url: 'http://e.com/s' }))

  it('文書数と同じ回数だけ LLM を呼ぶ（日付発見コールが無い）', async () => {
    extractMock
      .mockResolvedValueOnce(dayResult('2026-07-25', ['A', 'B']))
      .mockResolvedValueOnce(dayResult('2026-07-26', ['C']))
      .mockResolvedValueOnce(dayResult('2026-07-27', ['D']))
    const { ext, result } = await extractTextPerDocument(
      {},
      docs(['2026-07-25', '2026-07-26', '2026-07-27']),
      '2026-07',
      '2026-07-25',
    )
    expect(extractMock).toHaveBeenCalledTimes(3) // 単日分割の 1+N ではなく N
    expect(result.screenings.map((s) => [s.date, s.movieTitle])).toEqual([
      ['2026-07-25', 'A'],
      ['2026-07-25', 'B'],
      ['2026-07-26', 'C'],
      ['2026-07-27', 'D'],
    ])
    expect(ext.promptVersion).toBe('text_v3')
    expect(ext.inTokens).toBe(3)
    expect(ext.outTokens).toBe(3)
  })

  it('基準日に対象日そのものを渡す（日付見出しの無い当日ブロックを拾わせるため）', async () => {
    extractMock.mockResolvedValueOnce(dayResult('2026-07-26', ['A']))
    await extractTextPerDocument({}, docs(['2026-07-26']), '2026-07', '2026-07-25')
    const input = extractMock.mock.calls[0]?.[0] as { userText: string; responseFormat?: string }
    expect(input.responseFormat).toBeUndefined() // dateList ではない
    expect(input.userText).toContain('businessDate="2026-07-26"') // 基準日 = 対象日
    expect(input.userText).toContain('対象日 2026-07-26')
  })

  it('対象日外の行は除外し notes に記録する', async () => {
    extractMock.mockResolvedValueOnce(
      okResponse({
        businessDate: '2026-07-25',
        screenings: [
          { movieTitle: 'A', startTime: '10:00', date: null },
          { movieTitle: 'B', startTime: '12:00', date: '2026-07-26' },
        ],
        notes: null,
      }),
    )
    const { result } = await extractTextPerDocument(
      {},
      docs(['2026-07-25']),
      '2026-07',
      '2026-07-25',
    )
    expect(result.screenings.map((s) => s.movieTitle)).toEqual(['A'])
    expect(result.notes).toContain('対象日外1件を除外')
  })

  it('文書が0件なら LLM を呼ばず 0件+notes で成功する', async () => {
    const { result } = await extractTextPerDocument({}, [], '2026-07', '2026-07-25')
    expect(extractMock).not.toHaveBeenCalled()
    expect(result.screenings).toEqual([])
    expect(result.businessDate).toBe('2026-07-25')
    expect(result.notes).toBeTruthy() // V1（EMPTY_WITHOUT_REASON）を通す
  })

  it('fetch 側の取り逃し（extraNotes）を notes に引き継ぐ', async () => {
    extractMock.mockResolvedValueOnce(dayResult('2026-07-25', ['A']))
    const { result } = await extractTextPerDocument(
      {},
      docs(['2026-07-25']),
      '2026-07',
      '2026-07-25',
      { extraNotes: ['2026-07-26: 内容が変化せず未取得'] },
    )
    expect(result.notes).toContain('2026-07-26: 内容が変化せず未取得')
  })

  it('リトライ予算は呼出ごとに独立（1日目で2回失敗しても2日目はフル予算）', async () => {
    extractMock
      .mockRejectedValueOnce(new Error('gemini 500'))
      .mockRejectedValueOnce(new Error('gemini 500'))
      .mockResolvedValueOnce(dayResult('2026-07-25', ['A']))
      .mockRejectedValueOnce(new Error('gemini 500'))
      .mockResolvedValueOnce(dayResult('2026-07-26', ['B']))
    const { result } = await extractTextPerDocument(
      {},
      docs(['2026-07-25', '2026-07-26']),
      '2026-07',
      '2026-07-25',
    )
    expect(result.screenings).toHaveLength(2)
    expect(extractMock).toHaveBeenCalledTimes(5)
  })

  it('デッドライン超過は1日以上成功していれば部分結果を返す（打ち切り）', async () => {
    let clock = 0
    extractMock.mockImplementation(async () => {
      clock += 400 // 1呼出=400ms 経過する偽時計
      return dayResult('2026-07-25', ['A'])
    })
    const { result } = await extractTextPerDocument(
      {},
      docs(['2026-07-25', '2026-07-26', '2026-07-27']),
      '2026-07',
      '2026-07-25',
      { deadlineMs: 500, now: () => clock },
    )
    // 1日目(t:0→400)・2日目(t:400→800)は成功、3日目は呼出前判定(t:800≥500)で打ち切り
    expect(extractMock).toHaveBeenCalledTimes(2)
    expect(result.screenings).toHaveLength(2)
    expect(result.notes).toContain('2/3日で打ち切り')
  })

  it('デッドライン超過で0日なら throw する（単日経路と同じ）', async () => {
    let first = true
    const now = () => {
      if (first) {
        first = false
        return 0 // startedAt
      }
      return 10_000 // 1日目の呼出前判定でもう超過している
    }
    extractMock.mockResolvedValue(dayResult('2026-07-25', ['A']))
    await expect(
      extractTextPerDocument({}, docs(['2026-07-25']), '2026-07', '2026-07-25', {
        deadlineMs: 500,
        now,
      }),
    ).rejects.toThrow(/デッドライン超過/)
    expect(extractMock).not.toHaveBeenCalled()
  })
})
