import type { PlanSummary } from './plan-summary'

// OGP 動的画像の SVG テンプレート（P5-2・docs/07 §1.5）。
// 1200x630（OGP 標準）。使用グリフを増やしたら scripts/make-og-font.mjs の GLYPHS に
// 追記して og-font.ttf を再生成すること（無いグリフは描画されず空白になる）。
// PNG 化（resvg-wasm）は routes 側で行う（wasm 初期化を resource route に閉じ込める）。

const W = 1200
const H = 630
const FONT = 'Noto Sans CJK JP'

const esc = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function buildOgSvg(s: PlanSummary): string {
  const timeline = s.startTime && s.endTime ? `${s.startTime} → ${s.endTime}` : ''
  const theaters = s.theaterCount > 1 ? `${s.theaterCount}館をはしご・` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#18181b"/>
      <stop offset="1" stop-color="#27272a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect x="0" y="0" width="${W}" height="12" fill="#f59e0b"/>
  <text x="80" y="170" font-family="${FONT}" font-size="52" fill="#d4d4d8">${esc(s.dateLabel)}の映画はしごプラン</text>
  <text x="74" y="330" font-family="${FONT}" font-size="140" fill="#f59e0b">${s.movieCount}本はしご</text>
  <text x="80" y="440" font-family="${FONT}" font-size="46" fill="#a1a1aa">${theaters}移動${s.travelMin}分・待ち${s.waitMin}分</text>
  <text x="80" y="516" font-family="${FONT}" font-size="46" fill="#a1a1aa">${esc(timeline)}</text>
  <text x="80" y="584" font-family="${FONT}" font-size="34" fill="#71717a">cineplan</text>
</svg>`
}
