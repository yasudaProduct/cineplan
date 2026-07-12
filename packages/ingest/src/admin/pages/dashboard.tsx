import type { DashboardData } from '../../db/admin-queries'
import { sparkline } from '../components'

// ダッシュボード（docs/07 §2.2）: 本日の取込状況・データ鮮度(N-02)・レビュー待ち・
// LLM コスト(直近7日)・規約確認期限(F-24/90日) の5ウィジェット。
export function DashboardPage({ d }: { d: DashboardData }) {
  const freshPct =
    d.freshness.total === 0 ? null : Math.round((d.freshness.ready / d.freshness.total) * 100)
  const weekTokens = d.tokenDaily.reduce((a, r) => a + r.tokens, 0)
  return (
    <>
      <h1>ダッシュボード</h1>
      <div class="cards">
        <div class="card">
          <div class="k">本日の取込状況（active {d.activeTheaterCount} 劇場）</div>
          <div class="v">
            ✅ {d.todayRuns.succeeded}{' '}
            <span class={d.todayRuns.failed > 0 ? 'warn-text' : ''}>🛑 {d.todayRuns.failed}</span>{' '}
            ⏳ {d.todayRuns.running}
          </div>
        </div>
        <div class="card">
          <div class="k">データ鮮度: 明日分の取込完了率（N-02）</div>
          <div class="v">
            {freshPct === null ? '—' : `${freshPct}%`}{' '}
            <span class="small">
              （{d.freshness.ready}/{d.freshness.total} 劇場）
            </span>
          </div>
        </div>
        <div class="card">
          <div class="k">レビュー待ち</div>
          <div class="v">
            {d.pendingReviews > 0 ? (
              <a href="/admin/reviews">
                <span class="chip warn">{d.pendingReviews} 件</span>
              </a>
            ) : (
              '0 件'
            )}
          </div>
        </div>
        <div class="card">
          <div class="k">LLM トークン（直近7日合計 {weekTokens.toLocaleString()}）</div>
          <div class="v spark" title={d.tokenDaily.map((r) => `${r.day}: ${r.tokens}`).join('\n')}>
            {sparkline(d.tokenDaily.map((r) => r.tokens))}
          </div>
          <div class="small">
            {d.tokenDaily[0]?.day} 〜 {d.tokenDaily[d.tokenDaily.length - 1]?.day}（JST日次）
          </div>
        </div>
      </div>

      <h2>規約確認期限（90日超・未確認。docs/08 §2）</h2>
      {d.termsWarning.length === 0 ? (
        <p class="small">警告対象はありません。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>劇場</th>
              <th>terms_checked_at</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {d.termsWarning.map((t) => (
              <tr>
                <td>{t.name}</td>
                <td class="warn-text">{t.terms_checked_at ?? '未確認'}</td>
                <td>
                  <a href={`/admin/theaters/${t.id}`}>再確認して更新 →</a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
