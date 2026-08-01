import type { CandidateScreening } from '@cinema/shared'

// planner 用: 対象日・active 劇場の候補 Screening を一括ロード（docs/spec/09 §5.1）。
// この配列をメモリに載せて DP する。D1 への追加クエリは行わない。
export async function loadCandidates(
  db: D1Database,
  businessDate: string,
): Promise<CandidateScreening[]> {
  const { results } = await db
    .prepare(
      `SELECT s.id            AS screeningId,
              s.theater_id    AS theaterId,
              s.movie_id      AS movieId,
              s.start_at      AS startAt,
              s.end_at        AS endAt,
              s.format        AS format,
              s.detail_url    AS detailUrl,
              m.title         AS movieTitle,
              t.name          AS theaterName,
              t.official_url  AS officialUrl
         FROM screenings s
         JOIN theaters t ON t.id = s.theater_id
         JOIN movies   m ON m.id = s.movie_id
        WHERE s.business_date = ?
          AND t.status = 'active'
        ORDER BY s.start_at ASC`,
    )
    .bind(businessDate)
    .all<CandidateScreening>()
  return results
}
