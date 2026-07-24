import { describe, expect, it } from 'vitest'
import { stickerDrawtextParams } from './sticker.js'

describe('stickerDrawtextParams', () => {
  it('노란 굵은 글자 + 검정 테두리 스타일과 표시 구간을 만든다', () => {
    const params = stickerDrawtextParams(
      { text: '충격 반전', start: 1, end: 3.5, position: 'center' },
      1920,
    )
    expect(params).toContain('fontcolor=0xFFD400')
    expect(params).toContain('fontsize=58')
    expect(params).toContain('borderw=5')
    expect(params).toContain('bordercolor=black')
    expect(params).toContain('y=(h-text_h)/2')
    expect(params).toContain("enable='between(t,1.000,3.500)'")
  })

  it('top 스티커는 화면 위쪽에 배치한다', () => {
    const params = stickerDrawtextParams({ text: '꿀팁', start: 0, end: 2, position: 'top' }, 1920)
    expect(params).toContain('y=154')
  })

  it('bottom 스티커는 하단 자막 영역 위에 배치한다', () => {
    const params = stickerDrawtextParams({ text: '링크는 프로필에', start: 0, end: 2, position: 'bottom' }, 1920)
    expect(params).toContain('y=h-806')
  })
})
