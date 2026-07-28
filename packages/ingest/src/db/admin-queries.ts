// ダッシュボード集計（P4-2。docs/07 §2.2）。読取専用。

export interface DashboardData {
  activeTheaterCount: number
  todayRuns: { succeeded: number; failed: number; running: number }
  freshness: { ready: number; total: number } // active 劇場のうち明日分 screenings がある数（N-02）
  pendingReviews: number
  tokenDaily: { day: string; tokens: number }[] // JST 日次・直近7日（in+out 合算）
  todayInTokens: number // JST 本日の in-tokens 合計（コスト急増アラートの閾値対比。P5-6・docs/06 §8）
  termsWarning: { id: string; name: string; terms_checked_at: string | null }[] // 90日超 or 未確認（F-24）
}

// JST の今日 'YYYY-MM-DD'
export function todayJst(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3600_000).toISOString().slice(0, 10)
}

export function addDays(dateIso: string, days: number): string {
  const t = Date.parse(`${dateIso}T00:00:00Z`) + days * 86_400_000
  return new Date(t).toISOString().slice(0, 10)
}

// JST の日付の 00:00 を UTC ISO で（started_at との文字列比較用）
export function jstDayStartIso(dateIso: string): string {
  return new Date(Date.parse(`${dateIso}T00:00:00+09:00`)).toISOString()
}

const RUNNING = `('queued','fetching','extracting')`

export async function loadDashboard(
  db: D1Database,
  now: Date = new Date(),
): Promise<DashboardData> {
  const today = todayJst(now)
  const tomorrow = addDays(today, 1)
  const todayStart = jstDayStartIso(today)
  const weekStart = jstDayStartIso(addDays(today, -6))

  const active = await db
    .prepare(`SELECT COUNT(*) AS c FROM theaters WHERE status='active'`)
    .first<{ c: number }>()

  const todayAgg = await db
    .prepare(
      `SELECT
         SUM(CASE WHEN status='succeeded' THEN 1 ELSE 0 END) AS ok,
         SUM(CASE WHEN status LIKE '%_failed' THEN 1 ELSE 0 END) AS ng,
         SUM(CASE WHEN status IN ${RUNNING} THEN 1 ELSE 0 END) AS run
       FROM ingest_runs WHERE started_at >= ?`,
    )
    .bind(todayStart)
    .first<{ ok: number | null; ng: number | null; run: number | null }>()

  const fresh = await db
    .prepare(
      `SELECT COUNT(DISTINCT t.id) AS c FROM theaters t
         JOIN screenings s ON s.theater_id = t.id AND s.business_date = ?
        WHERE t.status='active'`,
    )
    .bind(tomorrow)
    .first<{ c: number }>()

  const pending = await db
    .prepare(`SELECT COUNT(*) AS c FROM extraction_reviews WHERE status='pending'`)
    .first<{ c: number }>()

  const { results: tokenRows } = await db
    .prepare(
      `SELECT date(started_at, '+9 hours') AS day,
              SUM(COALESCE(llm_in_tokens,0) + COALESCE(llm_out_tokens,0)) AS tokens
         FROM ingest_runs WHERE started_at >= ?
        GROUP BY day ORDER BY day`,
    )
    .bind(weekStart)
    .all<{ day: string; tokens: number }>()

  // 本日の in-tokens（アラート閾値との対比表示用。閾値判定は worker/cost-alert.ts と同基準）
  const todayIn = await db
    .prepare(
      `SELECT SUM(COALESCE(llm_in_tokens,0)) AS t FROM ingest_runs
        WHERE datetime(started_at) >= datetime(?)`,
    )
    .bind(jstDayStartIso(today))
    .first<{ t: number | null }>()

  // terms_checked_at が 90日超 or 未確認（docs/08 §2）。retired は対象外。
  const cutoffIso = new Date(now.getTime() - 90 * 86_400_000).toISOString()
  const { results: termsRows } = await db
    .prepare(
      `SELECT id, name, terms_checked_at FROM theaters
        WHERE status != 'retired' AND (terms_checked_at IS NULL OR terms_checked_at < ?)
        ORDER BY terms_checked_at`,
    )
    .bind(cutoffIso)
    .all<{ id: string; name: string; terms_checked_at: string | null }>()

  // 直近7日を欠損日 0 で埋める（スパークライン用）
  const byDay = new Map(tokenRows.map((r) => [r.day, r.tokens]))
  const tokenDaily: { day: string; tokens: number }[] = []
  for (let i = 6; i >= 0; i--) {
    const d = addDays(today, -i)
    tokenDaily.push({ day: d, tokens: byDay.get(d) ?? 0 })
  }

  return {
    activeTheaterCount: active?.c ?? 0,
    todayRuns: {
      succeeded: todayAgg?.ok ?? 0,
      failed: todayAgg?.ng ?? 0,
      running: todayAgg?.run ?? 0,
    },
    freshness: { ready: fresh?.c ?? 0, total: active?.c ?? 0 },
    pendingReviews: pending?.c ?? 0,
    tokenDaily,
    todayInTokens: todayIn?.t ?? 0,
    termsWarning: termsRows,
  }
}
