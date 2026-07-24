import { describe, expect, it } from 'vitest'
import { buildDeliveryChunks, buildDeliveryChunksForTexts } from './delivery.js'

const TEXT = '평범한 밤이었다. 그런데 소리가 났다. 문이 열린다. 발소리가 다가온다. 그리고 멈춘다.'

describe('buildDeliveryChunks (낭독 연출 계획 → TTS 조각)', () => {
  it('같은 페이스의 연속 문장은 한 조각으로 묶고, 조각의 쉼은 마지막 문장 것을 쓴다', () => {
    const plan = [
      { pace: 1, pause: 0.3 },
      { pace: 1, pause: 0.5 },
      { pace: 1.1, pause: 0.15 },
      { pace: 1.1, pause: 0.15 },
      { pace: 1.1, pause: 0.6 },
    ]
    const chunks = buildDeliveryChunks(TEXT, plan)
    expect(chunks).toHaveLength(2)
    expect(chunks[0]).toEqual({ text: '평범한 밤이었다. 그런데 소리가 났다.', pace: 1, pauseAfter: 0.5 })
    expect(chunks[1]).toEqual({
      text: '문이 열린다. 발소리가 다가온다. 그리고 멈춘다.',
      pace: 1.1,
      pauseAfter: 0.6,
    })
  })

  it('페이스가 같아도 글자 수 한도를 넘으면 조각을 나눈다', () => {
    const plan = Array.from({ length: 5 }, () => ({ pace: 1, pause: 0.25 }))
    const chunks = buildDeliveryChunks(TEXT, plan, 25)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) expect([...chunk.text].length).toBeLessThanOrEqual(25)
    expect(chunks.map((c) => c.text).join(' ')).toBe(TEXT)
  })

  it('계획이 문장 수보다 짧으면 나머지는 기본값(1.0, 0.25)을 쓴다', () => {
    const chunks = buildDeliveryChunks(TEXT, [{ pace: 1.2, pause: 0.1 }])
    expect(chunks[0]?.pace).toBe(1.2)
    expect(chunks.at(-1)?.pace).toBe(1)
    expect(chunks.at(-1)?.pauseAfter).toBe(0.25)
  })

  it('극단값은 안전 범위로 잘라낸다', () => {
    const plan = [
      { pace: 3, pause: 9 },
      { pace: 0.1, pause: -1 },
      { pace: 1, pause: 0.25 },
      { pace: 1, pause: 0.25 },
      { pace: 1, pause: 0.25 },
    ]
    const chunks = buildDeliveryChunks(TEXT, plan)
    expect(chunks[0]?.pace).toBeLessThanOrEqual(1.25)
    expect(chunks[0]?.pauseAfter).toBeLessThanOrEqual(1)
    expect(chunks[1]?.pace).toBeGreaterThanOrEqual(0.8)
  })

  it('계획이 없으면 기본 페이스 한 덩어리 흐름과 같다', () => {
    const chunks = buildDeliveryChunks(TEXT, [])
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ text: TEXT, pace: 1, pauseAfter: 0.25 })
  })

  it('피치·강도·끝음 지시를 보존하고 끝음 처리가 있으면 문장별 조각을 유지한다', () => {
    const chunks = buildDeliveryChunks('첫 문장입니다. 두 번째인가요?', [
      { pace: 1.05, pause: 0.15, pitch: 0.6, gain: 1.2, ending: 'crisp' },
      { pace: 0.95, pause: 0.4, pitch: 0.2, gain: 0, ending: 'rise' },
    ])

    expect(chunks).toEqual([
      { text: '첫 문장입니다.', pace: 1.05, pauseAfter: 0.15, pitch: 0.6, gain: 1.2, ending: 'crisp' },
      { text: '두 번째인가요?', pace: 0.95, pauseAfter: 0.4, pitch: 0.2, gain: 0, ending: 'rise' },
    ])
  })

  it('확장 연출 값도 안전 범위로 제한한다', () => {
    const [chunk] = buildDeliveryChunks('과한 설정입니다.', [
      { pace: 9, pause: 9, pitch: 8, gain: 20, ending: 'invalid' },
    ])
    expect(chunk).toMatchObject({ pace: 1.25, pauseAfter: 1, pitch: 2, gain: 3, ending: 'neutral' })
  })

  it('스토리보드 장면별 텍스트에도 문장 계획을 순서대로 묶어 적용한다', () => {
    const chunks = buildDeliveryChunksForTexts(
      ['첫 문장입니다. 두 번째 문장입니다.', '마지막인가요?'],
      [
        { pace: 1.1, pause: 0.1, pitch: 0.4, gain: 1, ending: 'crisp' },
        { pace: 0.9, pause: 0.5, pitch: -0.2, gain: 0, ending: 'fall' },
        { pace: 1.05, pause: 0.2, pitch: 0.6, gain: 0.5, ending: 'rise' },
      ],
    )

    expect(chunks).toEqual([
      {
        text: '첫 문장입니다. 두 번째 문장입니다.',
        pace: 1,
        pauseAfter: 0.5,
        pitch: 0.1,
        gain: 0.5,
        ending: 'fall',
      },
      {
        text: '마지막인가요?',
        pace: 1.05,
        pauseAfter: 0.2,
        pitch: 0.6,
        gain: 0.5,
        ending: 'rise',
      },
    ])
  })
})
