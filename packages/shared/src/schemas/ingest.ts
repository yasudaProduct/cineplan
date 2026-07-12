import { z } from 'zod'
import { FetchMethod, RobotsStatus, TheaterStatus } from './theater'

// 抽出方式（ADR-0012）。text=HTML→テキスト / vision=画像→マルチモーダル
export const ExtractMethod = z.enum(['text', 'vision'])
export type ExtractMethod = z.infer<typeof ExtractMethod>

// 取込トリガー・ステータス（docs/02 用語集の正規定義）
export const IngestTrigger = z.enum(['cron', 'manual', 'retry'])
export type IngestTrigger = z.infer<typeof IngestTrigger>

export const IngestRunStatus = z.enum([
  'queued',
  'fetching',
  'extracting',
  'succeeded',
  'validation_failed',
  'fetch_failed',
  'extraction_failed',
])
export type IngestRunStatus = z.infer<typeof IngestRunStatus>

export const ReviewStatus = z.enum(['pending', 'approved', 'rejected'])
export type ReviewStatus = z.infer<typeof ReviewStatus>

// 妥当性検証 NG コード（docs/06 §5 の V1〜V6）
export const ValidationCode = z.enum([
  'EMPTY_WITHOUT_REASON',
  'COUNT_ANOMALY',
  'TIME_OUT_OF_RANGE',
  'NEGATIVE_DURATION',
  'DUPLICATE_ROW',
  'DIRTY_TITLE',
])
export type ValidationCode = z.infer<typeof ValidationCode>

// 劇場マスタの読取レコード（ingest/admin 用・camelCase）。D1 snake_case からマッピングして得る。
export const TheaterRecord = z.object({
  id: z.string(),
  name: z.string(),
  shortName: z.string().nullable(),
  status: TheaterStatus,
  lat: z.number(),
  lng: z.number(),
  nearestStation: z.string(),
  walkMinFromSta: z.number().int(),
  scheduleUrl: z.string(),
  fetchMethod: FetchMethod,
  extractMethod: ExtractMethod,
  officialUrl: z.string(),
  termsNote: z.string().nullable(),
  termsCheckedAt: z.string().nullable(),
  robotsStatus: RobotsStatus,
})
export type TheaterRecord = z.infer<typeof TheaterRecord>

// 劇場マスタの作成/更新フォーム入力（管理サイト P4-3。docs/07 §2.3）。
// status は含めない: 新規は必ず paused（docs/06 §9 受入手順）、変更は専用アクションで
// 昇格ゲート（robots/terms。docs/08 §0 ルール5）を通す。
export const TheaterUpsert = z.object({
  name: z.string().trim().min(1),
  shortName: z.string().trim().min(1).nullish(),
  lat: z.coerce.number().gte(-90).lte(90),
  lng: z.coerce.number().gte(-180).lte(180),
  nearestStation: z.string().trim().min(1),
  walkMinFromSta: z.coerce.number().int().min(0).max(120),
  scheduleUrl: z.string().url(),
  fetchMethod: FetchMethod,
  extractMethod: ExtractMethod,
  officialUrl: z.string().url(),
  termsNote: z.string().trim().min(1).nullish(),
  termsCheckedAt: z.string().datetime().nullish(),
  robotsStatus: RobotsStatus,
})
export type TheaterUpsert = z.infer<typeof TheaterUpsert>

// 正規化済み screening（movie_id 解決・UTC 化済み）。D1 洗い替え書込の入力（docs/11 §4.1）。
export const NormalizedScreening = z.object({
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  movieId: z.string(),
  startAt: z.string().datetime(),
  endAt: z.string().datetime(),
  endAtSource: z.enum(['site', 'estimated']),
  format: z.string().nullable(),
  screenName: z.string(), // 単一館は ''。多スクリーン一意性用（migration 0003）
  detailUrl: z.string().nullable(),
})
export type NormalizedScreening = z.infer<typeof NormalizedScreening>
