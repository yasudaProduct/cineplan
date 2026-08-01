import { initWasm, Resvg } from '@resvg/resvg-wasm'
import resvgWasm from '@resvg/resvg-wasm/index_bg.wasm'
import fontDataUrl from '../assets/og-font.ttf?inline'
import { fetchSharedPlan } from '../lib/api'
import { buildOgSvg } from '../lib/og-image'
import { summarizePlan } from '../lib/plan-summary'
import type { Route } from './+types/share-og'

// OGP 動的画像 /p/{planId}/og.png（P5-2・docs/spec/07 §1.5）。
// 手書き SVG テンプレート（lib/og-image.ts）を resvg-wasm で PNG 化する。
// フォントは Noto Sans JP のサブセット（app/assets/og-font.ttf・約65KB・OFL）。
// X/Facebook のクローラは SVG の og:image を解さないため PNG で返す。

// initWasm は isolate ごとに一度だけ（二度目は throw するため Promise を保持）
let wasmReady: Promise<void> | null = null
function ensureWasm(): Promise<void> {
  wasmReady ??= initWasm(resvgWasm as unknown as WebAssembly.Module)
  return wasmReady
}

// ?inline は data URL 文字列になる（Workers の fetch は data: 非対応のため自前デコード）
const fontBuffer: Uint8Array = Uint8Array.from(
  atob(fontDataUrl.slice(fontDataUrl.indexOf(',') + 1)),
  (c) => c.charCodeAt(0),
)

export async function loader({ params }: Route.LoaderArgs) {
  const r = await fetchSharedPlan(params.planId)
  if (!r.ok) {
    return new Response('not found', { status: r.status === 404 ? 404 : 502 })
  }
  await ensureWasm()
  const svg = buildOgSvg(summarizePlan(r.data))
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: 1200 },
    font: { fontBuffers: [fontBuffer], loadSystemFonts: false },
  })
    .render()
    .asPng()
  return new Response(png.buffer as ArrayBuffer, {
    headers: {
      'content-type': 'image/png',
      // 不変スナップショット由来（docs/spec/04 設計メモ11 と同趣旨）。期限切れ後も最大1日
      // キャッシュに残りうるが、画像単体に個人情報は無く実害なし。
      'cache-control': 'public, max-age=86400',
    },
  })
}
