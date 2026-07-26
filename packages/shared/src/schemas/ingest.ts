import { z } from 'zod'
import { FetchDayMode, FetchMethod, MAX_FETCH_DAYS, RobotsStatus, TheaterStatus } from './theater'

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

// 妥当性検証 NG コード（docs/06 §5 の V1〜V7）
export const ValidationCode = z.enum([
  'EMPTY_WITHOUT_REASON',
  'COUNT_ANOMALY',
  'TIME_OUT_OF_RANGE',
  'NEGATIVE_DURATION',
  'DUPLICATE_ROW',
  'DIRTY_TITLE',
  // V7: 同一スクリーンで上映時間帯が重複（月間グリッドの日付潰れ等。ADR-0020）
  'SCREEN_TIME_OVERLAP',
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
  // 複数日取得（ADR-0019）。既定は single / 1（現行動作）
  fetchDayMode: FetchDayMode,
  fetchDays: z.number().int().min(0).max(MAX_FETCH_DAYS),
  officialUrl: z.string(),
  termsNote: z.string().nullable(),
  termsCheckedAt: z.string().nullable(),
  robotsStatus: RobotsStatus,
})
export type TheaterRecord = z.infer<typeof TheaterRecord>

// 劇場マスタの作成/更新フォーム入力（管理サイト P4-3。docs/07 §2.3）。
// status は含めない: 新規は必ず paused（docs/06 §9 受入手順）、変更は専用アクションで
// 昇格ゲート（robots/terms。docs/08 §0 ルール5）を通す。
export const TheaterUpsert = z
  .object({
    name: z.string().trim().min(1),
    shortName: z.string().trim().min(1).nullish(),
    lat: z.coerce.number().gte(-90).lte(90),
    lng: z.coerce.number().gte(-180).lte(180),
    nearestStation: z.string().trim().min(1),
    walkMinFromSta: z.coerce.number().int().min(0).max(120),
    scheduleUrl: z.string().url(),
    fetchMethod: FetchMethod,
    extractMethod: ExtractMethod,
    fetchDayMode: FetchDayMode,
    fetchDays: z.coerce.number().int().min(0).max(MAX_FETCH_DAYS),
    officialUrl: z.string().url(),
    termsNote: z.string().trim().min(1).nullish(),
    termsCheckedAt: z.string().datetime().nullish(),
    robotsStatus: RobotsStatus,
  })
  // 複数日取得（ADR-0019）の組合せ検証。手書き設定でも矛盾した状態を作らせない。
  .superRefine((v, ctx) => {
    const hasTemplate = v.scheduleUrl.includes('{date}')
    if (v.fetchDayMode === 'url_template' && !hasTemplate) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduleUrl'],
        message: 'fetchDayMode=url_template のとき scheduleUrl に {date} が必要です',
      })
    }
    if (v.fetchDayMode !== 'url_template' && hasTemplate) {
      ctx.addIssue({
        code: 'custom',
        path: ['scheduleUrl'],
        message: '{date} を含む URL は fetchDayMode=url_template のときのみ使えます',
      })
    }
    if (v.fetchDayMode === 'tabs' && v.fetchMethod !== 'rendered') {
      ctx.addIssue({
        code: 'custom',
        path: ['fetchDayMode'],
        message: 'fetchDayMode=tabs は fetchMethod=rendered が必要です（タブ操作にブラウザが要る）',
      })
    }
    if (v.fetchDayMode === 'url_template' && v.fetchMethod !== 'static') {
      ctx.addIssue({
        code: 'custom',
        path: ['fetchDayMode'],
        message: 'fetchDayMode=url_template は fetchMethod=static のみ対応です（ADR-0019）',
      })
    }
    if (v.fetchDayMode !== 'single' && v.extractMethod !== 'text') {
      ctx.addIssue({
        code: 'custom',
        path: ['fetchDayMode'],
        message: '複数日取得は extractMethod=text のみ対応です（vision は月間画像に複数日を含む）',
      })
    }
    if (v.fetchDayMode === 'url_template' && v.fetchDays < 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['fetchDays'],
        message: 'url_template では fetchDays に1以上が必要です（0=タブ全件は tabs 専用）',
      })
    }
    if (v.fetchDayMode === 'single' && v.fetchDays !== 1) {
      ctx.addIssue({
        code: 'custom',
        path: ['fetchDays'],
        message: 'fetchDayMode=single のとき fetchDays は 1 です',
      })
    }
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
