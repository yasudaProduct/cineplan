import { LegalPage, LegalSection } from '../components/LegalPage'
import { BOT_USER_AGENT, CONTACT_EMAIL, SERVICE_NAME } from '../lib/site'
import type { Route } from './+types/bot'

// bot 説明ページ（P5-4・docs/08 §3「bot 説明ページ」）。
// 目的・アクセス方針・停止依頼方法を掲載する。内容は docs/08 §3 の実装事実と一致させる:
// - 1劇場1日1セッション（1セッション最大10ページ・ページ間5秒以上・直列）
// - 同一ホスト5秒間隔 / 30秒タイムアウト / 再処理はスナップショットから
// - 停止依頼があれば当該劇場の取得を即時停止する運用
// ドラフト: 文面の最終確認はオーナー作業（docs/16 §5.4）。

export function meta(_args: Route.MetaArgs) {
  return [{ title: `クローラについて — ${SERVICE_NAME}` }]
}

export default function Bot() {
  return (
    <LegalPage title="クローラ（CinemaHashigoBot）について">
      <p>
        本ページは、{SERVICE_NAME} が上映スケジュールの取得に使用するクローラ（bot）
        の説明です。劇場サイト運営者の方に向けて、目的・アクセス方針・停止依頼の方法を記載しています。
      </p>

      <LegalSection title="User-Agent">
        <p>
          <code className="rounded bg-neutral-100 px-2 py-0.5">{BOT_USER_AGENT}</code>
        </p>
      </LegalSection>

      <LegalSection title="目的">
        <p>
          劇場公式サイトで公開されている上映スケジュール（作品名・上映時刻等の事実情報）を取得し、映画のはしご鑑賞プランの算出にのみ使用します。
        </p>
        <ul className="list-disc pl-5">
          <li>取得した上映一覧をそのまま一覧サイトとして公開することはありません。</li>
          <li>チケット販売・予約ページへの自動アクセスは行いません。</li>
          <li>サイトのデザイン・画像・文章等の創作的表現は複製・転載しません。</li>
        </ul>
      </LegalSection>

      <LegalSection title="アクセス方針">
        <ul className="list-disc pl-5">
          <li>各劇場サイトへのアクセスは原則1日1回の取得セッションのみです。</li>
          <li>1セッションで取得するページ数は最大10ページです。</li>
          <li>同一サイトへのリクエストは5秒以上の間隔を空け、並列アクセスは行いません。</li>
          <li>取得は30秒でタイムアウトし、過度な再試行は行いません。</li>
          <li>
            取得したページは保存し、抽出処理のやり直しは保存済みデータから行います（再取得のための再アクセスを行いません）。
          </li>
          <li>robots.txt を確認し、許可されていないサイトは取得対象にしません。</li>
        </ul>
      </LegalSection>

      <LegalSection title="取得の停止依頼">
        <p>
          サイト運営者の方で取得の停止をご希望の場合は、下記までご連絡ください。
          <strong>確認後、当該サイトへの取得を速やかに停止します。</strong>
        </p>
        {CONTACT_EMAIL ? (
          <p>
            連絡先:{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="text-blue-700 underline">
              {CONTACT_EMAIL}
            </a>
          </p>
        ) : (
          <p>連絡先の掲載は準備中です。</p>
        )}
      </LegalSection>
    </LegalPage>
  )
}
