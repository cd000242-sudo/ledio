import { describe, expect, it } from 'vitest'
import {
  NARRATION_STYLES,
  buildPresetDeliveryPlan,
  resolveNarrationStyle,
} from './narration-styles.mjs'

describe('narration styles', () => {
  it('대표 말투와 직접 입력을 포함한 충분한 프리셋을 제공한다', () => {
    expect(NARRATION_STYLES.length).toBeGreaterThanOrEqual(22)
    expect(new Set(NARRATION_STYLES.map((style) => style.id)).size).toBe(NARRATION_STYLES.length)
    expect(NARRATION_STYLES.map((style) => style.id)).toEqual(
      expect.arrayContaining(['natural', 'shopping-host', 'live-commerce', 'premium-ad', 'news', 'audiobook', 'custom']),
    )
  })

  it('각 프리셋은 UI 설명과 실제 음성 처리 기본값을 가진다', () => {
    for (const style of NARRATION_STYLES) {
      expect(style.label.length).toBeGreaterThan(1)
      expect(style.group.length).toBeGreaterThan(1)
      expect(style.description.length).toBeGreaterThan(4)
      expect(style.instruction.length).toBeGreaterThan(4)
      expect(style.defaults.pace).toBeGreaterThanOrEqual(0.8)
      expect(style.defaults.pace).toBeLessThanOrEqual(1.25)
      expect(style.defaults.pause).toBeGreaterThanOrEqual(0.05)
      expect(style.defaults.pause).toBeLessThanOrEqual(1)
      expect(['neutral', 'fall', 'soft-fall', 'rise', 'crisp', 'linger']).toContain(style.defaults.ending)
    }
  })

  it('직접 입력은 사용자 지시를 보존하고 안전한 기본값을 사용한다', () => {
    const style = resolveNarrationStyle('custom', '친근하지만 마지막 구매 문구는 단호하게')
    expect(style.id).toBe('custom')
    expect(style.instruction).toContain('마지막 구매 문구는 단호하게')
    expect(style.defaults.pace).toBe(1)
  })

  it('알 수 없는 스타일은 자연스러운 낭독으로 안전하게 대체한다', () => {
    expect(resolveNarrationStyle('not-found').id).toBe('natural')
  })

  it('강도에 따라 안전 범위 안에서 문장별 연출 계획을 만든다', () => {
    const sentences = ['지금 보세요.', '오늘만 이 가격입니다!', '자세한 내용은 링크에서 확인하세요.']
    const weak = buildPresetDeliveryPlan(sentences, 'shopping-host', 1)
    const strong = buildPresetDeliveryPlan(sentences, 'shopping-host', 3)

    expect(weak).toHaveLength(sentences.length)
    expect(strong).toHaveLength(sentences.length)
    expect(strong[0].pace).toBeGreaterThanOrEqual(weak[0].pace)
    expect(strong.at(-1).ending).toBe('crisp')
    for (const step of strong) {
      expect(step.pace).toBeGreaterThanOrEqual(0.8)
      expect(step.pace).toBeLessThanOrEqual(1.25)
      expect(step.pause).toBeGreaterThanOrEqual(0.05)
      expect(step.pause).toBeLessThanOrEqual(1)
      expect(step.pitch).toBeGreaterThanOrEqual(-2)
      expect(step.pitch).toBeLessThanOrEqual(2)
      expect(step.gain).toBeGreaterThanOrEqual(-3)
      expect(step.gain).toBeLessThanOrEqual(3)
    }
  })
})
