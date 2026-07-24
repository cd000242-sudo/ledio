import { describe, expect, it } from 'vitest'
import {
  coupangViralPrompt,
  coupangVisionPrompt,
  deliveryPrompt,
  parseCoupangProductInfo,
  parseDeliveryResponse,
  parseRemixMatch,
  parseSourceClipInfo,
  remixMatchPrompt,
  scriptLineRule,
  sourceClipVisionPrompt,
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

describe('source clip vision (리믹스 소스 분석)', () => {
  it('비전 프롬프트는 설명·자막 유무·자막 영역 JSON 지시를 담는다', () => {
    const prompt = sourceClipVisionPrompt()
    expect(prompt).toContain('description')
    expect(prompt).toContain('hasSubtitles')
    expect(prompt).toContain('subtitleBand')
    expect(prompt).toContain('JSON')
  })

  it('정상 응답을 파싱하고 밴드를 0~1로 클램프한다', () => {
    const info = parseSourceClipInfo(
      '```json\n{"description":"제품을 손으로 펼치는 장면","hasSubtitles":true,"subtitleBand":{"top":0.82,"bottom":1.4}}\n```',
    )
    expect(info?.description).toBe('제품을 손으로 펼치는 장면')
    expect(info?.subtitleBand).toEqual({ top: 0.82, bottom: 1 })
  })

  it('자막 없음·역전·과대 밴드는 null 밴드로 처리한다', () => {
    expect(parseSourceClipInfo('{"description":"장면","hasSubtitles":false}')?.subtitleBand).toBeNull()
    expect(
      parseSourceClipInfo('{"description":"장면","hasSubtitles":true,"subtitleBand":{"top":0.9,"bottom":0.5}}')
        ?.subtitleBand,
    ).toBeNull()
    expect(
      parseSourceClipInfo('{"description":"장면","hasSubtitles":true,"subtitleBand":{"top":0.1,"bottom":0.9}}')
        ?.subtitleBand,
    ).toBeNull()
    expect(parseSourceClipInfo('그냥 텍스트')).toBeNull()
  })
})

describe('remix match (문장↔소스 매칭)', () => {
  it('매칭 프롬프트는 문장과 소스 설명을 번호로 나열한다', () => {
    const prompt = remixMatchPrompt(
      ['좁은 주방 고민이시죠?', '이 선반이 해결합니다.'],
      ['주방에서 요리하는 장면', '선반을 펼치는 장면'],
    )
    expect(prompt).toContain('좁은 주방')
    expect(prompt).toContain('선반을 펼치는')
    expect(prompt).toContain('JSON')
  })

  it('정상 배열을 파싱하고 범위 밖 인덱스는 라운드로빈으로 대체한다', () => {
    expect(parseRemixMatch('[1,0,7]', 3, 2)).toEqual([1, 0, 0])
    expect(parseRemixMatch('설명\n```\n[0,1]\n```', 2, 2)).toEqual([0, 1])
  })

  it('길이가 모자라면 라운드로빈으로 채우고, JSON이 없으면 null', () => {
    expect(parseRemixMatch('[1]', 3, 2)).toEqual([1, 1, 0])
    expect(parseRemixMatch('없음', 2, 2)).toBeNull()
  })
})
