// 恒久的な失敗（リトライしても直らない）を示すエラー群。
// queue consumer / 手動取込エンドポイントはこれらを catch して ack（リトライしない）・
// 適切な HTTP ステータスで応答する。

export class TheaterNotFoundError extends Error {
  constructor(theaterId: string) {
    super(`theater not found: ${theaterId}`)
    this.name = 'TheaterNotFoundError'
  }
}

// robots/規約確認未完了、または cron 消費時点で status が active でなくなっている場合
// （停止依頼等）。docs/spec/08 §0・§2 の多層防御。
export class ComplianceGateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ComplianceGateError'
  }
}
