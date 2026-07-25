import { ExtractedDateList, type ExtractionResult } from '@cinema/shared'
import {
  buildTextV1SystemPrompt,
  buildTextV1UserText,
  TEXT_V1_VERSION,
} from '../extraction/prompts/text_v1'
import {
  buildTextV3SystemPrompt,
  buildTextV3UserTextForDates,
  buildTextV3UserTextForDay,
  TEXT_V3_VERSION,
} from '../extraction/prompts/text_v3'
import { buildVisionV1SystemPrompt, VISION_V1_VERSION } from '../extraction/prompts/vision_v1'
import type { ExtractInput, ImagePart, LlmEnv } from '../llm'
import { createLlmClient, stripJsonFence } from '../llm'
import { errorFields, logError, logInfo } from '../log'
import { parseExtraction } from './validate'

export class ExtractionParseError extends Error {
  constructor(
    message: string,
    readonly raw: string,
  ) {
    super(message)
    this.name = 'ExtractionParseError'
  }
}

export interface ExtractOutcome {
  parsed: unknown // JSON.parse 結果（未検証。zod 検証は validate 段）
  raw: string
  model: string
  promptVersion: string
  inTokens: number | null
  outTokens: number | null
}

// LLM 呼出1回 + JSON パース（方式共通の下回り）
async function extractOnce(
  env: LlmEnv,
  input: ExtractInput,
  promptVersion: string,
): Promise<ExtractOutcome> {
  const client = createLlmClient(env)
  const result = await client.extract(input)
  let parsed: unknown
  try {
    parsed = JSON.parse(stripJsonFence(result.raw))
  } catch (e) {
    throw new ExtractionParseError(`JSON パース不能: ${(e as Error).message}`, result.raw)
  }
  return {
    parsed,
    raw: result.raw,
    model: result.model,
    promptVersion,
    inTokens: result.inTokens,
    outTokens: result.outTokens,
  }
}

// vision 抽出（P1-3）。businessMonth は 'YYYY-MM'（画像の日付補完用）。
export async function extractVision(
  env: LlmEnv,
  images: ImagePart[],
  businessMonth: string,
): Promise<ExtractOutcome> {
  return extractOnce(
    env,
    { systemPrompt: buildVisionV1SystemPrompt(businessMonth), images },
    VISION_V1_VERSION,
  )
}

// text 抽出（P4-7。rendered/static の HTML → htmlToText 済みテキスト）。
export async function extractText(
  env: LlmEnv,
  preprocessedText: string,
  businessMonth: string,
  scheduleUrl: string,
): Promise<ExtractOutcome> {
  return extractOnce(
    env,
    {
      systemPrompt: buildTextV1SystemPrompt(businessMonth),
      userText: buildTextV1UserText(scheduleUrl, businessMonth, preprocessedText),
    },
    TEXT_V1_VERSION,
  )
}

// docs/06 §7 のリトライ予算。LLM API エラー（client.extract 自体の失敗）と
// JSON パース不能/zod NG（LLM の出力が壊れていた場合）は別予算。
// いずれも fetch 済みの入力（メモリ上）を使い回すだけで再取得はしない。
const LLM_API_MAX_RETRIES = 2
const MALFORMED_OUTPUT_MAX_RETRIES = 1

export interface ExtractWithRetriesResult {
  ext: ExtractOutcome
  result: ExtractionResult
}

// 予算切れの最終エラーは経緯を前置して投げ直す。D1 の error_message（管理画面）だけで
// 「何をどれだけ試して失敗したか」が読めるように（feat/ingest-observability・docs/06 §7）。
function budgetExhausted(e: unknown, apiFailures: number, malformedFailures: number): Error {
  const detail = e instanceof Error ? e.message : String(e)
  return new Error(
    `抽出リトライ予算切れ（LLM呼出${apiFailures + malformedFailures}回: APIエラー${apiFailures}・出力不正${malformedFailures}）: ${detail.slice(0, 500)}`,
  )
}

// 抽出 + スキーマ検証を、docs/06 §7 のリトライ予算内でリトライしながら行う（方式共通）。
// parse は zod 検証（ExtractionResult / ExtractedDateList 等スキーマ別）。
// 予算を使い切って尚失敗した場合はその時点のエラーを throw する（呼び出し側で extraction_failed 確定）。
async function withRetries<T>(
  attempt: () => Promise<ExtractOutcome>,
  parse: (parsed: unknown) => T,
): Promise<{ ext: ExtractOutcome; result: T }> {
  let apiRetriesLeft = LLM_API_MAX_RETRIES
  let malformedRetriesLeft = MALFORMED_OUTPUT_MAX_RETRIES
  let apiFailures = 0
  let malformedFailures = 0

  for (;;) {
    let ext: ExtractOutcome
    try {
      ext = await attempt()
    } catch (e) {
      // 抽出デッドライン超過（ADR-0017）はリトライ対象外: 予算を消費せず即時打ち切り
      if (e instanceof ExtractionDeadlineError) throw e
      if (e instanceof ExtractionParseError) {
        malformedFailures++
        if (malformedRetriesLeft > 0) {
          malformedRetriesLeft--
          logInfo('llm.retry', { kind: 'parse', malformedRetriesLeft, error: errorFields(e) })
          continue
        }
        logError('llm.giveup', e, { kind: 'parse', apiFailures, malformedFailures })
        throw budgetExhausted(e, apiFailures, malformedFailures)
      }
      apiFailures++
      if (apiRetriesLeft > 0) {
        apiRetriesLeft--
        // API 呼出自体の失敗詳細（timeout/http/network・ms・status）は llm.call.fail 済み
        logInfo('llm.retry', { kind: 'api', apiRetriesLeft, error: errorFields(e) })
        continue
      }
      logError('llm.giveup', e, { kind: 'api', apiFailures, malformedFailures })
      throw budgetExhausted(e, apiFailures, malformedFailures)
    }
    try {
      const result = parse(ext.parsed)
      return { ext, result }
    } catch (zodErr) {
      malformedFailures++
      if (malformedRetriesLeft > 0) {
        malformedRetriesLeft--
        logInfo('llm.retry', { kind: 'schema', malformedRetriesLeft, error: errorFields(zodErr) })
        continue
      }
      logError('llm.giveup', zodErr, { kind: 'schema', apiFailures, malformedFailures })
      throw budgetExhausted(zodErr, apiFailures, malformedFailures)
    }
  }
}

export async function extractVisionWithRetries(
  env: LlmEnv,
  images: ImagePart[],
  businessMonth: string,
): Promise<ExtractWithRetriesResult> {
  return withRetries(() => extractVision(env, images, businessMonth), parseExtraction)
}

// text_v1（全日付一括）。本番経路は extractTextDaySplit に移行済み（ADR-0017）だが、
// プロンプト版の再現・比較用に残置。
export async function extractTextWithRetries(
  env: LlmEnv,
  preprocessedText: string,
  businessMonth: string,
  scheduleUrl: string,
): Promise<ExtractWithRetriesResult> {
  return withRetries(
    () => extractText(env, preprocessedText, businessMonth, scheduleUrl),
    parseExtraction,
  )
}

// ---- text 日単位分割（text_v2・ADR-0017・docs/06 §1/§4/§7） ----

// 発見日付の上限（幻覚・異常ページによる呼出爆発の安全弁）
export const MAX_DATES = 14
// run 内の抽出合計デッドライン。Queue consumer の実行上限（約15分/起動）の内側に収める。
// 各 LLM 呼出（リトライ試行含む）の前に判定するため、超過は最大でも呼出1回分（120秒）に留まる。
export const EXTRACTION_DEADLINE_MS = 10 * 60_000

export class ExtractionDeadlineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExtractionDeadlineError'
  }
}

// テスト用に時計を注入可能にする（Workers では Date.now のままで良い）
export interface DaySplitOptions {
  deadlineMs?: number
  now?: () => number
}

function sumTokens(xs: Array<number | null>): number | null {
  if (xs.every((x) => x == null)) return null
  return xs.reduce((acc: number, x) => acc + (x ?? 0), 0)
}

// 週間ページ等の複数日を1呼出で出力させると、出力トークン量がタイムアウト内に生成しきれない
// （実測 96〜190 tok/s。大阪ステーションシネマ ≒347件 ≒3.5万トークン）。日付発見→日別抽出に
// 分割し、1呼出の出力を1日分に抑える。結果は1つの ExtractionResult にマージして返す
// （書込・検証・トークン記録の呼び出し側契約は一括抽出と同一）。
export async function extractTextDaySplit(
  env: LlmEnv,
  preprocessedText: string,
  businessMonth: string,
  scheduleUrl: string,
  fallbackBusinessDate: string, // 取込日（pipeline）/ スナップショット日（reextract）。空結果とマージ結果の businessDate
  opts?: DaySplitOptions,
): Promise<ExtractWithRetriesResult> {
  const now = opts?.now ?? (() => Date.now())
  const deadlineMs = opts?.deadlineMs ?? EXTRACTION_DEADLINE_MS
  const startedAt = now()
  const systemPrompt = buildTextV3SystemPrompt(businessMonth)
  const notes: string[] = []
  const outcomes: ExtractOutcome[] = []
  const guarded = createDeadlineGuard(now, startedAt, deadlineMs, 'text_v3日分割')

  // 1) 日付発見コール
  const t0 = now()
  const discovery = await withCallContext(
    '日付発見',
    withRetries(
      guarded({ done: 0, total: null }, () =>
        extractOnce(
          env,
          {
            systemPrompt,
            userText: buildTextV3UserTextForDates(
              scheduleUrl,
              businessMonth,
              fallbackBusinessDate,
              preprocessedText,
            ),
            responseFormat: 'dateList',
          },
          TEXT_V3_VERSION,
        ),
      ),
      (p) => ExtractedDateList.parse(p),
    ),
  )
  outcomes.push(discovery.ext)
  if (discovery.result.notes) notes.push(discovery.result.notes)

  let dates = [...new Set(discovery.result.dates)].sort()
  logInfo('extract.dates.ok', {
    dates,
    ms: now() - t0,
    inTokens: discovery.ext.inTokens,
    outTokens: discovery.ext.outTokens,
  })
  if (dates.length > MAX_DATES) {
    logInfo('extract.dates.truncated', { found: dates.length, cap: MAX_DATES })
    notes.push(`営業日${dates.length}件中${MAX_DATES}件のみ抽出(text_v3日分割)`)
    dates = dates.slice(0, MAX_DATES)
  }
  if (dates.length === 0 && notes.length === 0) {
    notes.push('営業日をページから検出できず上映0件(text_v3日分割)')
  }

  // 2) 日別抽出コール（発見した日付ごとに1回。入力は同一テキスト・基準日は取込日のまま）
  const screenings = await extractDayUnits(
    env,
    dates.map((date) => ({ date, text: preprocessedText, url: scheduleUrl })),
    {
      systemPrompt,
      businessMonth,
      basisDateOf: () => fallbackBusinessDate,
      label: 'text_v3日分割',
    },
    { guarded, now, notes, outcomes, onDeadline: 'throw' },
  )
  return mergeDayResults(fallbackBusinessDate, screenings, notes, outcomes)
}

// 複数日取得（ADR-0019・docs/06 §2.2）の抽出。文書ごとに日付が既知のため
// **日付発見コールを行わず**、文書1つにつき日別コールを1回だけ呼ぶ。
// text_v3 の日別プロンプトに基準日として対象日そのものを渡すのがキモ:
// 「対象日 == 基準日 のとき、日付見出しの無い先頭ブロックも対象日の分として抽出」という
// 既存の規則がそのまま効き、1日分だけを載せたタブ文書が正しく抽出される（プロンプト新版は不要）。
export interface DayDocument {
  date: string // YYYY-MM-DD
  text: string // htmlToText 済み
  url: string // プロンプトの <page url=...>
}

export async function extractTextPerDocument(
  env: LlmEnv,
  docs: DayDocument[],
  businessMonth: string,
  fallbackBusinessDate: string,
  opts?: DaySplitOptions & { extraNotes?: string[] },
): Promise<ExtractWithRetriesResult> {
  const now = opts?.now ?? (() => Date.now())
  const deadlineMs = opts?.deadlineMs ?? EXTRACTION_DEADLINE_MS
  const startedAt = now()
  const systemPrompt = buildTextV3SystemPrompt(businessMonth)
  const notes: string[] = [...(opts?.extraNotes ?? [])]
  const outcomes: ExtractOutcome[] = []
  const guarded = createDeadlineGuard(now, startedAt, deadlineMs, '複数日取得')

  logInfo('extract.perdoc.start', { docs: docs.length, dates: docs.map((d) => d.date) })
  if (docs.length === 0) {
    // 取得できた日が無い（タブを全て取り逃した等）。LLM は呼ばず 0件 + notes で成功させる
    notes.push('複数日取得で有効な文書が0件のため上映0件(ADR-0019)')
    return mergeDayResults(fallbackBusinessDate, [], notes, [])
  }

  const screenings = await extractDayUnits(
    env,
    docs,
    { systemPrompt, businessMonth, basisDateOf: (date) => date, label: '複数日取得' },
    { guarded, now, notes, outcomes, onDeadline: 'stop' },
  )
  return mergeDayResults(fallbackBusinessDate, screenings, notes, outcomes)
}

// --- 日分割・複数日取得の共通下回り ---

type DeadlineGuard = (
  progress: { done: number; total: number | null },
  run: () => Promise<ExtractOutcome>,
) => () => Promise<ExtractOutcome>

// 呼出前デッドライン判定（リトライ試行ごとに評価。予算は消費しない）
function createDeadlineGuard(
  now: () => number,
  startedAt: number,
  deadlineMs: number,
  label: string,
): DeadlineGuard {
  return (progress, run) => async () => {
    const elapsedMs = now() - startedAt
    if (elapsedMs >= deadlineMs) {
      const err = new ExtractionDeadlineError(
        `抽出デッドライン超過(${label}): ${Math.round(elapsedMs / 60_000)}分経過・${progress.done}/${progress.total ?? '?'}日処理済み`,
      )
      logError('extract.deadline.exceeded', err, {
        elapsedMs,
        deadlineMs,
        doneDays: progress.done,
        totalDays: progress.total,
      })
      throw err
    }
    return run()
  }
}

// エラーにどの呼出で失敗したかを前置（D1 error_message 単体で読めるように。デッドラインは素通し）
async function withCallContext<T>(ctx: string, p: Promise<T>): Promise<T> {
  try {
    return await p
  } catch (e) {
    if (e instanceof ExtractionDeadlineError) throw e
    throw new Error(`${ctx}: ${e instanceof Error ? e.message : String(e)}`)
  }
}

// 日別コールのループ（単日分割・複数日取得で共用）。対象日外の行は除外し notes に記録する。
// onDeadline='stop' は「1日以上成功していれば打ち切って部分結果を返す」（複数日取得。ADR-0019）。
async function extractDayUnits(
  env: LlmEnv,
  units: DayDocument[],
  prompt: {
    systemPrompt: string
    businessMonth: string
    basisDateOf: (date: string) => string
    label: string
  },
  ctx: {
    guarded: DeadlineGuard
    now: () => number
    notes: string[]
    outcomes: ExtractOutcome[]
    onDeadline: 'throw' | 'stop'
  },
): Promise<ExtractionResult['screenings']> {
  const screenings: ExtractionResult['screenings'] = []
  for (const [i, unit] of units.entries()) {
    const t = ctx.now()
    let day: { ext: ExtractOutcome; result: ExtractionResult }
    try {
      day = await withCallContext(
        `日別抽出(${unit.date})`,
        withRetries(
          ctx.guarded({ done: i, total: units.length }, () =>
            extractOnce(
              env,
              {
                systemPrompt: prompt.systemPrompt,
                userText: buildTextV3UserTextForDay(
                  unit.url,
                  prompt.businessMonth,
                  prompt.basisDateOf(unit.date),
                  unit.text,
                  unit.date,
                ),
              },
              TEXT_V3_VERSION,
            ),
          ),
          parseExtraction,
        ),
      )
    } catch (e) {
      // 部分成功を許す経路のみ、1日以上取れていればそこで打ち切る（未取得日は洗い替え範囲外）
      if (e instanceof ExtractionDeadlineError && ctx.onDeadline === 'stop' && i > 0) {
        ctx.notes.push(`デッドライン到達により${i}/${units.length}日で打ち切り(${prompt.label})`)
        break
      }
      throw e
    }
    ctx.outcomes.push(day.ext)
    const kept = day.result.screenings.filter((sc) => sc.date == null || sc.date === unit.date)
    const dropped = day.result.screenings.length - kept.length
    if (dropped > 0) ctx.notes.push(`${unit.date}: 対象日外${dropped}件を除外(${prompt.label})`)
    if (day.result.notes) ctx.notes.push(`${unit.date}: ${day.result.notes}`)
    screenings.push(...kept.map((sc) => ({ ...sc, date: unit.date })))
    logInfo('extract.day.ok', {
      date: unit.date,
      screenings: kept.length,
      droppedOffDate: dropped,
      ms: ctx.now() - t,
      inTokens: day.ext.inTokens,
      outTokens: day.ext.outTokens,
    })
  }
  return screenings
}

// 全日の結果を1つの ExtractionResult にまとめ、トークンを合算する（呼出側の契約は一括抽出と同一）。
function mergeDayResults(
  fallbackBusinessDate: string,
  screenings: ExtractionResult['screenings'],
  notes: string[],
  outcomes: ExtractOutcome[],
): ExtractWithRetriesResult {
  const result: ExtractionResult = {
    businessDate: fallbackBusinessDate,
    screenings,
    notes: notes.length > 0 ? notes.join(' / ').slice(0, 1000) : null,
  }
  const ext: ExtractOutcome = {
    parsed: result,
    raw: '', // マージ結果のため単一の生出力は無い（各呼出の生出力サイズは llm.call.ok に記録済み）
    model: outcomes[outcomes.length - 1]?.model ?? '',
    promptVersion: TEXT_V3_VERSION,
    inTokens: sumTokens(outcomes.map((o) => o.inTokens)),
    outTokens: sumTokens(outcomes.map((o) => o.outTokens)),
  }
  return { ext, result }
}
