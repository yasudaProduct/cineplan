import { describe, expect, it } from 'vitest'
import { isAdminAuthorized } from '../guard'

// /admin のコード側ガード（docs/spec/11 §4）。P4-1 で Cloudflare Access がエッジ前段に入ったため、
// (a) x-admin-token 一致（curl 用 backstop）または (b) Access 通過の証跡 JWT ヘッダで通す。
// 旧 admin-auth.spec（P4-0）の fail closed 特性は維持する。

describe('isAdminAuthorized', () => {
  it('APP_ENV=local はトークン・JWT 無しでも許可する（開発の摩擦回避）', () => {
    expect(isAdminAuthorized({ APP_ENV: 'local' }, null, null)).toBe(true)
  })

  it('st: ADMIN_TOKEN 一致で許可する（curl 用 backstop）', () => {
    expect(isAdminAuthorized({ APP_ENV: 'st', ADMIN_TOKEN: 'secret' }, 'secret', null)).toBe(true)
  })

  it('st: トークン不一致は拒否する', () => {
    expect(isAdminAuthorized({ APP_ENV: 'st', ADMIN_TOKEN: 'secret' }, 'wrong', null)).toBe(false)
  })

  it('st: Access 通過の証跡（Cf-Access-Jwt-Assertion）があれば許可する', () => {
    expect(isAdminAuthorized({ APP_ENV: 'st', ADMIN_TOKEN: 'secret' }, null, 'eyJhbGci...')).toBe(
      true,
    )
  })

  it('st: ADMIN_TOKEN 未設定でも JWT ヘッダが無ければ拒否する（fail closed。P4-0 の特性維持）', () => {
    expect(isAdminAuthorized({ APP_ENV: 'st' }, 'anything', null)).toBe(false)
    expect(isAdminAuthorized({ APP_ENV: 'st' }, null, null)).toBe(false)
  })

  it('prod も同じ規則', () => {
    expect(isAdminAuthorized({ APP_ENV: 'prod' }, null, null)).toBe(false)
    expect(isAdminAuthorized({ APP_ENV: 'prod' }, null, 'jwt')).toBe(true)
  })
})
