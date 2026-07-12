import { Link } from 'react-router'
import type { Route } from './+types/home'

// LP（07 §1.2）の簡易版。ヒーロー + CTA のみ。本実装（価値説明・使い方・対応劇場等）は P5-3。
export function meta(_args: Route.MetaArgs) {
  return [
    { title: 'cineplan — 映画はしごプランナー' },
    { name: 'description', content: '1日で効率よく映画をはしご鑑賞するルートを提案します。' },
  ]
}

export default function Home() {
  return (
    <main className="mx-auto flex max-w-xl flex-col items-center gap-6 px-4 pt-24 text-center">
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
    </main>
  )
}
