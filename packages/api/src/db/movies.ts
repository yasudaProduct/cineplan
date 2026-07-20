import type { Movie } from '@cinema/shared'

// 対象日に上映がある作品一覧（docs/11 §5.2）。
// 原則1（内部利用限定）: 作品の存在のみ返し、上映時刻・劇場別内訳は返さない。
export async function listMoviesByDate(db: D1Database, businessDate: string): Promise<Movie[]> {
  const { results } = await db
    .prepare(
      `SELECT DISTINCT m.id AS id, m.title AS title, m.runtime_min AS runtimeMin
         FROM screenings s
         JOIN movies m ON m.id = s.movie_id
         JOIN theaters t ON t.id = s.theater_id
        WHERE s.business_date = ?1 AND t.status = 'active'
        ORDER BY m.title`,
    )
    .bind(businessDate)
    .all<{ id: string; title: string; runtimeMin: number | null }>()
  return results
}
