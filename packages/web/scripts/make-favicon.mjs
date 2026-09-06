// ファビコン派生ファイル（favicon.ico / apple-touch-icon.png）の生成スクリプト。
//
//   cd packages/web && node scripts/make-favicon.mjs
//
// 唯一の原本は public/favicon.svg（手で編集するのはこれだけ）。SVG を編集したら本スクリプトを
// 再実行し、生成物もリポジトリにコミットする（CI では実行しない。make-og-font.mjs と同方針）。
// レンダラは OGP 画像と同じ resvg-wasm。ネットワークも追加依存も使わない。
//
// - favicon.ico  … 16/32/48px の PNG を ICO コンテナに詰めたもの（SVG 非対応ブラウザ・
//                   ブックマーク・ブラウザが暗黙に GET する /favicon.ico 用）
// - apple-touch-icon.png … 180px。iOS がマスクを自前で被せるため**角丸なし・不透明**で出す
//                   （原本の rx="14" を 0 に置換して角を落とす）

import { readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { initWasm, Resvg } from '@resvg/resvg-wasm'

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')
const ICO_SIZES = [16, 32, 48]
const APPLE_TOUCH_SIZE = 180

await initWasm(
  await readFile(createRequire(import.meta.url).resolve('@resvg/resvg-wasm/index_bg.wasm')),
)

const renderPng = (svg, size) =>
  Buffer.from(new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng())

// PNG を格納した ICO（ICONDIR + ICONDIRENTRY×N + PNG 本体）。全モダンブラウザが解釈できる。
function buildIco(pngs) {
  const HEADER = 6
  const ENTRY = 16
  const dir = Buffer.alloc(HEADER + ENTRY * pngs.length)
  dir.writeUInt16LE(0, 0) // reserved
  dir.writeUInt16LE(1, 2) // type: icon
  dir.writeUInt16LE(pngs.length, 4)
  let offset = dir.length
  pngs.forEach(({ size, data }, i) => {
    const p = HEADER + ENTRY * i
    dir.writeUInt8(size >= 256 ? 0 : size, p) // 256px は 0 で表す
    dir.writeUInt8(size >= 256 ? 0 : size, p + 1)
    dir.writeUInt8(0, p + 2) // パレット色数（true color は 0）
    dir.writeUInt8(0, p + 3) // reserved
    dir.writeUInt16LE(1, p + 4) // color planes
    dir.writeUInt16LE(32, p + 6) // bits per pixel
    dir.writeUInt32LE(data.length, p + 8)
    dir.writeUInt32LE(offset, p + 12)
    offset += data.length
  })
  return Buffer.concat([dir, ...pngs.map((p) => p.data)])
}

const svg = await readFile(join(PUBLIC_DIR, 'favicon.svg'), 'utf8')

const ico = buildIco(ICO_SIZES.map((size) => ({ size, data: renderPng(svg, size) })))
await writeFile(join(PUBLIC_DIR, 'favicon.ico'), ico)

const squared = svg.replaceAll('rx="14"', 'rx="0"')
await writeFile(join(PUBLIC_DIR, 'apple-touch-icon.png'), renderPng(squared, APPLE_TOUCH_SIZE))

console.log(
  `favicon.ico (${ICO_SIZES.join('/')}px) と apple-touch-icon.png (${APPLE_TOUCH_SIZE}px) を生成しました`,
)
