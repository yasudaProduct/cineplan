import { logError } from '../log'

// Slack 通知（docs/06 §7・N-07）。取込失敗・検証NG・コスト急増を当日中に通知する。
// local は slack-stub（SLACK_WEBHOOK_URL=http://localhost:1081/webhook）に向ける。
// 通知失敗は本処理を止めない（throw しない）が、slack.fail として Workers Logs に残す
// （Webhook 失効等で通知が黙って消えていた事象を検知できるように）。
export async function sendSlack(webhookUrl: string | undefined, text: string): Promise<void> {
  if (!webhookUrl) return
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    if (!res.ok) {
      logError('slack.fail', new Error(`HTTP ${res.status}`), { status: res.status })
    }
  } catch (e) {
    logError('slack.fail', e)
  }
}
