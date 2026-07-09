import { z } from 'zod'

// 公開 API レスポンスの Movie（docs/04 components.schemas.Movie）。
// /movies は作品の存在のみを返し、上映時刻・劇場別内訳は返さない（原則1）。
export const Movie = z.object({
  id: z.string(),
  title: z.string(),
  runtimeMin: z.number().int().nullable(),
})
export type Movie = z.infer<typeof Movie>
