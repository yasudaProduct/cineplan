// 日付タブの汎用検出と取得日付の選定（複数日取得・ADR-0019・docs/06 §2.2）。
//
// ■ ページ内関数（*InPage）の絶対ルール
// これらは `page.evaluate()` に渡され Function.prototype.toString() でブラウザへ送られる。
// そのため **外側スコープの import・定数・ヘルパを一切参照してはならない**（参照するとブラウザ内で
// ReferenceError になり全日失敗する）。正規表現・定数はすべて関数本体にインラインで書く。
// tsconfig に DOM lib が無い（lib:["ES2022"] / types:[]）ため、触る最小形だけをローカル宣言して
// キャストする。結果としてフェイク document を渡す単体テストが可能（jsdom 不要）。
//
// ■ 構造非依存（ADR-0003）
// CSS セレクタで狙い撃ちしない。「値が YYYY-MM-DD に完全一致する属性を持つ表示中の要素」を
// 属性名に依存せず収集する。検出0件の劇場は single と同じ挙動に自動フォールバックする。

import { MAX_FETCH_DAYS } from '@cinema/shared'

interface InPageElement {
  attributes: ArrayLike<{ value: string }>
  getBoundingClientRect(): { width: number; height: number }
  click(): void
}

interface InPageDocument {
  querySelectorAll(selectors: string): ArrayLike<InPageElement>
  body: { innerText?: string; textContent?: string } | null
}

declare const document: InPageDocument

// ページ内で日付タブ候補の日付を列挙する（昇順・重複除去）。失敗時は空配列。
export function collectDateTabsInPage(): string[] {
  try {
    const re = /^\d{4}-\d{2}-\d{2}$/
    const nodes = document.querySelectorAll('a,button,li,div,span,option,label,td,th')
    const found: string[] = []
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i]
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue // 非表示・ダミー要素は除外
      const attrs = el.attributes
      for (let j = 0; j < attrs.length; j++) {
        const value = attrs[j]?.value
        if (value && re.test(value)) {
          if (found.indexOf(value) === -1) found.push(value)
          break // 1要素から拾うのは1日付まで
        }
      }
    }
    return found.sort()
  } catch {
    return []
  }
}

// ページ内で指定日のタブをクリックする。見つかれば true。
// 座標クリックではなく HTMLElement.click() を呼ぶため、画面外・被覆でも委譲ハンドラに届く。
export function clickDateTabInPage(date: string): boolean {
  try {
    const nodes = document.querySelectorAll('a,button,li,div,span,option,label,td,th')
    for (let i = 0; i < nodes.length; i++) {
      const el = nodes[i]
      if (!el) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) continue
      const attrs = el.attributes
      for (let j = 0; j < attrs.length; j++) {
        if (attrs[j]?.value === date) {
          el.click()
          return true
        }
      }
    }
    return false
  } catch {
    return false
  }
}

// ページ内で本文テキストの変化シグネチャ（長さ + FNV-1a 32bit）を返す。
// page.content() のハッシュを使わないのは、タブの active クラス付替えだけで変化してしまい
// AJAX 到着前の DOM を「変化した」と誤検出するため（docs/06 §2.2）。
export function readContentSignatureInPage(): string {
  try {
    const body = document.body
    const text = (body?.innerText ?? body?.textContent ?? '') as string
    let hash = 0x811c9dc5
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i)
      hash = Math.imul(hash, 0x01000193)
    }
    return `${text.length}:${(hash >>> 0).toString(16)}`
  } catch {
    return 'err'
  }
}

// --- 以下は純関数（ページ内で実行しない。通常の import を使ってよい） ---

// 検出した日付 → 実際に取得する日付列。
// 当日（businessDate）より前の日付は必ず落とす: replaceScreeningsByDate は
// [coverageFloor, ...抽出日付] の最小〜最大を連続 DELETE するため、過去日を混ぜると履歴を消す。
export function selectFetchDates(found: string[], days: number, businessDate: string): string[] {
  const cap = days === 0 ? MAX_FETCH_DAYS : Math.min(days, MAX_FETCH_DAYS)
  const uniq = [...new Set(found)].filter((d) => d >= businessDate).sort()
  return uniq.slice(0, Math.max(0, cap))
}

// url_template 用: 当日から days 日分の日付列（UTC 基準の日付加算。月跨ぎ対応）。
export function enumerateFetchDates(businessDate: string, days: number): string[] {
  const cap = Math.min(Math.max(days, 1), MAX_FETCH_DAYS)
  const start = new Date(`${businessDate}T00:00:00.000Z`).getTime()
  const out: string[] = []
  for (let i = 0; i < cap; i++) {
    out.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10))
  }
  return out
}

// URL テンプレートの {date} を置換する（複数箇所可。プレースホルダが無ければそのまま）。
export function resolveDateUrl(template: string, date: string): string {
  return template.split('{date}').join(date)
}
