import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  clickDateTabInPage,
  collectDateTabsInPage,
  enumerateFetchDates,
  readContentSignatureInPage,
  resolveDateUrl,
  selectFetchDates,
} from '../date-tabs'

// 複数日取得（ADR-0019）の日付タブ検出。ページ内関数は document をフェイクにして
// Node 上で直接呼ぶ（jsdom 不要。tsconfig に DOM lib が無いのと同じ前提）。

type FakeEl = { attrs: Record<string, string>; size?: [number, number]; onClick?: () => void }

const fakeDocument = (els: FakeEl[], bodyText = '') => ({
  querySelectorAll: () =>
    els.map((e) => ({
      attributes: Object.values(e.attrs).map((value) => ({ value })),
      getBoundingClientRect: () => ({ width: e.size?.[0] ?? 10, height: e.size?.[1] ?? 10 }),
      click: () => e.onClick?.(),
    })),
  body: { innerText: bodyText },
})

const stub = (doc: unknown) => vi.stubGlobal('document', doc)

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('collectDateTabsInPage', () => {
  it('属性名に依存せず、値が YYYY-MM-DD の属性から日付を収集する（昇順・重複除去）', () => {
    stub(
      fakeDocument([
        { attrs: { class: 'calendar-item', 'data-date': '2026-07-27' } },
        { attrs: { value: '2026-07-25' } }, // 属性名が value でも拾う
        { attrs: { 'data-date': '2026-07-27' } }, // 重複
        { attrs: { id: 'x', 'data-day': '2026-07-26' } },
      ]),
    )
    expect(collectDateTabsInPage()).toEqual(['2026-07-25', '2026-07-26', '2026-07-27'])
  })

  it('日付の部分一致（href に日付を含む等）は拾わない（完全一致のみ）', () => {
    stub(
      fakeDocument([
        { attrs: { href: '/schedule/2026-07-27/' } },
        { attrs: { class: 'calendar-item' } },
        { attrs: { 'data-x': '2026-07-27 10:00' } },
      ]),
    )
    expect(collectDateTabsInPage()).toEqual([])
  })

  it('0×0 の非表示要素は除外する', () => {
    stub(
      fakeDocument([
        { attrs: { 'data-date': '2026-07-25' }, size: [0, 0] },
        { attrs: { 'data-date': '2026-07-26' } },
      ]),
    )
    expect(collectDateTabsInPage()).toEqual(['2026-07-26'])
  })

  it('document が壊れていても例外を投げず空配列を返す', () => {
    stub({
      querySelectorAll: () => {
        throw new Error('boom')
      },
    })
    expect(collectDateTabsInPage()).toEqual([])
  })
})

describe('clickDateTabInPage', () => {
  it('一致する日付の要素をクリックして true を返す', () => {
    const hit = vi.fn()
    const miss = vi.fn()
    stub(
      fakeDocument([
        { attrs: { 'data-date': '2026-07-25' }, onClick: miss },
        { attrs: { 'data-date': '2026-07-26' }, onClick: hit },
      ]),
    )
    expect(clickDateTabInPage('2026-07-26')).toBe(true)
    expect(hit).toHaveBeenCalledTimes(1)
    expect(miss).not.toHaveBeenCalled()
  })

  it('一致が無ければ false を返し、誰もクリックしない', () => {
    const any = vi.fn()
    stub(fakeDocument([{ attrs: { 'data-date': '2026-07-25' }, onClick: any }]))
    expect(clickDateTabInPage('2026-08-01')).toBe(false)
    expect(any).not.toHaveBeenCalled()
  })
})

describe('readContentSignatureInPage', () => {
  it('同一本文で同値・1文字違いで別値になる', () => {
    stub(fakeDocument([], '10:00 A 12:00 B'))
    const a = readContentSignatureInPage()
    stub(fakeDocument([], '10:00 A 12:00 B'))
    expect(readContentSignatureInPage()).toBe(a)
    stub(fakeDocument([], '10:00 A 12:00 C'))
    expect(readContentSignatureInPage()).not.toBe(a)
  })

  it('body が null でも例外を投げない', () => {
    stub({ querySelectorAll: () => [], body: null })
    expect(typeof readContentSignatureInPage()).toBe('string')
  })
})

describe('selectFetchDates', () => {
  it('当日より前の日付は必ず落とす（洗い替え範囲が過去へ広がり履歴を消すため）', () => {
    const got = selectFetchDates(['2026-07-23', '2026-07-24', '2026-07-25'], 5, '2026-07-25')
    expect(got).toEqual(['2026-07-25'])
  })

  it('days=0 は上限（MAX_FETCH_DAYS=10）まで全件', () => {
    const found = Array.from({ length: 14 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
    expect(selectFetchDates(found, 0, '2026-08-01')).toHaveLength(10)
  })

  it('days=3 は先頭3件（未ソート入力でも昇順・重複除去）', () => {
    const got = selectFetchDates(
      ['2026-07-27', '2026-07-25', '2026-07-26', '2026-07-25', '2026-07-28'],
      3,
      '2026-07-25',
    )
    expect(got).toEqual(['2026-07-25', '2026-07-26', '2026-07-27'])
  })

  it('上限超えの days は MAX_FETCH_DAYS でクランプ・空入力は空', () => {
    const found = Array.from({ length: 14 }, (_, i) => `2026-08-${String(i + 1).padStart(2, '0')}`)
    expect(selectFetchDates(found, 99, '2026-08-01')).toHaveLength(10)
    expect(selectFetchDates([], 3, '2026-08-01')).toEqual([])
  })
})

describe('enumerateFetchDates', () => {
  it('当日から N 日分を列挙する（月跨ぎ対応）', () => {
    expect(enumerateFetchDates('2026-07-30', 3)).toEqual(['2026-07-30', '2026-07-31', '2026-08-01'])
    expect(enumerateFetchDates('2026-07-25', 1)).toEqual(['2026-07-25'])
  })

  it('上限・下限をクランプする', () => {
    expect(enumerateFetchDates('2026-07-25', 99)).toHaveLength(10)
    expect(enumerateFetchDates('2026-07-25', 0)).toEqual(['2026-07-25'])
  })
})

describe('resolveDateUrl', () => {
  it('{date} を置換する（複数箇所・プレースホルダ無しはそのまま）', () => {
    expect(resolveDateUrl('http://e.com/s?d={date}', '2026-07-25')).toBe(
      'http://e.com/s?d=2026-07-25',
    )
    expect(resolveDateUrl('http://e.com/{date}/x/{date}', '2026-07-25')).toBe(
      'http://e.com/2026-07-25/x/2026-07-25',
    )
    expect(resolveDateUrl('http://e.com/s', '2026-07-25')).toBe('http://e.com/s')
  })
})
