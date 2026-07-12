import type { ExtractionResult, NormalizedScreening } from '@cinema/shared'
import { resolveMovieId } from '../db/movies'
import { replaceScreeningsByDate } from '../db/screenings'
import { normalize } from './normalize'

// 通常書込パス: 正規化 → movie 解決 → D1 洗い替え（docs/11 §4）。
// pipeline（取込）・レビュー承認（P4-5）・R2 再抽出（P4-4）の3経路すべてが
// この同一関数を通る（docs/09 P4-5「承認は通常書込パスで反映」の担保）。
// coverageFloor はデータの起点日（取込なら fetch 当日、再抽出/承認ならスナップショットの
// 取得日）。today を使うとスナップショットが古い場合に、抽出がカバーしない日まで
// 洗い替え範囲に入り新しいデータを消しうるため、必ず「そのデータの日」を渡す。
export async function normalizeResolveWrite(
  db: D1Database,
  theaterId: string,
  runId: string,
  result: ExtractionResult,
  coverageFloor: string,
): Promise<number> {
  const pre = normalize(result)
  const rows: NormalizedScreening[] = []
  for (const p of pre) {
    const movieId = await resolveMovieId(db, p.movieTitle, null)
    rows.push({
      businessDate: p.businessDate,
      movieId,
      startAt: p.startAt,
      endAt: p.endAt,
      endAtSource: p.endAtSource,
      format: p.format,
      screenName: p.screenName,
      detailUrl: p.detailUrl,
    })
  }
  return replaceScreeningsByDate(db, theaterId, runId, rows, coverageFloor)
}
