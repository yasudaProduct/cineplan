import type { Env } from './env'

// POST /admin/ingest の保護判定（docs/09 P4-0・docs/16 §3.6）。
// local はスキップ（開発の摩擦を避ける）。local 以外は ADMIN_TOKEN が必須で、
// 未設定なら常に拒否（fail closed）— 「秘密を入れ忘れたら開いてしまう」を避ける。
export function isAdminAuthorized(
  env: Pick<Env, 'APP_ENV' | 'ADMIN_TOKEN'>,
  token: string | null,
): boolean {
  if (env.APP_ENV === 'local') return true
  if (!env.ADMIN_TOKEN) return false
  return token === env.ADMIN_TOKEN
}
