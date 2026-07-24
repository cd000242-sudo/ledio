import { describe, expect, it } from 'vitest'
import { splitNarrationText } from './chunk.js'

describe('splitNarrationText (낭독 분할)', () => {
  it('짧은 텍스트는 그대로 한 덩어리', () => {
    expect(splitNarrationText('안녕하세요. 반갑습니다.')).toEqual(['안녕하세요. 반갑습니다.'])
  })

  it('긴 텍스트는 문장 경계에서 maxChars 이하 덩어리로 나눈다', () => {
    const text = '첫 번째 문장입니다. 두 번째 문장입니다. 세 번째 문장입니다. 네 번째 문장입니다.'
    const chunks = splitNarrationText(text, 30)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(40)
    expect(chunks.join(' ')).toBe(text)
  })

  it('한 문장이 maxChars보다 길어도 문장은 쪼개지 않는다', () => {
    const long = '이 문장은 아주아주 길어서 최대 글자 수를 혼자서 훌쩍 넘어버리는 문장입니다.'
    expect(splitNarrationText(long, 10)).toEqual([long])
  })
})
