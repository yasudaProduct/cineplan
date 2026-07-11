import type { Plan, ScreeningLeg } from '@cinema/shared'
import { describe, expect, it } from 'vitest'
import { googleCalendarUrl, toCalendarUtc } from '../calendar'
import { buildIcs } from '../ics'
import { applyRelaxSuggestion, shiftHHMM } from '../relax'
import { addDaysJst, formatDuration, isLateNight, jstTime, minutesBetween } from '../time'

const screening = (over: Partial<ScreeningLeg> = {}): ScreeningLeg => ({
  kind: 'screening',
  theaterId: 'thr_a',
  theaterName: 'シネ・ヌーヴォ',
  movieId: 'mov_1',
  movieTitle: 'ニッポン狂想曲',
  format: null,
  startAt: '2026-07-15T01:00:00.000Z', // 10:00 JST
  endAt: '2026-07-15T03:10:00.000Z', // 12:10 JST
  officialUrl: 'http://www.cinenouveau.com/',
  ...over,
})

describe('time（JST 表示）', () => {
  it('UTC ISO を JST HH:mm に変換する', () => {
    expect(jstTime('2026-07-15T01:00:00.000Z')).toBe('10:00')
    expect(jstTime('2026-07-15T16:10:00.000Z')).toBe('01:10') // 深夜（翌1:10 JST）
  })
  it('終電バッジは JST 23時以降の終了で立つ（docs/05 §5）', () => {
    expect(isLateNight('2026-07-15T14:30:00.000Z')).toBe(true) // 23:30 JST
    expect(isLateNight('2026-07-15T13:00:00.000Z')).toBe(false) // 22:00 JST
  })
  it('minutesBetween / formatDuration', () => {
    expect(minutesBetween('2026-07-15T01:00:00.000Z', '2026-07-15T03:10:00.000Z')).toBe(130)
    expect(formatDuration(130)).toBe('2時間10分')
    expect(formatDuration(120)).toBe('2時間')
    expect(formatDuration(45)).toBe('45分')
  })
  it('addDaysJst は JST 基準で翌日を返す', () => {
    expect(addDaysJst('2026-07-31', 1)).toBe('2026-08-01')
  })
})

describe('calendar（Google render URL・F-10/ADR-0008）', () => {
  it('UTC 形式に変換する（ミリ秒除去・区切り除去）', () => {
    expect(toCalendarUtc('2026-07-15T01:00:00.000Z')).toBe('20260715T010000Z')
    expect(toCalendarUtc('2026-07-15T01:00:00Z')).toBe('20260715T010000Z')
  })
  it('render URL に text/dates/location を含む', () => {
    const url = new URL(googleCalendarUrl(screening()))
    expect(url.origin + url.pathname).toBe('https://calendar.google.com/calendar/render')
    expect(url.searchParams.get('action')).toBe('TEMPLATE')
    expect(url.searchParams.get('text')).toBe('🎬 ニッポン狂想曲')
    expect(url.searchParams.get('dates')).toBe('20260715T010000Z/20260715T031000Z')
    expect(url.searchParams.get('location')).toBe('シネ・ヌーヴォ')
    expect(url.searchParams.get('details')).toContain('公式')
  })
})

describe('ics（クライアント生成・F-11）', () => {
  const plan: Plan = {
    label: 'most_movies',
    stats: {
      movieCount: 2,
      totalTravelMin: 5,
      totalWaitMin: 10,
      endTime: '2026-07-15T08:00:00.000Z',
    },
    legs: [
      {
        kind: 'travel',
        fromTheaterId: null,
        toTheaterId: 'thr_a',
        departAt: '2026-07-15T00:40:00.000Z',
        arriveAt: '2026-07-15T00:45:00.000Z',
        durationMin: 5,
        summary: null,
      },
      screening(),
      { kind: 'wait', minutes: 10 },
      screening({ movieId: 'mov_2', movieTitle: '作品; カンマ, 改行' }),
    ],
  }

  it('screening の数だけ VEVENT を含み、travel/wait は含まない', () => {
    const ics = buildIcs(plan, '2026-07-12T00:00:00.000Z')
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2)
    expect(ics).toContain('DTSTART:20260715T010000Z')
    expect(ics).toContain('SUMMARY:🎬 ニッポン狂想曲')
  })
  it('特殊文字（; , \\n）をエスケープし CRLF 改行で出力する', () => {
    const ics = buildIcs(plan, '2026-07-12T00:00:00.000Z')
    expect(ics).toContain('作品\\; カンマ\\,')
    expect(ics).toContain('\r\n')
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
  })
})

describe('relax（緩和提案のワンタップ適用・F-09）', () => {
  const base = {
    timeStart: '09:00',
    timeEnd: '22:00',
    mustMovieIds: ['mov_1'],
    arrivalMarginMin: 15,
    destEnabled: true,
  }

  it('widen_time_window は前後1時間広げる（00:00/23:59 でクランプ）', () => {
    expect(applyRelaxSuggestion(base, 'widen_time_window')).toMatchObject({
      timeStart: '08:00',
      timeEnd: '23:00',
    })
    expect(shiftHHMM('00:30', -60)).toBe('00:00')
    expect(shiftHHMM('23:30', 60)).toBe('23:59')
  })
  it('drop_must_movie はマストを空にする', () => {
    expect(applyRelaxSuggestion(base, 'drop_must_movie').mustMovieIds).toEqual([])
  })
  it('increase_margin_tolerance はマージンを5分にする', () => {
    expect(applyRelaxSuggestion(base, 'increase_margin_tolerance').arrivalMarginMin).toBe(5)
  })
  it('remove_destination はゴール指定を外す', () => {
    expect(applyRelaxSuggestion(base, 'remove_destination').destEnabled).toBe(false)
  })
})
