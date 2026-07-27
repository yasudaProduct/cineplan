import { LegalPage, LegalSection } from '../components/LegalPage'
import { CONTACT_EMAIL, SERVICE_NAME } from '../lib/site'
import type { Route } from './+types/privacy'

// プライバシーポリシー（P5-4・07 §1.6・docs/08 §4）。
// ドラフト: 文面の最終確認はオーナー作業（docs/16 §5.4）。
// 「個人情報を保持しない」の記載は実装と一致させること（16 §5.4 の確認観点）:
// - 会員登録なし / D1 に利用者情報なし（shared_plans はプラン内容のみ）
// - フォーム入力は localStorage（端末内）のみ
// - 現在地は座標を /v1/plan のリクエストに使うのみで保存しない

export function meta(_args: Route.MetaArgs) {
  return [{ title: `プライバシーポリシー — ${SERVICE_NAME}` }]
}

export default function Privacy() {
  return (
    <LegalPage title="プライバシーポリシー">
      <p>
        {SERVICE_NAME}
        （以下「本サービス」）は、利用者のプライバシーを尊重します。本ポリシーは、本サービスが扱う情報とその取り扱いを説明するものです。
      </p>

      <LegalSection title="1. 個人情報の取得・保存について">
        <p>
          本サービスは会員登録を必要とせず、
          <strong>氏名・メールアドレス等の個人情報を取得・保存しません</strong>。
        </p>
      </LegalSection>

      <LegalSection title="2. 端末内に保存される情報">
        <p>
          プラン作成フォームの入力値（日付・時間帯・駅名等）は、再訪時の復元のためにブラウザの
          localStorage（利用者の端末内）にのみ保存されます。サーバには送信されません（プラン算出リクエストを除く）。ブラウザの設定からいつでも削除できます。
        </p>
        <p>本サービスは独自の Cookie を使用しません。</p>
      </LegalSection>

      <LegalSection title="3. 現在地情報">
        <p>
          「現在地から探す」を利用した場合、端末の位置情報（緯度・経度）をプラン算出のリクエストに使用します。位置情報は算出にのみ使用し、
          <strong>サーバに保存しません</strong>。位置情報の利用はブラウザの許可操作に基づきます。
        </p>
      </LegalSection>

      <LegalSection title="4. 共有プラン">
        <p>
          「共有URLを発行」を利用した場合、そのプランの内容（劇場名・作品名・時刻）がサーバに保存され、URL
          を知る人が閲覧できます。共有プランに利用者の個人情報は含まれません。保存期間は発行から30日で、期限後は削除されます。
        </p>
      </LegalSection>

      <LegalSection title="5. アクセスログ">
        <p>
          本サービスは Cloudflare
          のインフラ上で動作しており、安定運用・不正アクセス対策のため、アクセスログ（IP
          アドレス・リクエスト内容等）が一時的に記録されることがあります。これらは運用目的にのみ使用します。
        </p>
      </LegalSection>

      <LegalSection title="6. 第三者提供">
        <p>
          本サービスは、利用者に関する情報を第三者に販売・提供しません。上映スケジュールの抽出処理では劇場が公開しているページの内容を外部の
          AI サービスに送信しますが、これは劇場の公開情報であり、利用者の情報は含まれません。
        </p>
      </LegalSection>

      <LegalSection title="7. お問い合わせ">
        {CONTACT_EMAIL ? (
          <p>
            本ポリシーに関するお問い合わせ:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-700 underline">
              {CONTACT_EMAIL}
            </a>
          </p>
        ) : (
          <p>お問い合わせ窓口は準備中です。</p>
        )}
      </LegalSection>

      <p className="text-xs text-neutral-400">制定日: 2026-07-27</p>
    </LegalPage>
  )
}
