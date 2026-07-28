import type { Env } from '../env'
import { logError, logInfo } from '../log'
import { sendSlack } from './notify'

// LLM コスト急増アラート（P5-6・docs/06 §8・N-07）。
// JST 当日の in-tokens 合計が閾値（既定 500万）を超えたら Slack 警告する。
//
// 判定は run 完了ごとの「閾値跨ぎ」方式: 当日合計がこの run で初めて閾値以上になった
// ときだけ通知する。取込・再抽出は Queue の直列消費（max_concurrency=1）なので
// 競合せず、通知済みフラグ（KV 等）を持たなくても1日1回に収まる。
// 日付が変われば合計がリセットされ、自然に再武装する。

export const DEFAULT_DAILY_IN_TOKEN_ALERT = 5_000_000

export function dailyInTokenThreshold(env: Env): number {
  const n = Number(env.COST_ALERT_DAILY_IN_TOKENS)
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_IN_TOKEN_ALERT
}

// JST 当日 00:00 を UTC ISO で（started_at との比較用。ingest-runs の jstDayStartIso と同義だが
// 依存を薄く保つためここに置く）
function jstTodayStartIso(now = new Date()): string {
  const jst = new Date(now.getTime() + 9 * 3600 * 1000)
  const day = jst.toISOString().slice(0, 10)
  return new Date(`${day}T00:00:00+09:00`).toISOString()
}

// run 完了後に呼ぶ。アラートは運用補助なので、失敗しても run の成否には影響させない
// （呼び出し側で await するが throw しない）。
export async function checkDailyCostAlert(env: Env, runId: string): Promise<void> {
  try {
    const threshold = dailyInTokenThreshold(env)
    const row = await env.DB.prepare(
      `SELECT SUM(COALESCE(llm_in_tokens,0)) AS total,
              SUM(CASE WHEN id = ?1 THEN COALESCE(llm_in_tokens,0) ELSE 0 END) AS thisRun
         FROM ingest_runs
        WHERE datetime(started_at) >= datetime(?2)`,
    )
      .bind(runId, jstTodayStartIso())
      .first<{ total: number | null; thisRun: number | null }>()
    const total = row?.total ?? 0
    const before = total - (row?.thisRun ?? 0)
    if (total >= threshold && before < threshold) {
      logInfo('cost.alert', { runId, total, threshold })
      await sendSlack(
        env.SLACK_WEBHOOK_URL,
        `⚠ LLMトークン急増: 本日の in-tokens 合計が ${total.toLocaleString()} に達しました（閾値 ${threshold.toLocaleString()}・docs/06 §8）。管理サイトの取込履歴を確認してください。`,
      )
    }
  } catch (e) {
    logError('cost.alert.fail', e, { runId })
  }
}
