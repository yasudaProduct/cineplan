import { Link } from 'react-router'
import { fetchTheaters } from '../lib/api'
import type { Route } from './+types/home'

// LP（P5-3・docs/spec/07 §1.2）。セクション構成はドキュメントを正とする:
// ヒーロー / 価値説明3カード / 使い方3ステップ / 対応劇場 / アプリ導線 / フッター。
// フッターの法務リンク（利用規約・プライバシー・お問い合わせ）は P5-4 でページと同時に
// 追加する（先にリンクだけ置かない）。免責は root.tsx の全ページ共通フッターが担う。

export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'cineplan — 映画はしごプランナー' },
    {
      name: 'description',
      content:
        '複数の映画館の上映スケジュールから、1日で効率よく映画をはしご鑑賞するルートを提案。移動時間込みのタイムラインとカレンダー登録に対応。',
    },
    { property: 'og:type', content: 'website' },
    { property: 'og:title', content: 'cineplan — 映画はしごプランナー' },
    {
      property: 'og:description',
      content: '1日で効率よく映画をはしご鑑賞するルートを提案します。',
    },
  ]
}

// 対応劇場（劇場名のみ。上映情報は一切出さない=原則1・docs/spec/08 §0）。
// API 到達不能でも LP は表示する（劇場一覧セクションだけ省略）。
export async function loader(_args: Route.LoaderArgs) {
  const r = await fetchTheaters()
  return { theaters: r.ok ? r.data : [] }
}

const VALUES = [
  {
    icon: '🏆',
    title: '最多ルート提案',
    body: '上映時刻と移動時間から、1日で最も多く観られる組み合わせを自動で算出。移動少なめ・余裕ありの代替案も提示します。',
  },
  {
    icon: '🚃',
    title: '移動込みタイムライン',
    body: '劇場間の移動・待ち時間まで含めた縦のタイムラインで、当日の動きがひと目で分かります。',
  },
  {
    icon: '📅',
    title: 'カレンダー登録',
    body: 'Google カレンダーへの登録や .ics 一括ダウンロードに対応。組んだプランは URL で共有できます。',
  },
] as const

const STEPS = [
  { n: '1', title: '日付と出発地を入力', body: '観たい日と最寄り駅（または現在地）を選ぶだけ。' },
  {
    n: '2',
    title: 'プランを算出',
    body: '観たい作品があればマスト指定も。数秒で3案を提示します。',
  },
  {
    n: '3',
    title: '予約して出かける',
    body: 'チケットは各劇場の公式サイトで。プランはカレンダーへ登録できます。',
  },
] as const

export default function Home({ loaderData }: Route.ComponentProps) {
  const { theaters } = loaderData
  return (
    <main>
      {/* ヒーロー（07 §1.2） */}
      <section className="mx-auto flex max-w-xl flex-col items-center gap-6 px-4 pt-24 pb-16 text-center">
        <h1 className="text-4xl font-bold">🎬 cineplan</h1>
        <p className="text-lg text-neutral-600">
          複数の映画館の上映スケジュールから、
          <br />
          1日で効率よく「はしご鑑賞」するルートを提案します。
        </p>
        <Link
          to="/plan"
          className="rounded-full bg-neutral-900 px-8 py-3 text-lg font-semibold text-white hover:bg-neutral-700"
        >
          今日のはしごを組む
        </Link>
      </section>

      {/* 価値説明3カード */}
      <section aria-label="サービスの特徴" className="bg-white px-4 py-12">
        <div className="mx-auto grid max-w-4xl gap-6 sm:grid-cols-3">
          {VALUES.map((v) => (
            <div key={v.title} className="rounded-lg border border-neutral-200 p-5">
              <p className="text-3xl">{v.icon}</p>
              <h2 className="mt-2 font-bold">{v.title}</h2>
              <p className="mt-1 text-sm text-neutral-600">{v.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* 使い方3ステップ */}
      <section aria-label="使い方" className="px-4 py-12">
        <h2 className="text-center text-2xl font-bold">使い方はかんたん</h2>
        <ol className="mx-auto mt-6 grid max-w-4xl gap-6 sm:grid-cols-3">
          {STEPS.map((s) => (
            <li key={s.n} className="flex flex-col items-center text-center">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500 font-bold text-white">
                {s.n}
              </span>
              <h3 className="mt-3 font-bold">{s.title}</h3>
              <p className="mt-1 text-sm text-neutral-600">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* 対応劇場（劇場名一覧は出すが上映情報は一切出さない。07 §1.2・原則1） */}
      <section aria-label="対応劇場" className="bg-white px-4 py-12">
        <div className="mx-auto max-w-4xl text-center">
          <h2 className="text-2xl font-bold">対応劇場</h2>
          <p className="mt-2 text-neutral-600">
            大阪エリアの {theaters.length > 0 ? `${theaters.length}館` : 'ミニシアター・シネコン'}
            に対応。順次拡大予定です。
          </p>
          {theaters.length > 0 && (
            <ul className="mt-4 flex flex-wrap justify-center gap-2">
              {theaters.map((t) => (
                <li
                  key={t.id}
                  className="rounded-full border border-neutral-200 bg-neutral-50 px-4 py-1.5 text-sm"
                >
                  {t.name}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-neutral-400">
            ※ 上映スケジュールはルート算出にのみ使用し、本サイトでは一覧表示しません。
          </p>
        </div>
      </section>

      {/* アプリ導線（後続フェーズでストアバッジに差替。07 §1.2） */}
      <section aria-label="アプリ" className="px-4 py-12 text-center">
        <p className="inline-block rounded-full border border-dashed border-neutral-300 px-6 py-2 text-sm text-neutral-500">
          📱 アプリ版は準備中です
        </p>
      </section>

      {/* 最後にもう一度 CTA */}
      <section className="px-4 pb-16 text-center">
        <Link
          to="/plan"
          className="rounded-full bg-amber-500 px-8 py-3 text-lg font-semibold text-white hover:bg-amber-600"
        >
          はしごプランを組んでみる →
        </Link>
      </section>
    </main>
  )
}
