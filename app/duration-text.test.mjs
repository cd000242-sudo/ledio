import { describe, expect, it } from 'vitest'
import { durationText } from './duration-text.js'

describe('길이 표기', () => {
  it('분과 초로 적는다', () => {
    expect(durationText(0)).toBe('0분 0초')
    expect(durationText(65_000)).toBe('1분 5초')
  })

  it('59.6초를 60초로 적지 않는다 — "3분 60초"가 화면에 나왔다', () => {
    expect(durationText(239_600)).toBe('4분 0초')
    expect(durationText(59_800)).toBe('1분 0초')
  })

  it('음수는 0으로 본다', () => {
    expect(durationText(-5)).toBe('0분 0초')
  })
})
