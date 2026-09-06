import type {
  ExtractedDateList as ExtractedDateListT,
  ExtractedScreening as ExtractedScreeningT,
  ExtractionResult as ExtractionResultT,
  ValidationCode,
} from '@cinema/shared'
import { ExtractedDateList, ExtractedScreening, ExtractionResultLoose } from '@cinema/shared'
import { inBusinessWindow, type PreNormalized } from './normalize'

export interface ValidationNg {
  code: ValidationCode
  detail: string
}

// ---- zod 検証（docs/spec/06 §5.0・ADR-0023）----

// スキーマ検証の失敗。temperature 0 では再送しても同じ出力になるためリトライしない
// （extract.ts の withRetries が種別で分岐する。ADR-0023）。
export class ExtractionSchemaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtractionSchemaError'
  }
}

// ZodError の issue は received 値を含まない。値が分からないと error_message だけでは
// 原因が特定できず、毎回 R2 スナップショットを取りに行くことになる（大阪ステーションシネマの
// "未定" が4回再発したときが実際にそうだった）。issue.path から実値を引いて添える。
// log.ts のガードレール（LLM 生出力の本文はログに載せない）に従い、載せるのは
// 当該フィールドの値のみ・40字まで・先頭5件まで。
const MAX_VALUE_CHARS = 40
const MAX_REPORTED_ISSUES = 5

// ZodIssue のうちここで使う部分だけの構造型。@cinema/ingest は zod に直接依存しない
// （zod スキーマは packages/shared が唯一の真実。CLAUDE.md モノレポ構成）。
export interface SchemaIssue {
  path: PropertyKey[]
  code: string
  validation?: unknown
}

function valueAtPath(root: unknown, path: PropertyKey[]): unknown {
  let cur: unknown = root
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined
    cur = (cur as Record<PropertyKey, unknown>)[key]
  }
  return cur
}

function formatValue(v: unknown): string {
  if (v === undefined) return '(欠落)'
  let s: string
  try {
    s = JSON.stringify(v) ?? String(v)
  } catch {
    s = String(v)
  }
  return s.length > MAX_VALUE_CHARS ? `${s.slice(0, MAX_VALUE_CHARS)}…` : s
}

function pathLabel(path: PropertyKey[]): string {
  return path
    .map((k) => (typeof k === 'number' ? `[${k}]` : `.${String(k)}`))
    .join('')
    .replace(/^\./, '')
}

// issue 一覧を「パス=実値(コード)」の読める1行にする。prefix は行単位検証で
// 親配列の添字（'screenings[3].'）を前置するために使う。
export function describeZodIssues(root: unknown, issues: SchemaIssue[], prefix = ''): string {
  const shown = issues.slice(0, MAX_REPORTED_ISSUES).map((i) => {
    const label = pathLabel(i.path) || '(ルート)'
    const kind = 'validation' in i ? `${i.code}:${String(i.validation)}` : i.code
    return `${prefix}${label}=${formatValue(valueAtPath(root, i.path))}(${kind})`
  })
  const rest = issues.length - shown.length
  return shown.join(', ') + (rest > 0 ? ` ほか${rest}件` : '')
}

// zod 検証（docs/spec/06 §5.0）。封筒（businessDate/notes・screenings が配列であること）は
// 厳格に検証し、screenings は1件ずつ検証して NG 行だけを捨てる。捨てた行は理由と実値を
// notes に追記して続行する（1行の不正で run 全体を落とすと、同じ呼出で正しく取れた他の行・
// 他の日まで失われるため。ADR-0023）。捨てすぎは後段の V2 COUNT_ANOMALY が拾う。
// 封筒が NG のときのみ throw（呼び出し側で extraction_failed 確定）。
export function parseExtraction(parsed: unknown): ExtractionResultT {
  const env = ExtractionResultLoose.safeParse(parsed)
  if (!env.success) {
    throw new ExtractionSchemaError(
      `抽出結果の形が不正: ${describeZodIssues(parsed, env.error.issues)}`,
    )
  }
  const envelope = env.data
  const kept: ExtractedScreeningT[] = []
  const dropped: string[] = []
  for (const [i, row] of envelope.screenings.entries()) {
    const r = ExtractedScreening.safeParse(row)
    if (r.success) {
      kept.push(r.data)
      continue
    }
    if (dropped.length < MAX_REPORTED_ISSUES) {
      dropped.push(describeZodIssues(row, r.error.issues, `screenings[${i}].`))
    }
  }
  const droppedTotal = envelope.screenings.length - kept.length
  if (droppedTotal === 0) return { ...envelope, screenings: kept }

  const detail = dropped.join(', ')
  const rest = droppedTotal - dropped.length
  const note = `スキーマ不正の${droppedTotal}件を除外: ${detail}${rest > 0 ? ` ほか${rest}件` : ''}`
  return {
    ...envelope,
    screenings: kept,
    notes: envelope.notes ? `${envelope.notes} / ${note}` : note,
  }
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
  // screenName を公開していない劇場（空文字。例: 大阪ステーションシネマ）は、同一作品の
  // 同時刻並行上映（ライブ・ビューイング等）と LLM の行重複を区別する情報が無く、正当な
  // 2行が重複に見える。V7 と同じ理由でスキップし、その劇場群は V2 が主防御になる（ADR-0024）。
  const seen = new Set<string>()
  for (const sc of s) {
    const screen = sc.screenName ?? ''
    if (screen === '') continue
    const key = `${sc.date ?? result.businessDate}|${sc.movieTitle}|${sc.startTime}|${screen}`
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

// 日付発見コール（text 日分割・ADR-0017）の検証。ExtractedDateList は行落としの対象外
// （対象日が決まらないと日別コールを組み立てられないため全体失敗）。実値だけ添える。
export function parseDateList(parsed: unknown): ExtractedDateListT {
  const r = ExtractedDateList.safeParse(parsed)
  if (!r.success) {
    throw new ExtractionSchemaError(
      `日付一覧の形が不正: ${describeZodIssues(parsed, r.error.issues)}`,
    )
  }
  return r.data
}
