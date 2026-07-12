import type { Context, Next } from 'hono'
import type { Env } from '../env'

// /admin 配下のコード側ガード（docs/14 §4・docs/16 §3.6/§4.1）。
// - local: スキップ（開発の摩擦回避）
// - それ以外: 一次防御はエッジの Cloudflare Access（P4-1。未認証は 302 でここまで届かない）。
//   コード側は (a) x-admin-token 一致（curl 用の backstop）または
//   (b) Access 通過の証跡 Cf-Access-Jwt-Assertion ヘッダの存在 で通す。
//   (b) は署名・aud 未検証の tripwire（Access が前段に居る前提。強化は P5 で検討）。
//   どちらも無ければ 401（ADMIN_TOKEN 未設定でも Access ヘッダが無ければ閉じる = fail closed）。
export function isAdminAuthorized(
  env: Pick<Env, 'APP_ENV' | 'ADMIN_TOKEN'>,
  token: string | null,
  accessJwt: string | null,
): boolean {
  if (env.APP_ENV === 'local') return true
  if (env.ADMIN_TOKEN && token === env.ADMIN_TOKEN) return true
  if (accessJwt) return true
  return false
}

export async function adminGuard(
  c: Context<{ Bindings: Env }>,
  next: Next,
): Promise<Response | undefined> {
  const ok = isAdminAuthorized(
    c.env,
    c.req.header('x-admin-token') ?? null,
    c.req.header('cf-access-jwt-assertion') ?? null,
  )
  if (!ok) return c.text('unauthorized', 401)
  await next()
  return undefined
}
