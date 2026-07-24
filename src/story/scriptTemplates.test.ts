import { describe, expect, it } from 'vitest'
import {
  STORY_TEMPLATES,
  buildScriptSkeleton,
  listScriptTemplates,
} from './scriptTemplates.js'

describe('scriptTemplates', () => {
  it('5개 유형을 제공한다', () => {
    expect(listScriptTemplates()).toHaveLength(5)
    expect(listScriptTemplates().map((t) => t.key)).toEqual([
      'twist',
      'empathy',
      'info',
      'confession',
      'compare',
    ])
  })

  it('모든 템플릿은 hook/build/twist/cta 4비트를 가진다', () => {
    for (const template of STORY_TEMPLATES) {
      expect(template.beats.hook.length).toBeGreaterThan(0)
      expect(template.beats.build.length).toBeGreaterThan(0)
      expect(template.beats.twist.length).toBeGreaterThan(0)
      expect(template.beats.cta.length).toBeGreaterThan(0)
    }
  })

  it('주제를 넣으면 자리표시자가 채워진 대본 뼈대가 나온다', () => {
    const script = buildScriptSkeleton('twist', { 주제: '한밤의 택배' })
    expect(script).toContain('한밤의 택배')
    expect(script).not.toContain('{주제}')
    // 비트 순서 유지: 문단(줄) 여러 개
    expect(script.split('\n').filter(Boolean).length).toBeGreaterThanOrEqual(4)
  })

  it('없는 유형이면 명확히 실패한다', () => {
    expect(() => buildScriptSkeleton('nope', {})).toThrow('알 수 없는 대본 유형')
  })

  it('채우지 않은 자리표시자는 그대로 남겨 사용자가 볼 수 있게 한다', () => {
    const script = buildScriptSkeleton('compare', {})
    expect(script).toMatch(/\{[^}]+\}/)
  })
})
