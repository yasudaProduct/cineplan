import type { ScreeningLeg } from '@cinema/shared'
import { data, isRouteErrorResponse, Link } from 'react-router'
import { PlanTimeline } from '../components/PlanTimeline'
import { fetchSharedPlan, sharedPlanIcsUrl } from '../lib/api'
import { jstDateValue, shareDescription, shareTitle, summarizePlan } from '../lib/plan-summary'
import type { Route } from './+types/share'

// 共有ページ /p/{planId}（P5-2・F-12/F-13・docs/spec/07 §1.5）。
// 結果詳細の読み取り専用版。スナップショットをそのまま表示し再計算しない（F-13）。
// OGP のため SSR 必須（ADR-0013・react-router.config.ts の ssr:true）。

export async function loader({ params, request }: Route.LoaderArgs) {
  const r = await fetchSharedPlan(params.planId)
  if (!r.ok) {
    // 期限切れ・不存在は 404（API と同じ区別をしない。docs/spec/04 設計メモ9）。
    // API 到達不能等は 502（ErrorBoundary で汎用エラー表示）。
    throw data({ code: r.code }, { status: r.status === 404 ? 404 : 502 })
  }
  const plan = r.data
  const summary = summarizePlan(plan)
  const first = plan.legs.find((l): l is ScreeningLeg => l.kind === 'screening')
  return {
    plan,
    summary,
    planId: params.planId,
    // og:image はクローラ向けに絶対 URL が必要
    ogImageUrl: `${new URL(request.url).origin}/p/${params.planId}/og.png`,
    presetDate: first ? jstDateValue(first.startAt) : null,
  }
}

export function meta({ loaderData: d }: Route.MetaArgs) {
  if (!d) return [{ title: '共有プラン — cineplan' }]
  const title = shareTitle(d.summary)
  const description = shareDescription(d.summary)
  return [
    { title },
    { name: 'description', content: description },
    { property: 'og:type', content: 'website' },
    { property: 'og:title', content: title },
    { property: 'og:description', content: description },
    { property: 'og:image', content: d.ogImageUrl },
    { property: 'og:image:width', content: '1200' },
    { property: 'og:image:height', content: '630' },
    { name: 'twitter:card', content: 'summary_large_image' },
  ]
}

export default function SharePage({ loaderData }: Route.ComponentProps) {
  const { plan, summary, planId, presetDate } = loaderData
  return (
    <main className="container mx-auto max-w-2xl p-4">
      <header className="py-4">
        <p className="text-sm text-neutral-500">{summary.dateLabel}の映画はしごプラン</p>
        <h1 className="text-2xl font-bold">
          🎬 {summary.movieCount}本はしご
          {summary.theaterCount > 1 ? `（${summary.theaterCount}館）` : ''}
        </h1>
      </header>

      <div className="rounded-lg border border-neutral-300 bg-white p-4">
        <PlanTimeline plan={plan} />
        <div className="mt-3">
          {/* .ics はサーバ生成（P5-1 の GET /v1/plans/{id}/ics） */}
          <a
            href={sharedPlanIcsUrl(planId)}
            className="inline-block rounded-md border border-neutral-300 px-4 py-2 text-sm hover:bg-neutral-50"
          >
            ⬇ .ics 保存（カレンダー一括登録）
          </a>
        </div>
      </div>

      {/* 組み直し CTA（日付プリセットのみ。検索条件はスナップショットに含まれない。07 §1.5） */}
      <div className="mt-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-center">
        <p className="text-sm text-neutral-700">この日に映画をはしごしたくなったら</p>
        <Link
          to={presetDate ? `/plan?date=${presetDate}` : '/plan'}
          className="mt-2 inline-block rounded-md bg-amber-500 px-6 py-2 font-semibold text-white hover:bg-amber-600"
        >
          自分でもプランを作る →
        </Link>
      </div>
    </main>
  )
}

// 期限切れ・不存在の 404（07 §1.5:「新しくプランを作る」導線）
export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const is404 = isRouteErrorResponse(error) && error.status === 404
  return (
    <main className="container mx-auto max-w-2xl p-4 pt-16 text-center">
      <h1 className="text-2xl font-bold">
        {is404 ? 'このプランは見つかりません' : 'エラーが発生しました'}
      </h1>
      <p className="mt-2 text-neutral-600">
        {is404
          ? '共有URLの有効期限（30日）が切れたか、URLが正しくありません。'
          : '時間をおいて再度お試しください。'}
      </p>
      <Link
        to="/plan"
        className="mt-6 inline-block rounded-md bg-amber-500 px-6 py-2 font-semibold text-white hover:bg-amber-600"
      >
        新しくプランを作る →
      </Link>
    </main>
  )
}
