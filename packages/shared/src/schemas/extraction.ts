import { z } from 'zod'

// 時刻は「時 0〜29・分 00〜59」に制約する（docs/spec/06 §3・§6。24時超えは 24:00〜29:59 のみ許容）。
// 分を \d{2} のまま（00〜99許容）にすると "10:75" 等の不正時刻が regex を素通りし、
// 正規化（normalizeStart の setHours）が silent に別時刻へ丸めてしまうため、値域を絞る。
const TIME_RE = /^(2[0-9]|[01]?[0-9]):[0-5]\d$/

// LLM 抽出の出力スキーマ（docs/spec/06 §3）。サイト表記のまま。正規化は後段（ingest）。
// 任意フィールドは .nullish()（null も欠落も許容）。LLM の構造化出力は空フィールドを
// null ではなく省略(undefined)することがあるため（Gemini 実データで判明）。
export const ExtractedScreening = z.object({
  // 月間画像等で各行に日付が紐づく場合に補完（ADR-0012）。実効 businessDate は date ?? ExtractionResult.businessDate。
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullish(),
  movieTitle: z.string().min(1),
  startTime: z.string().regex(TIME_RE), // "25:10" 等の24時超え許容（時0〜29・分00〜59）
  endTime: z.string().regex(TIME_RE).nullish(), // 記載なければ省略/null
  format: z.string().nullish(),
  screenName: z.string().nullish(),
  detailPath: z.string().nullish(),
})
export type ExtractedScreening = z.infer<typeof ExtractedScreening>

export const ExtractionResult = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // 単日ページの対象日 / 月間画像では基準日
  screenings: z.array(ExtractedScreening),
  // provider の responseSchema の required に notes を含めていないため、空のとき値自体を
  // 省略(undefined)してくる場合がある（Gemini 実データで判明）。.nullable() だと ZodError になる。
  notes: z.string().nullish(), // LLM が気付いた異常（"休館日と記載" 等）
})
export type ExtractionResult = z.infer<typeof ExtractionResult>

// 行単位の寛容パース用（docs/spec/06 §5.0・ADR-0023）。封筒（businessDate/notes と
// screenings が配列であること）だけを検証し、要素は未検証のまま受ける。呼び出し側
// （ingest の parseExtraction）が ExtractedScreening で1件ずつ検証し、NG 行を捨てる。
// 1行の不正で run 全体を落とすと、同じ呼出で正しく取れた他の行まで失われるため。
export const ExtractionResultLoose = ExtractionResult.extend({
  screenings: z.array(z.unknown()),
})
export type ExtractionResultLoose = z.infer<typeof ExtractionResultLoose>

// text 日単位分割の日付発見コールの出力（docs/spec/06 §1・§4 text_v2・ADR-0017）。
export const ExtractedDateList = z.object({
  dates: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)), // ページに上映掲載がある営業日
  notes: z.string().nullish(),
})
export type ExtractedDateList = z.infer<typeof ExtractedDateList>
