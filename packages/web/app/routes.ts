import { index, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'), // LP（P3 は簡易版・本実装は P5-3）
  route('plan', 'routes/plan.tsx'), // プラン作成・結果一覧（07 §1.3-1.4）
  route('p/:planId', 'routes/share.tsx'), // 共有ページ（P5-2・07 §1.5）
  route('p/:planId/og.png', 'routes/share-og.ts'), // OGP 動的画像（P5-2）
] satisfies RouteConfig
