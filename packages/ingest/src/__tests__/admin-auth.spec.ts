import { describe, expect, it } from 'vitest'
import { isAdminAuthorized } from '../admin-auth'

// review指摘#1の回帰テスト: /admin/ingest は Access 投入前、ADMIN_TOKEN が唯一の防御。
// local はスキップ、local 以外は未設定なら fail closed（開いてしまわない）。

describe('isAdminAuthorized', () => {
  it('APP_ENV=local はトークン無しでも許可する（開発の摩擦回避）', () => {
    expect(isAdminAuthorized({ APP_ENV: 'local' }, null)).toBe(true)
  })

  it('APP_ENV=st で ADMIN_TOKEN 未設定は拒否する（fail closed。入れ忘れで開かない）', () => {
    expect(isAdminAuthorized({ APP_ENV: 'st' }, 'anything')).toBe(false)
    expect(isAdminAuthorized({ APP_ENV: 'st' }, null)).toBe(false)
  })

  it('APP_ENV=st で ADMIN_TOKEN 設定済み・トークン不一致は拒否する', () => {
    expect(isAdminAuthorized({ APP_ENV: 'st', ADMIN_TOKEN: 'secret' }, 'wrong')).toBe(false)
    expect(isAdminAuthorized({ APP_ENV: 'st', ADMIN_TOKEN: 'secret' }, null)).toBe(false)
  })

  it('APP_ENV=st で ADMIN_TOKEN 一致は許可する', () => {
    expect(isAdminAuthorized({ APP_ENV: 'st', ADMIN_TOKEN: 'secret' }, 'secret')).toBe(true)
  })
})
