import { newId, titleKey } from '@cinema/shared'

// 名寄せ（docs/11 §4.2）。title_key 一致で既存 movie に紐付け、無ければ新規。競合時は取り直す。
export async function resolveMovieId(
  db: D1Database,
  title: string,
  runtimeMin: number | null,
): Promise<string> {
  const key = titleKey(title)
  const found = await db
    .prepare(`SELECT id FROM movies WHERE title_key = ?`)
    .bind(key)
    .first<{ id: string }>()
  if (found) return found.id

  const id = newId('mov')
  await db
    .prepare(
      `INSERT INTO movies (id, title, title_key, runtime_min)
       VALUES (?,?,?,?)
       ON CONFLICT(title_key) DO NOTHING`,
    )
    .bind(id, title, key, runtimeMin)
    .run()

  const row = await db
    .prepare(`SELECT id FROM movies WHERE title_key = ?`)
    .bind(key)
    .first<{ id: string }>()
  if (!row) throw new Error(`movie の解決に失敗: ${title}`)
  return row.id
}
