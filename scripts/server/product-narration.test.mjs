import { describe, expect, it } from 'vitest'
import { buildProductNarrationText } from './product-narration.mjs'

describe('buildProductNarrationText', () => {
  it('쇼핑쇼츠용 훅·문제·장점·구매유도 문장을 만든다', () => {
    const text = buildProductNarrationText({
      productName: '접이식 선반',
      painPoint: '좁은 주방 정리가 어려움',
      benefit: '접으면 작고 펼치면 수납공간이 늘어남',
    })

    expect(text).toContain('좁은 주방')
    expect(text).toContain('접이식 선반')
    expect(text).toContain('수납공간')
    expect(text).toMatch(/링크|확인/)
    expect(text.split(/(?<=[.!?])\s+/)).toHaveLength(4)
  })

  it('장점과 불편 포인트가 비어도 자연스러운 기본 문장을 만든다', () => {
    const text = buildProductNarrationText({ productName: '미니 가습기' })
    expect(text).toContain('미니 가습기')
    expect(text).not.toContain('undefined')
  })
})
