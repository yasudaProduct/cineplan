import type { Child } from 'hono/jsx'

// 管理サイト共通コンポーネント（Hono JSX・SSR のみ・クライアント JS なし。docs/07 §3）。

const CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { font-family: 'Hiragino Kaku Gothic ProN','Hiragino Sans',Meiryo,system-ui,sans-serif;
  margin: 0; background: #f6f6f4; color: #1c1c1a; font-size: 14px; }
header { background: #23231f; color: #fff; padding: 10px 16px; display: flex; gap: 18px; align-items: baseline; flex-wrap: wrap; }
header .brand { font-weight: 700; }
header a { color: #ddd; text-decoration: none; padding: 2px 4px; }
header a.active, header a:hover { color: #fff; border-bottom: 2px solid #e0c060; }
header .env { margin-left: auto; font-size: 12px; color: #aaa; }
main { max-width: 1080px; margin: 0 auto; padding: 20px 16px 60px; }
h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; }
table { border-collapse: collapse; width: 100%; background: #fff; }
th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
th { background: #efefe9; font-weight: 600; white-space: nowrap; }
tr:hover td { background: #fbfbf5; }
.cards { display: flex; gap: 12px; flex-wrap: wrap; }
.card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 12px 16px; min-width: 180px; }
.card .k { font-size: 12px; color: #666; } .card .v { font-size: 22px; font-weight: 700; }
.chip { display: inline-block; border-radius: 10px; padding: 1px 8px; font-size: 12px; white-space: nowrap; }
.chip.ok { background: #e2f3e4; color: #176627; }
.chip.ng { background: #fbe1e1; color: #a11212; }
.chip.warn { background: #fdf3d7; color: #8a6100; }
.chip.mut { background: #eee; color: #555; }
.warn-text { color: #a11212; font-weight: 600; }
form.inline { display: inline; }
label { display: block; margin: 10px 0 2px; font-weight: 600; font-size: 13px; }
input[type=text], input[type=url], input[type=number], input[type=date], select, textarea {
  width: 100%; max-width: 560px; padding: 6px 8px; border: 1px solid #bbb; border-radius: 4px; font-size: 14px; background:#fff; }
textarea { min-height: 60px; }
button { background: #23231f; color: #fff; border: 0; border-radius: 5px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
button:hover { background: #454540; }
button.danger { background: #a11212; }
button.secondary { background: #fff; color: #23231f; border: 1px solid #999; }
.msg { border: 1px solid #9bc79b; background: #eef7ee; color: #1c5a26; padding: 8px 12px; border-radius: 6px; margin: 12px 0; }
.msg.err { border-color: #d99; background: #fbecec; color: #8f1717; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: start; }
@media (max-width: 800px) { .grid2 { grid-template-columns: 1fr; } }
.snapshot-img { max-width: 100%; border: 1px solid #ccc; background: #fff; }
.spark { font-size: 18px; letter-spacing: 2px; }
.small { font-size: 12px; color: #666; }
code { background: #eee; padding: 1px 4px; border-radius: 3px; font-size: 12px; }
.actions { display: flex; gap: 10px; flex-wrap: wrap; margin: 14px 0; align-items: center; }
`

export function Layout(props: { title: string; active: string; env: string; children?: Child }) {
  const nav = [
    ['/admin', 'ダッシュボード', 'dashboard'],
    ['/admin/theaters', '劇場マスタ', 'theaters'],
    ['/admin/runs', '取込履歴', 'runs'],
    ['/admin/reviews', 'レビュー', 'reviews'],
    ['/admin/screenings', '上映データ', 'screenings'],
  ] as const
  return (
    <html lang="ja">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
        <title>{props.title} — cineplan admin</title>
        <style>{CSS}</style>
      </head>
      <body>
        <header>
          <span class="brand">🎬 cineplan admin</span>
          {nav.map(([href, label, key]) => (
            <a href={href} class={key === props.active ? 'active' : ''}>
              {label}
            </a>
          ))}
          <span class="env">env: {props.env}</span>
        </header>
        <main>{props.children}</main>
      </body>
    </html>
  )
}

// run/review status の色付きチップ
export function StatusChip({ status }: { status: string }) {
  const cls =
    status === 'succeeded' || status === 'approved'
      ? 'ok'
      : status.endsWith('_failed') || status === 'rejected'
        ? 'ng'
        : status === 'pending'
          ? 'warn'
          : 'mut'
  return <span class={`chip ${cls}`}>{status}</span>
}

export function TheaterStatusChip({ status }: { status: string }) {
  const cls = status === 'active' ? 'ok' : status === 'paused' ? 'warn' : 'mut'
  return <span class={`chip ${cls}`}>{status}</span>
}

// UTC ISO → JST 'MM/DD HH:mm' （表示専用）
export function jst(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(Date.parse(iso) + 9 * 3600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

// フラッシュメッセージ（PRG の ?msg= / ?err= を表示）
export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (err) return <p class="msg err">{err}</p>
  if (msg) return <p class="msg">{msg}</p>
  return null
}

const BARS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█']
export function sparkline(values: number[]): string {
  const max = Math.max(...values, 1)
  return values.map((v) => BARS[Math.min(7, Math.floor((v / max) * 7))]).join('')
}
