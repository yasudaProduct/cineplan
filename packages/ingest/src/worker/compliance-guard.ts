import type { IngestTrigger, TheaterRecord } from '@cinema/shared'
import { ComplianceGateError } from './errors'

// 多層防御（docs/08 §0・§2）。人間の運用（採用プロセス）が一次防御だが、
// fetch 実行直前にもコード側で robots/規約確認済みを検証する。
// cron 実行時は Queue 投入〜消費の間の停止依頼等（status 変更）も再確認する。
export function assertComplianceGate(theater: TheaterRecord, trigger: IngestTrigger): void {
  if (theater.robotsStatus !== 'allowed' || !theater.termsCheckedAt) {
    throw new ComplianceGateError(
      `theater ${theater.id} は robots/規約確認が未完了のため取込できません` +
        `（robotsStatus=${theater.robotsStatus}, termsCheckedAt=${theater.termsCheckedAt}）。docs/08 §0・§2`,
    )
  }
  if (trigger === 'cron' && theater.status !== 'active') {
    throw new ComplianceGateError(
      `theater ${theater.id} は消費時点で status=${theater.status}（cron 投入後に変更された可能性）`,
    )
  }
}
