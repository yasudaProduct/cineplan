import { index, type RouteConfig, route } from '@react-router/dev/routes'

export default [
  index('routes/home.tsx'), // LP（P3 は簡易版・本実装は P5-3）
  route('plan', 'routes/plan.tsx'), // プラン作成・結果一覧（07 §1.3-1.4）
  // route('p/:planId', 'routes/p.$planId.tsx') は P5-2（共有ページ）
] satisfies RouteConfig
