import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from 'react-router'
import type { Route } from './+types/root'
import './app.css'
import { CONTACT_EMAIL } from './lib/site'

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link
          rel="icon"
          href="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 100%22><text y=%22.9em%22 font-size=%2290%22>🎬</text></svg>"
        />
        <Meta />
        <Links />
      </head>
      <body className="min-h-screen flex flex-col">
        <div className="flex-1">{children}</div>
        {/* 免責の全ページ掲示（docs/08 §5）+ 法務リンク（P5-4・07 §1.2/§1.6） */}
        <footer className="mt-8 border-t border-neutral-200 bg-white px-4 py-4 text-center text-xs text-neutral-500">
          <p>
            上映時間は変更される場合があります。必ず各劇場の公式サイトでご確認ください。移動時間・経路は目安です。
          </p>
          <p className="mt-2 flex flex-wrap justify-center gap-x-4 gap-y-1">
            <Link to="/terms" className="hover:underline">
              利用規約
            </Link>
            <Link to="/privacy" className="hover:underline">
              プライバシーポリシー
            </Link>
            <Link to="/bot" className="hover:underline">
              クローラについて
            </Link>
            {CONTACT_EMAIL && (
              <a href={`mailto:${CONTACT_EMAIL}`} className="hover:underline">
                お問い合わせ
              </a>
            )}
          </p>
        </footer>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

export default function App() {
  return <Outlet />
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = 'エラー'
  let details = '予期しないエラーが発生しました。'
  let stack: string | undefined

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? '404' : 'エラー'
    details = error.status === 404 ? 'ページが見つかりません。' : error.statusText || details
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message
    stack = error.stack
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1 className="text-2xl font-bold">{message}</h1>
      <p className="mt-2">{details}</p>
      {stack && (
        <pre className="mt-4 w-full overflow-x-auto p-4 text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  )
}
