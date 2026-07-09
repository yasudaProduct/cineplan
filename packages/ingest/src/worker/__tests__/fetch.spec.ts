import { describe, expect, it } from 'vitest'
import { extractScheduleImageUrls } from '../fetch'

describe('extractScheduleImageUrls', () => {
  const base = 'http://www.cinenouveau.com/schedule/schedule1.html'

  it('image/schedule 配下の画像だけを絶対URL化して抽出', () => {
    const html = `
      <img src="../image/logo.gif">
      <img src="../image/schedule/202607.gif">
      <img src='../image/schedule/202607sche4.gif'>
      <img src="../image/ticketlogo.gif">
    `
    expect(extractScheduleImageUrls(html, base)).toEqual([
      'http://www.cinenouveau.com/image/schedule/202607.gif',
      'http://www.cinenouveau.com/image/schedule/202607sche4.gif',
    ])
  })

  it('重複は除去', () => {
    const html = `<img src="../image/schedule/a.gif"><img src="../image/schedule/a.gif">`
    expect(extractScheduleImageUrls(html, base)).toHaveLength(1)
  })

  it('該当画像が無ければ空配列', () => {
    expect(extractScheduleImageUrls('<img src="../image/logo.gif">', base)).toEqual([])
  })
})
