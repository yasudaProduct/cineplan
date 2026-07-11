// 入力値の localStorage 保存/復元（07 §1.3。個人情報なし・端末内のみ）。

const KEY = 'cineplan.plan-form.v1'

export function loadFormState<T>(): Partial<T> | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Partial<T>) : null
  } catch {
    return null
  }
}

export function saveFormState(state: unknown): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // 容量超過等は無視（保存は best-effort）
  }
}
