// 時刻ユーティリティ（docs/spec/09 §3, §4.2）。
// 内部保存は UTC ISO 文字列（Z 付き）。business_date のみ JST の YYYY-MM-DD 文字列。

// JST 実時刻 → business_date（05:00 JST 未満は前日扱い = 興行日）
export function toBusinessDate(startUtc: string): string {
  const jst = new Date(new Date(startUtc).getTime() + 9 * 3600 * 1000)
  const h = jst.getUTCHours()
  const d = new Date(jst)
  if (h < 5) d.setUTCDate(d.getUTCDate() - 1)
  return d.toISOString().slice(0, 10)
}

// "25:10"（24時超え表記可）+ business_date(JST) → UTC ISO 文字列
export function normalizeStart(businessDate: string, hhmm: string): string {
  const [rawH, m] = hhmm.split(':').map(Number)
  let h = rawH
  let addDay = 0
  if (h >= 24) {
    h -= 24
    addDay = 1
  }
  const jst = new Date(`${businessDate}T00:00:00+09:00`)
  jst.setHours(jst.getHours() + h + addDay * 24, m)
  return jst.toISOString()
}

// タイトル名寄せキー（docs/spec/03 §6 / docs/spec/06 §6）。全半角統一→記号/空白除去→小文字化。
export function titleKey(t: string): string {
  return t
    .normalize('NFKC')
    .replace(/[\s!?！？・:：\-─【】()（）「」『』]/g, '')
    .toLowerCase()
}
