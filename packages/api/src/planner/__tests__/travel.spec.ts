import { describe, expect, it } from 'vitest'
import {
  createTravelResolver,
  estimateMinutes,
  haversineKm,
  resolveEndpointMinutes,
  type TheaterGeo,
} from '../travel'

const A: TheaterGeo = {
  id: 'thr_a',
  lat: 34.7025,
  lng: 135.4959,
  nearestStation: '大阪',
  walkMinFromSta: 5,
}
const B: TheaterGeo = {
  id: 'thr_b',
  lat: 34.6692,
  lng: 135.4781,
  nearestStation: '九条',
  walkMinFromSta: 5,
}

describe('createTravelResolver', () => {
  it('同一劇場は 0', () => {
    const tr = createTravelResolver([A, B], null)
    expect(tr.between('thr_a', 'thr_a')).toBe(0)
  })

  it('TravelMatrix があれば行列値を返す（非対称も可）', () => {
    const tr = createTravelResolver([A, B], {
      theaters: ['thr_a', 'thr_b'],
      matrix: [
        [0, 24],
        [26, 0],
      ],
      summaries: { 'thr_a>thr_b': '大阪→九条' },
    })
    expect(tr.between('thr_a', 'thr_b')).toBe(24)
    expect(tr.between('thr_b', 'thr_a')).toBe(26)
    expect(tr.summary?.('thr_a', 'thr_b')).toBe('大阪→九条')
  })

  it('行列欠損ペアは直線距離フォールバック（距離/20km/h + 15分）', () => {
    const tr = createTravelResolver([A, B], null)
    const expected = Math.ceil((haversineKm(A.lat, A.lng, B.lat, B.lng) / 20) * 60) + 15
    expect(tr.between('thr_a', 'thr_b')).toBe(expected)
    expect(tr.between('thr_a', 'thr_b')).toBeGreaterThan(15)
  })

  it('行列にセル欠損・null が混じっても 0/undefined 扱いせずフォールバックする', () => {
    const fallback = Math.ceil((haversineKm(A.lat, A.lng, B.lat, B.lng) / 20) * 60) + 15
    const tr = createTravelResolver([A, B], {
      theaters: ['thr_a', 'thr_b'],
      // 1行目はセル欠損（[0] のみ）。null も数値として扱わない
      matrix: [[0], [null as unknown as number, 0]],
    })
    expect(tr.between('thr_a', 'thr_b')).toBe(fallback) // 欠損セル → フォールバック
    expect(tr.between('thr_b', 'thr_a')).toBe(fallback) // null セル → フォールバック
  })
})

describe('resolveEndpointMinutes（P2 暫定解決）', () => {
  it('station: nearest_station 一致の劇場のみ walk_min を返す', () => {
    const m = resolveEndpointMinutes({ type: 'station', value: '九条' }, [A, B])
    expect(m.get('thr_b')).toBe(5)
    expect(m.has('thr_a')).toBe(false)
  })

  it('station: どの劇場にも一致しなければ空（呼び出し側で 400）', () => {
    const m = resolveEndpointMinutes({ type: 'station', value: '存在しない駅' }, [A, B])
    expect(m.size).toBe(0)
  })

  it('geo: 全劇場にフォールバック推定を返す', () => {
    const m = resolveEndpointMinutes({ type: 'geo', value: { lat: 34.7, lng: 135.49 } }, [A, B])
    expect(m.size).toBe(2)
    expect(m.get('thr_a')).toBe(estimateMinutes(34.7, 135.49, A.lat, A.lng))
  })
})
