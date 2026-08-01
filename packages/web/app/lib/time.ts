// JST 表示ユーティリティ。内部表現は UTC ISO、表示層でのみ JST 変換（CLAUDE.md 方針）。

const TZ = 'Asia/Tokyo'

const timeFmt = new Intl.DateTimeFormat('ja-JP', {
  timeZone: TZ,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
})

const dateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }) // YYYY-MM-DD

export function jstTime(iso: string): string {
  return timeFmt.format(new Date(iso))
}

export function jstHour(iso: string): number {
  const [h] = jstTime(iso).split(':')
  return Number(h)
}

export function minutesBetween(aIso: string, bIso: string): number {
  return Math.round((Date.parse(bIso) - Date.parse(aIso)) / 60_000)
}

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  if (h > 0) return m > 0 ? `${h}時間${m}分` : `${h}時間`
  return `${m}分`
}

export function todayJst(): string {
  return dateFmt.format(new Date())
}

export function addDaysJst(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00+09:00`) + days * 86_400_000
  return dateFmt.format(new Date(t))
}

// 終電注意バッジ（docs/spec/05 §5: end が 23:00 以降なら UI 側で注意表示）
export function isLateNight(iso: string): boolean {
  return jstHour(iso) >= 23
}
