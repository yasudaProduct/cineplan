import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractScheduleImageUrls, fetchScheduleByDateTemplate } from '../fetch'

describe('extractScheduleImageUrls', () => {
  const base = 'http://www.cinenouveau.com/schedule/schedule1.html'

  it('image/schedule 配下の画像だけを絶対URL化して抽出', () => {
    const html = `
      <img src="../image/logo.gif">
      <img src="../image/schedule/202607.gif">
      <img src='../image/schedule/202607sche4.gif'>
      <img src="../image/ticketlogo.gif">
    `
    expect(extractScheduleImageUrls(html, base)).toEqual([
      'http://www.cinenouveau.com/image/schedule/202607.gif',
      'http://www.cinenouveau.com/image/schedule/202607sche4.gif',
    ])
  })

  it('重複は除去', () => {
    const html = `<img src="../image/schedule/a.gif"><img src="../image/schedule/a.gif">`
    expect(extractScheduleImageUrls(html, base)).toHaveLength(1)
  })

  it('該当画像が無ければ空配列', () => {
    expect(extractScheduleImageUrls('<img src="../image/logo.gif">', base)).toEqual([])
  })
})

// 複数日取得の url_template 経路（ADR-0019）。同一ホスト5秒間隔は fake timer で飛ばす。
describe('fetchScheduleByDateTemplate', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  const okRes = (body: string) => new Response(body, { status: 200 })

  // sleep(5s) を含むため、タイマーを進めながら解決させる
  const runWithFakeTimers = async <T>(p: () => Promise<T>): Promise<T> => {
    vi.useFakeTimers()
    const promise = p()
    await vi.runAllTimersAsync()
    return promise
  }

  it('{date} を展開して日付ごとに取得し、days[] を返す', async () => {
    const urls: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url)
        return okRes(`<html>${url}</html>`)
      }),
    )
    const got = await runWithFakeTimers(() =>
      fetchScheduleByDateTemplate({
        scheduleUrl: 'http://e.com/s?d={date}',
        businessDate: '2026-07-25',
        days: 3,
      }),
    )
    expect(urls).toEqual([
      'http://e.com/s?d=2026-07-25',
      'http://e.com/s?d=2026-07-26',
      'http://e.com/s?d=2026-07-27',
    ])
    expect(got.days?.map((d) => d.date)).toEqual(['2026-07-25', '2026-07-26', '2026-07-27'])
    expect(got.scheduleHtml).toBe(got.days?.[0]?.html) // 既定文書は初日
    expect(got.images).toEqual([])
  })

  it('初日の取得失敗は throw する（URL 設定ミスを黙って通さない）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ng', { status: 404 })),
    )
    await expect(
      runWithFakeTimers(() =>
        fetchScheduleByDateTemplate({
          scheduleUrl: 'http://e.com/s?d={date}',
          businessDate: '2026-07-25',
          days: 3,
        }),
      ),
    ).rejects.toThrow(/HTTP 404/)
  })

  it('2日目以降の失敗はその日だけ落として dayNotes に記録し続行する', async () => {
    let n = 0
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        n++
        return n === 2 ? new Response('ng', { status: 404 }) : okRes(`<html>${n}</html>`)
      }),
    )
    const got = await runWithFakeTimers(() =>
      fetchScheduleByDateTemplate({
        scheduleUrl: 'http://e.com/s?d={date}',
        businessDate: '2026-07-25',
        days: 3,
      }),
    )
    expect(got.days?.map((d) => d.date)).toEqual(['2026-07-25', '2026-07-27'])
    expect(got.dayNotes?.join(' ')).toContain('2026-07-26')
  })
})
