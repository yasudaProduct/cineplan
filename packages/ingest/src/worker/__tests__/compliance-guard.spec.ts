import type { TheaterRecord } from '@cinema/shared'
import { describe, expect, it } from 'vitest'
import { assertComplianceGate } from '../compliance-guard'
import { ComplianceGateError } from '../errors'

// review指摘#4の回帰テスト: cron 対象・手動取込ともに robots/規約確認済みを要求する。

const baseTheater: TheaterRecord = {
  id: 'thr_test',
  name: 'テスト劇場',
  shortName: null,
  status: 'active',
  lat: 34.7,
  lng: 135.5,
  nearestStation: '大阪',
  walkMinFromSta: 5,
  scheduleUrl: 'http://example.com/schedule',
  fetchMethod: 'static',
  extractMethod: 'vision',
  fetchDayMode: 'single',
  fetchDays: 1,
  officialUrl: 'http://example.com/',
  termsNote: null,
  termsCheckedAt: '2026-07-10T00:00:00Z',
  robotsStatus: 'allowed',
}

describe('assertComplianceGate', () => {
  it('robots/terms 確認済み・status=active の cron 実行は通過する', () => {
    expect(() => assertComplianceGate(baseTheater, 'cron')).not.toThrow()
  })

  it('robots/terms 確認済みの paused 劇場でも手動取込(manual)は通過する（採用プロセス中の受入対象）', () => {
    expect(() => assertComplianceGate({ ...baseTheater, status: 'paused' }, 'manual')).not.toThrow()
  })

  it('robotsStatus=unknown は cron・manual とも拒否する', () => {
    const t = { ...baseTheater, robotsStatus: 'unknown' as const }
    expect(() => assertComplianceGate(t, 'cron')).toThrow(ComplianceGateError)
    expect(() => assertComplianceGate(t, 'manual')).toThrow(ComplianceGateError)
  })

  it('robotsStatus=disallowed は拒否する', () => {
    const t = { ...baseTheater, robotsStatus: 'disallowed' as const }
    expect(() => assertComplianceGate(t, 'cron')).toThrow(ComplianceGateError)
  })

  it('termsCheckedAt が null は拒否する', () => {
    const t = { ...baseTheater, termsCheckedAt: null }
    expect(() => assertComplianceGate(t, 'cron')).toThrow(ComplianceGateError)
  })

  it('cron 実行時、status が active でなくなっていれば拒否する（停止依頼等のレース対策）', () => {
    const t = { ...baseTheater, status: 'paused' as const }
    expect(() => assertComplianceGate(t, 'cron')).toThrow(ComplianceGateError)
  })

  it('retired でも cron は拒否する', () => {
    const t = { ...baseTheater, status: 'retired' as const }
    expect(() => assertComplianceGate(t, 'cron')).toThrow(ComplianceGateError)
  })
})
