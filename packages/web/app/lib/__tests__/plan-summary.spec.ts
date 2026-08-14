import type { Plan } from '@cinema/shared'
import { describe, expect, it } from 'vitest'
import { buildOgSvg } from '../og-image'
import {
  jstDateLabel,
  jstDateValue,
  shareDescription,
  shareTitle,
  summarizePlan,
} from '../plan-summary'

// 共有ページ・OGP の集計導出（P5-2・docs/spec/07 §1.5）

function plan(): Plan {
  return {
    label: 'most_movies',
    stats: {
      movieCount: 2,
      totalTravelMin: 30,
      totalWaitMin: 15,
      endTime: '2026-07-27T09:45:00.000Z', // JST 18:45
    },
    legs: [
      {
        kind: 'travel',
        fromTheaterId: null,
        toTheaterId: 'thr_a',
        departAt: '2026-07-27T01:10:00.000Z',
        arriveAt: '2026-07-27T01:25:00.000Z',
        durationMin: 15,
        summary: null,
      },
      {
        kind: 'screening',
        theaterId: 'thr_a',
        theaterName: 'シネ・ヌーヴォ',
        movieId: 'mov_a',
        movieTitle: '霧のごとく',
        format: null,
        startAt: '2026-07-27T01:30:00.000Z', // JST 10:30
        endAt: '2026-07-27T03:45:00.000Z',
        officialUrl: 'http://www.cinenouveau.com/',
      },
      { kind: 'wait', minutes: 15 },
      {
        kind: 'screening',
        theaterId: 'thr_b',
        theaterName: 'テアトル梅田',
        movieId: 'mov_b',
        movieTitle: 'トロフィー',
        format: null,
        startAt: '2026-07-27T07:45:00.000Z',
        endAt: '2026-07-27T09:45:00.000Z',
        officialUrl: 'https://ttcg.jp/ttcg_umeda/',
      },
    ],
  }
}

describe('jstDateLabel / jstDateValue', () => {
  it('UTC ISO を JST の M/D(曜) にする（2026-07-27 は月曜）', () => {
    expect(jstDateLabel('2026-07-27T01:30:00.000Z')).toBe('7/27(月)')
    expect(jstDateValue('2026-07-27T01:30:00.000Z')).toBe('2026-07-27')
  })
  it('UTC では前日でも JST の日付になる（日跨ぎ）', () => {
    // 2026-07-26T15:30Z = JST 7/27 00:30
    expect(jstDateLabel('2026-07-26T15:30:00.000Z')).toBe('7/27(月)')
    expect(jstDateValue('2026-07-26T15:30:00.000Z')).toBe('2026-07-27')
  })
})

describe('summarizePlan', () => {
  it('本数・移動/待ち・開始/終了・劇場数・タイトル一覧を導出する', () => {
    const s = summarizePlan(plan())
    expect(s).toEqual({
      dateLabel: '7/27(月)',
      movieCount: 2,
      travelMin: 30,
      waitMin: 15,
      startTime: '10:30',
      endTime: '18:45',
      theaterCount: 2,
      movieTitles: ['霧のごとく', 'トロフィー'],
    })
  })
  it('同一劇場の複数上映は劇場数1と数える', () => {
    const p = plan()
    for (const l of p.legs) if (l.kind === 'screening') l.theaterId = 'thr_a'
    expect(summarizePlan(p).theaterCount).toBe(1)
  })
})

describe('shareTitle / shareDescription', () => {
  it('OGP テキストを組み立てる（映画タイトルはテキスト側。docs/spec/07 §1.5）', () => {
    const s = summarizePlan(plan())
    expect(shareTitle(s)).toBe('7/27(月) 2本はしごプラン — cineplan')
    expect(shareDescription(s)).toBe('移動30分・待ち15分・18:45終了 | 霧のごとく / トロフィー')
  })
})

describe('buildOgSvg', () => {
  it('集計値を焼き込んだ 1200x630 の SVG を返す', () => {
    const svg = buildOgSvg(summarizePlan(plan()))
    expect(svg).toContain('width="1200" height="630"')
    expect(svg).toContain('7/27(月)の映画はしごプラン')
    expect(svg).toContain('2本はしご')
    expect(svg).toContain('2館をはしご・移動30分・待ち15分')
    expect(svg).toContain('10:30 → 18:45')
  })
  it('1館のときは館数を出さない', () => {
    const p = plan()
    for (const l of p.legs) if (l.kind === 'screening') l.theaterId = 'thr_a'
    expect(buildOgSvg(summarizePlan(p))).toContain('>移動30分・待ち15分<')
  })
})
