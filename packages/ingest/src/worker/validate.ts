import type { ExtractionResult as ExtractionResultT, ValidationCode } from '@cinema/shared'
import { ExtractionResult } from '@cinema/shared'
import { inBusinessWindow, type PreNormalized } from './normalize'

export interface ValidationNg {
  code: ValidationCode
  detail: string
}

// zod 検証（docs/06 §5）。失敗（ZodError）は呼び出し側で extraction_failed 扱い。
export function parseExtraction(parsed: unknown): ExtractionResultT {
  return ExtractionResult.parse(parsed)
}

// 妥当性検証 V1/V2/V5/V6（正規化前）。1つでも NG なら返す（null=通過）。
export function validateExtracted(
  result: ExtractionResultT,
  ctx: { avgCount?: number },
): ValidationNg | null {
  const s = result.screenings

  // V1: 0件のとき notes に理由が無い
  if (s.length === 0 && (result.notes === null || result.notes.trim() === '')) {
    return { code: 'EMPTY_WITHOUT_REASON', detail: '上映0件だが notes に理由なし' }
  }
  // V2: 件数が過去平均の 50〜200% を逸脱（履歴3件以上のとき。avgCount 未定義はスキップ）
  if (ctx.avgCount !== undefined && ctx.avgCount > 0) {
    if (s.length < ctx.avgCount * 0.5 || s.length > ctx.avgCount * 2) {
      return { code: 'COUNT_ANOMALY', detail: `件数 ${s.length} が平均 ${ctx.avgCount} を逸脱` }
    }
  }
  // V5: 同一 (実効date, movieTitle, startTime, screen) の重複。
  // 多スクリーン館は同一作品・同時刻を別スクリーンで上映しうるため screen を含める（migration 0003）。
  const seen = new Set<string>()
  for (const sc of s) {
    const key = `${sc.date ?? result.businessDate}|${sc.movieTitle}|${sc.startTime}|${sc.screenName ?? ''}`
    if (seen.has(key)) return { code: 'DUPLICATE_ROW', detail: `重複 ${key}` }
    seen.add(key)
  }
  // V6: movieTitle に HTML タグ / URL 混入
  for (const sc of s) {
    if (/<[^>]+>|https?:\/\//i.test(sc.movieTitle)) {
      return { code: 'DIRTY_TITLE', detail: `不正タイトル: ${sc.movieTitle}` }
    }
  }
  return null
}

// 妥当性検証 V3/V4（正規化後）。
export function validateNormalized(rows: PreNormalized[]): ValidationNg | null {
  for (const r of rows) {
    // V4: endTime 指定なのに end <= start（24時超え正規化後）
    if (r.endAtSource === 'site' && new Date(r.endAt).getTime() <= new Date(r.startAt).getTime()) {
      return { code: 'NEGATIVE_DURATION', detail: `end<=start: ${r.movieTitle} ${r.startAt}` }
    }
    // V3: start_at が businessDate 06:00〜翌04:00 JST を逸脱
    if (!inBusinessWindow(r.businessDate, r.startAt)) {
      return { code: 'TIME_OUT_OF_RANGE', detail: `範囲外: ${r.movieTitle} ${r.startAt}` }
    }
  }
  return null
}
