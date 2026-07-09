import type { ImagePart } from '../llm'
import type { FetchedImage } from './fetch'

// vision（docs/06 §2.1）: 画像バイト → base64 の ImagePart[]。過大な画像のみ縮小（初期は素通し）。
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

// text（docs/06 §2）: script/style/svg/noscript/コメント除去・href 以外の属性除去・空白圧縮。
// タグは残す（表構造の手掛かり）。P1 は vision 主体だが将来の rendered 館用に用意。
export function htmlToText(html: string): string {
  return html
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
