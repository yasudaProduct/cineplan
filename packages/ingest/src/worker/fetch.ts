// P1-1 Fetch。取得マナー（docs/spec/08 §3）: 正直UA・同一ホスト5秒間隔・30sタイムアウト・偽装しない。
// vision 劇場は schedule ページ HTML から画像URLを抽出し、画像も取得する。
// 複数日取得（tabs / url_template。ADR-0019・docs/spec/06 §2.2）も同じマナーで直列に行う。

import type { FetchDayMode } from '@cinema/shared'
import { logInfo } from '../log'
import {
  clickDateTabInPage,
  collectDateTabsInPage,
  enumerateFetchDates,
  readContentSignatureInPage,
  resolveDateUrl,
  selectFetchDates,
} from './date-tabs'

// UA は正直に名乗る（docs/spec/08 §3）。<domain> はドメイン確定（P5）まで暫定。
export const USER_AGENT = 'CinemaHashigoBot/0.1 (+https://example.com/bot)'
const TIMEOUT_MS = 30_000
const HOST_INTERVAL_MS = 5_000
// タブクリック後に内容（本文テキスト）が変化するまでの待機上限とポーリング間隔
const TAB_WAIT_MS = 10_000
const TAB_POLL_MS = 250

export interface FetchedImage {
  url: string
  mimeType: string
  bytes: ArrayBuffer
  lastModified: string | null
}

// 複数日取得（ADR-0019）で得た1日分の文書
export interface FetchedDay {
  date: string // YYYY-MM-DD
  html: string
  url: string // 実際に取得した URL（url_template は日付展開後）
}

export interface FetchedSchedule {
  scheduleHtml: string // 既定文書（複数日取得時は days[0].html）。従来の読み手はそのまま動く
  images: FetchedImage[]
  fetchedAt: string // UTC ISO
  days?: FetchedDay[] // 複数日取得時のみ（1件以上）。single・タブ0件検出時は undefined
  dayNotes?: string[] // 取り逃した日・変化未確認などの記録（抽出結果の notes に反映）
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function fetchWithUA(url: string): Promise<Response> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': USER_AGENT },
      signal: ctrl.signal,
      redirect: 'follow',
    })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res
  } finally {
    clearTimeout(timer)
  }
}

// schedule ページ HTML から `image/schedule/*` の画像URLを抽出し絶対URL化。
export function extractScheduleImageUrls(html: string, baseUrl: string): string[] {
  const re = /<img[^>]+src=["']([^"']*image\/schedule\/[^"']+)["']/gi
  const urls: string[] = []
  for (let m = re.exec(html); m !== null; m = re.exec(html)) {
    const raw = m[1]
    if (raw) urls.push(new URL(raw, baseUrl).toString())
  }
  return [...new Set(urls)]
}

export interface FetchTarget {
  scheduleUrl: string
  extractMethod: 'text' | 'vision'
}

export async function fetchSchedule(theater: FetchTarget): Promise<FetchedSchedule> {
  const fetchedAt = new Date().toISOString()
  const htmlRes = await fetchWithUA(theater.scheduleUrl)
  const scheduleHtml = await htmlRes.text()
  const images: FetchedImage[] = []

  if (theater.extractMethod === 'vision') {
    const urls = extractScheduleImageUrls(scheduleHtml, theater.scheduleUrl)
    for (const url of urls) {
      await sleep(HOST_INTERVAL_MS) // 同一ホスト5秒間隔（docs/spec/08 §3）
      const res = await fetchWithUA(url)
      images.push({
        url,
        mimeType: res.headers.get('content-type')?.split(';')[0]?.trim() ?? 'image/gif',
        bytes: await res.arrayBuffer(),
        lastModified: res.headers.get('last-modified'),
      })
    }
  }
  return { scheduleHtml, images, fetchedAt }
}

export interface RenderedFetchOptions {
  dayMode?: FetchDayMode // 既定 'single'
  days?: number // 0 = 検出タブ全件
  businessDate?: string // JST 当日。取得対象日の下限（過去日を取らない）
}

// rendered 取得（P4-7・docs/spec/06 §2.0）。Browser Rendering で JS 描画後の DOM を取得する。
// 既定（dayMode='single'）は 1回の取込 = 1回のページロード。dayMode='tabs' は同一ページ上で
// 日付タブを5秒間隔・直列にクリックし、日付ごとの DOM を集める（ADR-0019・docs/spec/06 §2.2）。
// 取得マナーは static と同じ。画像は取得しない（text 抽出前提）。
// puppeteer は動的 import（vitest の Node 環境で workers 専用依存を読み込まないため）。
export async function fetchRenderedSchedule(
  browser: import('@cloudflare/puppeteer').BrowserWorker,
  scheduleUrl: string,
  opts?: RenderedFetchOptions,
): Promise<FetchedSchedule> {
  const fetchedAt = new Date().toISOString()
  const puppeteer = (await import('@cloudflare/puppeteer')).default
  const instance = await puppeteer.launch(browser)
  try {
    const page = await instance.newPage()
    await page.setUserAgent(USER_AGENT) // 正直 UA（docs/spec/08 §3）
    const res = await page.goto(scheduleUrl, { waitUntil: 'networkidle0', timeout: TIMEOUT_MS })
    if (res && !res.ok() && res.status() !== 304) {
      throw new Error(`HTTP ${res.status()} for ${scheduleUrl}`)
    }
    const firstHtml = await page.content() // 描画後 DOM
    if (opts?.dayMode !== 'tabs') return { scheduleHtml: firstHtml, images: [], fetchedAt }

    // 日付タブを検出（構造非依存。値が YYYY-MM-DD の属性を属性名非依存で収集）
    const businessDate = opts.businessDate ?? fetchedAt.slice(0, 10)
    const found = await page.evaluate(collectDateTabsInPage)
    const dates = selectFetchDates(found, opts.days ?? 1, businessDate)
    logInfo('fetch.tabs.found', { found: found.length, targets: dates.length, dates })
    if (dates.length === 0) {
      // タブが無い（または全て過去日）サイトは single と同じ挙動に自動フォールバックする
      logInfo('fetch.tabs.none', { found: found.length })
      return { scheduleHtml: firstHtml, images: [], fetchedAt }
    }

    // 同一オリジンの XHR/fetch レスポンス数を数え、「タブ操作で実際に AJAX が飛んだか」を
    // 本文変化とは独立に判定する。**内容が前日と同一の日を取りこぼさないための要**:
    // シネコンの平日（月火水など）は編成が完全に同一になることがあり、本文テキストの
    // 変化だけを見ると「AJAX 未着」と区別できない（実測: T・ジョイ梅田で 7/28・7/29 を
    // 誤って捨てた。ADR-0019・docs/spec/06 §2.2）。第三者（広告・計測）は host 一致で除外する。
    const pageHost = new URL(scheduleUrl).host
    let sameOriginXhr = 0
    page.on('response', (res) => {
      try {
        const type = res.request().resourceType()
        if ((type === 'xhr' || type === 'fetch') && new URL(res.url()).host === pageHost) {
          sameOriginXhr++
        }
      } catch {
        // URL が解釈できないレスポンスは無視する
      }
    })

    const days: FetchedDay[] = []
    const dayNotes: string[] = []
    for (const [i, date] of dates.entries()) {
      await sleep(HOST_INTERVAL_MS) // 同一ホスト5秒間隔（docs/spec/08 §0・§3。タブ操作も対象）
      const before = await page.evaluate(readContentSignatureInPage)
      const xhrBefore = sameOriginXhr
      const clicked = await page.evaluate(clickDateTabInPage, date)
      if (!clicked) {
        dayNotes.push(`${date}: 日付タブが見つからず未取得`)
        logInfo('fetch.tabs.click_missed', { date })
        continue
      }
      // AJAX 到着待ち: networkidle は best-effort、確証は本文変化 or 同一オリジン XHR で取る
      await page.waitForNetworkIdle({ idleTime: 500, timeout: TAB_WAIT_MS }).catch(() => {})
      const changed = await waitForContentChange(page, before)
      const xhrFired = sameOriginXhr > xhrBefore
      if (!changed && !xhrFired && i > 0) {
        // クリックが何も起こさなかった。前日の DOM を別日として書き込まないため捨てる
        dayNotes.push(`${date}: 内容が変化せずAJAXも発生しないため未取得`)
        logInfo('fetch.tabs.unchanged', { date, xhrFired })
        continue
      }
      if (!changed && xhrFired) {
        // AJAX は飛んだが本文が同一 = 前日と編成が同じ日。正当なデータとして採用する
        logInfo('fetch.tabs.same_content', { date })
      }
      days.push({ date, html: await page.content(), url: scheduleUrl })
    }
    return {
      scheduleHtml: days[0]?.html ?? firstHtml,
      images: [],
      fetchedAt,
      days: days.length > 0 ? days : undefined,
      dayNotes,
    }
  } finally {
    await instance.close()
  }
}

// 本文テキストのシグネチャが before から変化し、かつ1周期分安定するまで待つ。
type SignaturePage = { evaluate: (fn: () => string) => Promise<string> }
async function waitForContentChange(page: SignaturePage, before: string): Promise<boolean> {
  const deadline = Date.now() + TAB_WAIT_MS
  let last: string | null = null
  while (Date.now() < deadline) {
    const now = await page.evaluate(readContentSignatureInPage)
    if (now !== before) {
      if (last === now) return true // 変化後に安定した（描画途中を掴まない）
      last = now
    }
    await sleep(TAB_POLL_MS)
  }
  return false
}

// url_template 取得（ADR-0019）。schedule_url の {date} を置換して日付ごとに静的取得する。
// ブラウザは使わない。初日の失敗は throw（URL 設定ミスを黙って通さない）、
// 2日目以降の失敗はその日をスキップして dayNotes に記録する（未掲載日が404を返す等は正常）。
export interface DateTemplateTarget {
  scheduleUrl: string // {date} を含む
  businessDate: string // JST 当日
  days: number // 1..MAX_FETCH_DAYS
}

export async function fetchScheduleByDateTemplate(
  target: DateTemplateTarget,
): Promise<FetchedSchedule> {
  const fetchedAt = new Date().toISOString()
  const dates = enumerateFetchDates(target.businessDate, target.days)
  const days: FetchedDay[] = []
  const dayNotes: string[] = []
  for (const [i, date] of dates.entries()) {
    if (i > 0) await sleep(HOST_INTERVAL_MS) // 同一ホスト5秒間隔（docs/spec/08 §0・§3）
    const url = resolveDateUrl(target.scheduleUrl, date)
    try {
      const res = await fetchWithUA(url)
      days.push({ date, html: await res.text(), url })
    } catch (e) {
      if (i === 0) throw e // 初日が取れない = 設定ミスの可能性が高いので fetch_failed にする
      dayNotes.push(`${date}: 取得失敗のため未取得（${(e as Error).message}）`)
      logInfo('fetch.template.skip', { date, url, error: (e as Error).message })
    }
  }
  const first = days[0]
  if (!first) throw new Error(`url_template で取得できた日がありません（${target.scheduleUrl}）`)
  return { scheduleHtml: first.html, images: [], fetchedAt, days, dayNotes }
}
