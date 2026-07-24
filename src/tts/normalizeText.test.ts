import { describe, expect, it } from 'vitest'
import { normalizeTtsText, numberToSinoKorean } from './normalizeText.js'

describe('numberToSinoKorean', () => {
  it('기본 숫자를 한자어 읽기로 바꾼다', () => {
    expect(numberToSinoKorean(1103)).toBe('천백삼')
    expect(numberToSinoKorean(205)).toBe('이백오')
    expect(numberToSinoKorean(1000)).toBe('천')
    expect(numberToSinoKorean(10000)).toBe('만')
    expect(numberToSinoKorean(21)).toBe('이십일')
    expect(numberToSinoKorean(70000)).toBe('칠만')
  })
})

describe('normalizeTtsText (TTS 오독 방지)', () => {
  it('호/동/층 같은 단위 앞 숫자를 한국어로 바꾼다', () => {
    expect(normalizeTtsText('1103호로 들어갔다')).toBe('천백삼 호로 들어갔다')
    expect(normalizeTtsText('205동 1102호')).toBe('이백오 동 천백이 호')
    expect(normalizeTtsText('11층 복도')).toBe('십일 층 복도')
  })

  it('시각 표현은 건드리지 않는다', () => {
    expect(normalizeTtsText('새벽 2시 17분이었다')).toBe('새벽 2시 17분이었다')
  })

  it('단위 없는 큰 숫자도 한국어로 바꾼다', () => {
    expect(normalizeTtsText('가격은 15000원이었다')).toBe('가격은 만오천 원이었다')
  })

  it('한두 자리 일반 숫자는 그대로 둔다', () => {
    expect(normalizeTtsText('사과 3개를 샀다')).toBe('사과 3개를 샀다')
  })
})
