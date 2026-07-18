import type { ExtractionResult } from '@cinema/shared'
import { normalizeStart } from '@cinema/shared'

// movie_id 解決前の正規化済み screening（UTC 化・endAt 補完済み）。
export interface PreNormalized {
  businessDate: string
  movieTitle: string
  startAt: string // UTC ISO
  endAt: string // UTC ISO
  endAtSource: 'site' | 'estimated'
  format: string | null
  screenName: string // 単一館は ''。多スクリーン一意性用
  detailUrl: string | null
}

const ESTIMATED_RUNTIME_MIN = 120
const TRAILER_MIN = 10

function addMinutesIso(iso: string, min: number): string {
  return new Date(new Date(iso).getTime() + min * 60_000).toISOString()
}

// detailPath（LLM抽出・未検証の文字列）→ 絶対URL（docs/06 §6.4）。
// 相対URLは scheduleUrl 基準で絶対化、外部ドメイン（チケットベンダー等）はそのまま保持。
// http(s) 以外のスキーム（javascript: 等。href の誤抽出で混入しうる）や、絶対化しても
// パース不能な文字列は null にする（呼び出し側 build.ts が theater の officialUrl へ
// フォールバックする。plan.ts の ScreeningLeg.officialUrl は z.string().url() 必須のため）。
function resolveDetailUrl(
  detailPath: string | null | undefined,
  scheduleUrl: string,
): string | null {
  if (!detailPath) return null
  try {
    const url = new URL(detailPath, scheduleUrl)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null
  } catch {
    return null
  }
}

// 各 screening を UTC 化（docs/06 §6）。実効 businessDate は date ?? result.businessDate。
// endTime 記載があればそれ、無ければ start + 120 + 10分（予告）の既定（runtime 不明時）。
// scheduleUrl は detailPath の絶対化の基準（取込元劇場の schedule_url）。
export function normalize(result: ExtractionResult, scheduleUrl: string): PreNormalized[] {
  const out: PreNormalized[] = []
  for (const sc of result.screenings) {
    const businessDate = sc.date ?? result.businessDate
    const startAt = normalizeStart(businessDate, sc.startTime)
    let endAt: string
    let endAtSource: 'site' | 'estimated'
    if (sc.endTime) {
      endAt = normalizeStart(businessDate, sc.endTime)
      endAtSource = 'site'
    } else {
      endAt = addMinutesIso(startAt, ESTIMATED_RUNTIME_MIN + TRAILER_MIN)
      endAtSource = 'estimated'
    }
    out.push({
      businessDate,
      movieTitle: sc.movieTitle,
      startAt,
      endAt,
      endAtSource,
      format: sc.format ?? null,
      screenName: sc.screenName ?? '',
      detailUrl: resolveDetailUrl(sc.detailPath, scheduleUrl),
    })
  }
  return out
}

// businessDate の興行時間帯 06:00〜翌04:00 JST に start_at が収まるか（V3 用）。
export function inBusinessWindow(businessDate: string, startAtIso: string): boolean {
  const lo = new Date(normalizeStart(businessDate, '06:00')).getTime()
  const hi = new Date(normalizeStart(businessDate, '28:00')).getTime() // 翌04:00 JST
  const t = new Date(startAtIso).getTime()
  return t >= lo && t <= hi
}
