import { describe, it, expect } from 'vitest'
import { wrapText } from './text.js'

describe('wrapText', () => {
  it('짧은 문장은 한 줄로 둔다', () => {
    expect(wrapText('좁은 주방', 18)).toBe('좁은 주방')
  })

  it('긴 문장을 maxPerLine 기준으로 줄바꿈한다', () => {
    const out = wrapText('좁은 주방 쓰는 사람은 이 장면 보면 바로 이해합니다', 10)
    const lines = out.split('\n')
    expect(lines.length).toBeGreaterThan(1)
    for (const line of lines) {
      expect([...line].length).toBeLessThanOrEqual(10)
    }
  })

  it('공백 없는 긴 단어를 강제로 끊는다', () => {
    const out = wrapText('가나다라마바사아자차카타', 5)
    for (const line of out.split('\n')) {
      expect([...line].length).toBeLessThanOrEqual(5)
    }
  })

  it('어떤 글자도 잃지 않는다', () => {
    const input = '좁은 주방 쓰는 사람은 바로 이해합니다'
    const out = wrapText(input, 8).replace(/\n/g, ' ')
    expect(out).toBe(input)
  })
})
