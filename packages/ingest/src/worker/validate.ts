import type { ExtractionResult as ExtractionResultT, ValidationCode } from '@cinema/shared'
import { ExtractionResult } from '@cinema/shared'
import { inBusinessWindow, type PreNormalized } from './normalize'

export interface ValidationNg {
  code: ValidationCode
  detail: string
}

// zod 検証（docs/spec/06 §5）。失敗（ZodError）は呼び出し側で extraction_failed 扱い。
export function parseExtraction(parsed: unknown): ExtractionResultT {
  return ExtractionResult.parse(parsed)
}

// 妥当性検証 V1/V2/V5/V6（正規化前）。1つでも NG なら返す（null=通過）。
export function validateExtracted(
  result: ExtractionResultT,
  ctx: { avgCount?: number },
): ValidationNg | null {
  const s = result.screenings

  // V1: 0件のとき notes に理由が無い（notes は null/undefined を同一視して扱う）
  if (s.length === 0 && (result.notes ?? '').trim() === '') {
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

// 妥当性検証 V3/V4/V7（正規化後）。書込より前に走るため、ここで弾かれた run は
// D1 を一切変更しない（洗い替えによるデータ損失も起きない。docs/spec/06 §5）。
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
  return validateScreenOverlap(rows)
}

// V7: 1スクリーンで上映時間帯が重複 / 別作品の開始時刻が完全一致（ADR-0020）。
// 月間グリッド画像の全日程が単一日に潰れる類の日付誤りを、書込前に確実に捕まえる主防御。
function validateScreenOverlap(rows: PreNormalized[]): ValidationNg | null {
  // screenName が '' の劇場はスクリーンを公開していない（例: 大阪ステーションシネマ）。
  // 並行上映を1グループに畳んで誤検知するためスキップする（その劇場は V2 が主防御になる）。
  const byScreen = new Map<string, PreNormalized[]>()
  for (const r of rows) {
    if (r.screenName === '') continue
    const key = `${r.businessDate}|${r.screenName}`
    const list = byScreen.get(key)
    if (list) list.push(r)
    else byScreen.set(key, [r])
  }

  for (const [key, list] of byScreen) {
    // startAt 昇順に並べれば隣接ペアの比較だけで任意の重複を検出できる
    // （prev.end <= cur.start なら、それ以降の開始はさらに後なので prev はどれとも重ならない）。
    const sorted = [...list].sort(
      (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime(),
    )
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const cur = sorted[i]
      if (!prev || !cur) continue
      const prevStart = new Date(prev.startAt).getTime()
      const prevEnd = new Date(prev.endAt).getTime()
      const curStart = new Date(cur.startAt).getTime()
      // 同一分に2作品を開始することは endAt の由来に関わらず不可能
      if (prevStart === curStart) {
        return {
          code: 'SCREEN_TIME_OVERLAP',
          detail: `開始時刻が同一 ${key} ${cur.startAt}: ${prev.movieTitle} / ${cur.movieTitle}`,
        }
      }
      // 推定尺（estimated）は尺違いで誤検知しうるため、site 由来の終了時刻だけで重複判定する
      if (prev.endAtSource === 'site' && prevEnd > curStart) {
        return {
          code: 'SCREEN_TIME_OVERLAP',
          detail: `時間帯重複 ${key}: ${prev.movieTitle}(〜${prev.endAt}) と ${cur.movieTitle}(${cur.startAt}〜)`,
        }
      }
    }
  }
  return null
}
