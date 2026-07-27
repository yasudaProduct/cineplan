import { LegalPage, LegalSection } from '../components/LegalPage'
import { CONTACT_EMAIL, SERVICE_NAME } from '../lib/site'
import type { Route } from './+types/terms'

// 利用規約（P5-4・07 §1.6・docs/08 §5）。
// ドラフト: 文面の最終確認はオーナー作業（docs/16 §5.4）。

export function meta(_args: Route.MetaArgs) {
  return [{ title: `利用規約 — ${SERVICE_NAME}` }]
}

export default function Terms() {
  return (
    <LegalPage title="利用規約">
      <p>
        本規約は、{SERVICE_NAME}
        （以下「本サービス」）の利用条件を定めるものです。本サービスを利用することで、本規約に同意したものとみなします。
      </p>

      <LegalSection title="1. サービス内容">
        <p>
          本サービスは、複数の映画館の上映スケジュールをもとに、1日で複数の映画を鑑賞する移動計画（はしごプラン）を提案するツールです。
        </p>
        <p>
          本サービスは<strong>チケットの予約・販売を行いません</strong>
          。チケットの購入・予約は必ず各劇場の公式サイト等で行ってください。
        </p>
      </LegalSection>

      <LegalSection title="2. 上映情報について">
        <p>
          本サービスが扱う上映情報（劇場名・作品名・上映時刻等）は、各劇場が公式サイトで公開している事実情報をもとにしています。上映時間・作品は劇場の都合により変更される場合があります。
          <strong>おでかけ前に必ず各劇場の公式サイトで最新の上映情報をご確認ください。</strong>
        </p>
        <p>
          提案するプランに含まれる移動時間・経路・待ち時間は目安であり、実際の交通状況・ダイヤと異なる場合があります。
        </p>
      </LegalSection>

      <LegalSection title="3. 免責事項">
        <p>
          本サービスは現状有姿で提供され、情報の正確性・完全性・最新性を保証しません。本サービスの利用または利用不能により生じたいかなる損害（鑑賞機会の逸失、交通費、チケット代金等を含む）についても、運営者は責任を負いません。
        </p>
      </LegalSection>

      <LegalSection title="4. 禁止事項">
        <p>次の行為を禁止します。</p>
        <ul className="list-disc pl-5">
          <li>本サービスへの過度なアクセスその他、運営を妨害する行為</li>
          <li>本サービスの提案結果を、自動収集等により大量に取得・再配布する行為</li>
          <li>法令または公序良俗に違反する行為</li>
        </ul>
      </LegalSection>

      <LegalSection title="5. サービスの変更・停止">
        <p>
          運営者は、予告なく本サービスの内容の変更・提供の中断・終了を行うことがあります。共有プランの保存期間（30日）その他の機能仕様は予告なく変更されることがあります。
        </p>
      </LegalSection>

      <LegalSection title="6. 規約の変更">
        <p>
          本規約は必要に応じて変更されることがあります。変更後の規約は本ページに掲示した時点で効力を生じます。
        </p>
      </LegalSection>

      <LegalSection title="7. お問い合わせ">
        {CONTACT_EMAIL ? (
          <p>
            本サービスに関するお問い合わせ:{' '}
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
