import type { ImagePart } from '../llm'
import type { FetchedImage } from './fetch'

// vision（docs/spec/06 §2.1）: 画像バイト → base64 の ImagePart[]。過大な画像のみ縮小（初期は素通し）。
export function imagesToParts(images: FetchedImage[]): ImagePart[] {
  return images.map((img) => ({
    mimeType: img.mimeType,
    dataBase64: arrayBufferToBase64(img.bytes),
  }))
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let bin = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(bin)
}

// 常にスケジュールと無関係なノイズ領域の除去（rendered/static 共通。P4-7 の巨大ページ対策）。
// - header/footer/nav: HTML5 の意味上サイト共通のチロム（本文外）。テアトル梅田(ttcg.jp)で
//   除去済み検証済み（削減率7%・データ欠損無し。docs/plan/01 P4-8 追記）。
// - meta/link: 常に無内容（void要素）。
// - img: htmlToText 側で href 以外の属性を保持しないため常に無内容（大阪ステーションシネマの
//   実データで実証: 104個の img が全て空。docs/plan/01 P4-8 追記④）。
// - figure/iframe: 除去すると情報が消える構成（キャプション付き figure 等）を想定し、
//   タグを剥がした結果が空文字の場合のみ除去する（安全側。中身がある場合はそのまま残す）。
function stripNoise(html: string): string {
  const removeIfEmpty = (tag: string) => (h: string) =>
    h.replace(new RegExp(`<${tag}(?:\\s[^>]*)?>[\\s\\S]*?<\\/${tag}>`, 'gi'), (block) =>
      /^\s*$/.test(block.replace(/<[^>]+>/g, '')) ? '' : block,
    )
  let out = html
    .replace(/<(header|footer|nav)[\s\S]*?<\/\1>/gi, '')
    .replace(/<meta[^>]*>/gi, '')
    .replace(/<link[^>]*>/gi, '')
    .replace(/<img[^>]*>/gi, '')
  out = removeIfEmpty('figure')(out)
  out = removeIfEmpty('iframe')(out)
  return out
}

// text（docs/spec/06 §2）: 上記ノイズ除去 → script/style/svg/noscript/コメント除去・href 以外の
// 属性除去・空白圧縮。タグは残す（表構造の手掛かり）。P1 は vision 主体だが将来の rendered 館用に用意。
export function htmlToText(html: string): string {
  return stripNoise(html)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|svg|noscript)[\s\S]*?<\/\1>/gi, '')
    .replace(/<([a-zA-Z][\w-]*)((?:\s+[^>]*)?)>/g, (_all, tag: string, attrs: string) => {
      const href = attrs.match(/\shref=("[^"]*"|'[^']*')/i)
      return href ? `<${tag} href=${href[1]}>` : `<${tag}>`
    })
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim()
}
