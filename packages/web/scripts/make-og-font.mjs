// OGP 動的画像（/p/{planId}/og.png・P5-2）用のサブセットフォント生成スクリプト。
//
//   node scripts/make-og-font.mjs
//
// Noto Sans JP (Bold) を取得し、OGP 画像テンプレート（app/lib/og-image.ts）が使う
// グリフだけに絞った TTF を app/assets/og-font.ttf へ出力する（約20KB）。
// フルフォント（数MB〜十数MB）を Worker バンドルに載せないための恒久措置で、
// 生成物はリポジトリにコミットする（CI では実行しない。ネットワークを使うのはこの
// スクリプトだけ・フォント配布元は GitHub の notofonts リリース）。
//
// テンプレートの文言を変えてグリフが増えたら GLYPHS に追記 → 再実行 → 再コミット。
// ライセンス: Noto Sans JP は SIL OFL 1.1（サブセットの再配布可）。app/assets/OFL.txt を同梱。
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import subsetFont from 'subset-font'

const FETCH_URL =
  'https://github.com/notofonts/noto-cjk/raw/main/Sans/OTF/Japanese/NotoSansCJKjp-Bold.otf'

// OGP テンプレートが描画しうる全文字（app/lib/og-image.ts と対で管理）
const GLYPHS = [
  // 数字・ASCII（時刻・日付・ブランド名 cineplan・記号）
  '0123456789',
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz',
  ' /():.→・-⚠',
  // 固定ラベル
  'の映画はしごプラン',
  '本移動待ち分終了館',
  '月火水木金土日', // 曜日
  '深夜', // 終電注意
].join('')

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'app', 'assets', 'og-font.ttf')

const res = await fetch(FETCH_URL, { redirect: 'follow' })
if (!res.ok) throw new Error(`font download failed: HTTP ${res.status}`)
const source = Buffer.from(await res.arrayBuffer())
console.log(`downloaded: ${(source.length / 1024 / 1024).toFixed(1)} MB`)

const subset = await subsetFont(source, GLYPHS, { targetFormat: 'truetype' })
await mkdir(dirname(out), { recursive: true })
await writeFile(out, subset)
console.log(
  `written: ${out} (${(subset.length / 1024).toFixed(1)} KB, ${GLYPHS.length} glyphs requested)`,
)
