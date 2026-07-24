import { describe, expect, it } from 'vitest'
import {
  coupangViralPrompt,
  coupangVisionPrompt,
  deliveryPrompt,
  parseCoupangProductInfo,
  parseDeliveryResponse,
  scriptLineRule,
} from './script-prompts.mjs'

describe('narration delivery prompt', () => {
  it('선택한 말투·강도·끝음 규칙을 AI 연출 지시에 포함한다', () => {
    const prompt = deliveryPrompt(['첫 문장.', '두 번째 문장.'], {
      label: '쇼호스트',
      instruction: '밝고 자신감 있게 가격과 혜택을 강조한다.',
      strength: 3,
    })
    expect(prompt).toContain('쇼호스트')
    expect(prompt).toContain('밝고 자신감 있게')
    expect(prompt).toContain('강도 3')
    expect(prompt).toContain('pitch')
    expect(prompt).toContain('gain')
    expect(prompt).toContain('ending')
  })

  it('확장된 AI 응답을 파싱하고 안전 범위로 제한한다', () => {
    const plan = parseDeliveryResponse(
      JSON.stringify([
        { pace: 1.1, pause: 0.2, pitch: 0.7, gain: 1.5, ending: 'crisp' },
        { pace: 4, pause: -1, pitch: -8, gain: 12, ending: 'unknown' },
      ]),
      2,
    )
    expect(plan).toEqual([
      { pace: 1.1, pause: 0.2, pitch: 0.7, gain: 1.5, ending: 'crisp' },
      { pace: 1.25, pause: 0.05, pitch: -2, gain: 3, ending: 'neutral' },
    ])
  })
})

describe('scriptLineRule', () => {
  it('30초 미만은 4~6문장, 기존 구간 경계는 그대로다', () => {
    expect(scriptLineRule(18)).toBe('4~6문장')
    expect(scriptLineRule(29)).toBe('4~6문장')
    expect(scriptLineRule(30)).toBe('6~8문장')
    expect(scriptLineRule(60)).toBe('12~16문장')
    expect(scriptLineRule(120)).toBe('24~30문장')
    expect(scriptLineRule(600)).toBe('110~140문장')
  })
})

describe('coupang viral script prompt', () => {
  it('상품 정보·후킹·구매욕구·CTA 지시를 포함한다', () => {
    const prompt = coupangViralPrompt(
      {
        productName: '접이식 주방 선반',
        benefit: '펼치면 수납 2배',
        painPoint: '좁은 주방',
        pricePoint: '오늘만 40% 할인',
      },
      18,
    )
    expect(prompt).toContain('접이식 주방 선반')
    expect(prompt).toContain('펼치면 수납 2배')
    expect(prompt).toContain('좁은 주방')
    expect(prompt).toContain('40% 할인')
    expect(prompt).toContain('4~6문장')
    expect(prompt).toContain('18초')
    // 후킹·구매 유도 지시
    expect(prompt).toMatch(/후킹|시선/)
    expect(prompt).toMatch(/구매|사고 싶/)
  })

  it('비전 프롬프트는 JSON 필드 추출 지시를 담는다', () => {
    const prompt = coupangVisionPrompt()
    expect(prompt).toContain('productName')
    expect(prompt).toContain('benefit')
    expect(prompt).toContain('painPoint')
    expect(prompt).toContain('pricePoint')
    expect(prompt).toContain('JSON')
  })
})

describe('parseCoupangProductInfo', () => {
  it('코드펜스가 섞인 응답에서도 JSON을 꺼낸다', () => {
    const info = parseCoupangProductInfo(
      '설명입니다.\n```json\n{"productName":"미니 가습기","benefit":"무소음","painPoint":"건조한 방","pricePoint":"9,900원"}\n```',
    )
    expect(info).toEqual({
      productName: '미니 가습기',
      benefit: '무소음',
      painPoint: '건조한 방',
      pricePoint: '9,900원',
    })
  })

  it('JSON이 없으면 null', () => {
    expect(parseCoupangProductInfo('그냥 텍스트')).toBeNull()
  })

  it('일부 필드만 있어도 빈 문자열로 채운다', () => {
    const info = parseCoupangProductInfo('{"productName":"선반"}')
    expect(info).toEqual({ productName: '선반', benefit: '', painPoint: '', pricePoint: '' })
  })
})
