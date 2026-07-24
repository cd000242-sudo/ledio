import { describe, expect, it } from 'vitest'
import { CAPTION_STYLES } from '../config/schema.js'
import { captionDrawtextParams } from './captionStyle.js'

describe('captionDrawtextParams', () => {
  it('basic은 기존과 동일한 흰 글자 + 반투명 박스를 유지한다', () => {
    const params = captionDrawtextParams('basic', 'body')
    expect(params).toContain('fontcolor=white')
    expect(params).toContain('box=1')
    expect(params).toContain('boxcolor=black@0.58')
    expect(params).toContain('boxborderw=18')
  })

  it('bold-yellow는 노란 글자와 더 진한 박스를 쓴다', () => {
    const params = captionDrawtextParams('bold-yellow', 'body')
    expect(params).toContain('fontcolor=0xFFD400')
    expect(params).toContain('boxcolor=black@0.72')
  })

  it('clean-white는 박스 없이 글자 테두리만 쓴다', () => {
    const params = captionDrawtextParams('clean-white', 'body')
    expect(params).not.toContain('box=1')
    expect(params).toContain('borderw=4')
    expect(params).toContain('bordercolor=black')
  })

  it('strong-box는 거의 불투명한 박스를 쓴다', () => {
    const params = captionDrawtextParams('strong-box', 'body')
    expect(params).toContain('boxcolor=black@0.85')
  })

  it('공시(disclosure) 자막은 어떤 스타일에서도 차분한 기본형을 유지한다', () => {
    for (const style of CAPTION_STYLES) {
      const params = captionDrawtextParams(style, 'disclosure')
      expect(params).toContain('fontcolor=white')
      expect(params).toContain('boxcolor=black@0.48')
    }
  })
})
