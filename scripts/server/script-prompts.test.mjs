import { describe, expect, it } from 'vitest'
import { deliveryPrompt, parseDeliveryResponse } from './script-prompts.mjs'

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
