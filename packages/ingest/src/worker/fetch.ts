// P1-1 Fetch。取得マナー（docs/08 §3）: 正直UA・同一ホスト5秒間隔・30sタイムアウト・偽装しない。
// vision 劇場は schedule ページ HTML から画像URLを抽出し、画像も取得する。

// UA は正直に名乗る（docs/08 §3）。<domain> はドメイン確定（P5）まで暫定。
export const USER_AGENT = 'CinemaHashigoBot/0.1 (+https://example.com/bot)'
const TIMEOUT_MS = 30_000
const HOST_INTERVAL_MS = 5_000

export interface FetchedImage {
  url: string
  mimeType: string
  bytes: ArrayBuffer
  lastModified: string | null
}

export interface FetchedSchedule {
  scheduleHtml: string
  images: FetchedImage[]
  fetchedAt: string // UTC ISO
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
      await sleep(HOST_INTERVAL_MS) // 同一ホスト5秒間隔（docs/08 §3）
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
