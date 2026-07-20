import { describe, expect, it } from 'vitest'
import { htmlToText } from '../preprocess'

// ノイズ除去（feat/gemini-timeout-noise-reduction・docs/09 P4-8 追記④）。
// 大阪ステーションシネマ（rendered/text）で Gemini 抽出が 120秒×3 回タイムアウトした調査から、
// header/footer/nav/meta/link/img/空の figure・iframe がスケジュールと無関係なまま
// LLM 入力に含まれていたことが判明。安全に除去できると実データで検証した範囲のみ実装する。

describe('htmlToText — ノイズ除去', () => {
  it('header/footer/nav を除去する（HTML5 の意味上サイト共通のチロム）', () => {
    const html = `
      <header><nav><a href="/">Top</a></nav></header>
      <table><tr><td>作品A 10:00</td></tr></table>
      <footer>Copyright &copy; Example</footer>
    `
    const text = htmlToText(html)
    expect(text).toContain('作品A')
    expect(text).not.toContain('Top')
    expect(text).not.toContain('Copyright')
    expect(text).not.toMatch(/<header>|<footer>|<nav>/)
  })

  it('meta/link を除去する（常に無内容の void 要素）', () => {
    const html = `<head><meta charset="utf-8"><link rel="stylesheet" href="/a.css"></head><p>作品A</p>`
    const text = htmlToText(html)
    expect(text).not.toMatch(/<meta|<link/)
    expect(text).toContain('作品A')
  })

  it('img を除去する（htmlToText は href 以外の属性を保持しないため常に無内容）', () => {
    const html = `<figure-outer><img src="/a.gif" alt="ポスター"></figure-outer><p>作品A</p>`
    const text = htmlToText(html)
    expect(text).not.toMatch(/<img/)
    expect(text).toContain('作品A')
  })

  it('中身が空の figure（画像+リンクのみ）は除去する（開始タグに属性が付いていても）', () => {
    const html = `
      <figure class="poster"><a href="https://example.com/detail?id=1"><img src="/a.gif"></a></figure>
      <h2><a href="https://example.com/detail?id=1">作品A</a></h2>
    `
    const text = htmlToText(html)
    // 空 figure ごと消えるが、隣接する見出しの同一 href は残る（情報の重複除去であり欠損ではない）
    expect(text).not.toMatch(/<figure>/)
    expect(text).toContain('作品A')
    expect(text).toContain('https://example.com/detail?id=1')
  })

  it('テキストを含む figure（figcaption 等）は保持する（安全側）', () => {
    const html = `<figure><img src="/a.gif"><figcaption>この写真の説明</figcaption></figure>`
    const text = htmlToText(html)
    expect(text).toContain('この写真の説明')
  })

  it('中身が空の iframe は除去し、テキストを含む iframe フォールバックは保持する', () => {
    const emptyIframe = htmlToText('<iframe src="https://ext.example/embed"></iframe><p>作品A</p>')
    expect(emptyIframe).not.toMatch(/<iframe/)
    expect(emptyIframe).toContain('作品A')

    const fallback = htmlToText('<iframe>このブラウザは対応していません</iframe>')
    expect(fallback).toContain('対応していません')
  })

  it('実データ相当のスケジュール表（重複 detailPath・複数列の時刻）は情報を保ったまま軽量化される', () => {
    // 大阪ステーションシネマの実構造を縮小再現: 1行に header/meta/img ノイズ + 1作品分のセル
    const html = `
      <html><head><meta charset="utf-8"><link rel="stylesheet" href="/a.css"></head>
      <body>
      <header><nav><a href="/">Top</a></nav></header>
      <table><tbody>
      <tr>
        <th>
          <section>
            <figure><a href="https://example.com/detail.html?id=T1"><img src="/p1.gif"></a></figure>
            <div><h2><a href="https://example.com/detail.html?id=T1">黒牢城</a></h2><p>（本編：148分）</p></div>
          </section>
        </th>
        <td><p>10:45</p><p>17:55</p></td>
        <td><p>13:05</p></td>
      </tr>
      </tbody></table>
      <footer>Copyright &copy; Example</footer>
      </body></html>
    `
    const before = html.length
    const text = htmlToText(html)
    expect(text.length).toBeLessThan(before)
    expect(text).toContain('黒牢城')
    expect(text).toContain('（本編：148分）')
    expect(text).toContain('10:45')
    expect(text).toContain('17:55')
    expect(text).toContain('13:05')
    // detailPath は h2 側の1本だけ残る（figure 側の重複は除去済み）
    expect(text.match(/detail\.html\?id=T1/g)).toHaveLength(1)
    expect(text).not.toContain('Copyright')
    expect(text).not.toContain('Top')
  })
})
