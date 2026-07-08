import { z } from 'zod'

// LLM 抽出の出力スキーマ（docs/06 §3）。サイト表記のまま。正規化は後段（ingest）。
export const ExtractedScreening = z.object({
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
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), // ページに明示された対象日
  screenings: z.array(ExtractedScreening),
  notes: z.string().nullable(), // LLM が気付いた異常（"休館日と記載" 等）
})
export type ExtractionResult = z.infer<typeof ExtractionResult>
