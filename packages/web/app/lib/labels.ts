import type { InfeasibleReason, PlanLabel } from '@cinema/shared'

export const planLabelText: Record<PlanLabel, string> = {
  most_movies: '最多鑑賞',
  less_travel: '移動少なめ',
  relaxed: '余裕あり',
  must_priority: 'マスト優先',
  alt: '別案',
}

export const infeasibleReasonText: Record<InfeasibleReason, string> = {
  no_screenings: 'この日の上映はありません。',
  must_movie_unreachable: 'マスト指定の作品を組み込めるルートが見つかりませんでした。',
  time_window_too_narrow: '指定の時間帯では1本も観られませんでした。',
}
