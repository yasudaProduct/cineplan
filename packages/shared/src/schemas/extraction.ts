import { z } from 'zod'

// LLM 抽出の出力スキーマ（docs/06 §3）。サイト表記のまま。正規化は後段（ingest）。
export const ExtractedScreening = z.object({
  // 月間画像等で各行に日付が紐づく場合に補完（ADR-0012）。単日ページは null。
  // 実効 businessDate は date ?? ExtractionResult.businessDate。
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  movieTitle: z.string().min(1),
  startTime: z.string().regex(/^\d{1,2}:\d{2}$/), // "25:10" 等の24時超え許容
  endTime: z
    .string()
    .regex(/^\d{1,2}:\d{2}$/)
    .nullable(), // 記載なければ null
  format: z.string().nullable(),
  screenName: z.string().nullable(),
  detailPath: z.string().nullable(),
})
export type ExtractedScreening = z.infer<typeof ExtractedScreening>

export const ExtractionResult = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // 単日ページの対象日 / 月間画像では基準日
  screenings: z.array(ExtractedScreening),
  notes: z.string().nullable(), // LLM が気付いた異常（"休館日と記載" 等）
})
export type ExtractionResult = z.infer<typeof ExtractionResult>
