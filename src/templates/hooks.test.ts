import { describe, it, expect } from 'vitest'
import { fillHook, buildHooks, HOOK_TEMPLATES, reviewHooks } from './hooks.js'
import type { Product } from '../config/schema.js'

const product: Product = {
  name: '접이식 싱크대 선반',
  category: '주방 수납',
  priceRange: '10000-30000',
  affiliateUrl: 'https://example.com/p',
  painPoint: '싱크대 주변 정리',
  benefit: '물 빠짐 공간이 생김',
}

describe('fillHook', () => {
  it('replaces a placeholder', () => {
    expect(fillHook('좁은 {공간} 정리', { 공간: '주방' })).toBe('좁은 주방 정리')
  })

  it('replaces multiple placeholders', () => {
    expect(fillHook('{공간}/{문제상황}', { 공간: '주방', 문제상황: '정리' })).toBe('주방/정리')
  })

  it('keeps unknown placeholders visible', () => {
    expect(fillHook('{미정}', {})).toBe('{미정}')
  })
})

describe('buildHooks', () => {
  it('creates the requested number of hooks', () => {
    expect(buildHooks(product, 5)).toHaveLength(5)
  })

  it('uses the first category token as space context', () => {
    const hooks = buildHooks(product, 5)
    expect(hooks[0]).toContain('주방')
    expect(hooks[0]).not.toContain('{공간}')
  })

  it('uses painPoint as problem context', () => {
    const hooks = buildHooks(product, 5)
    expect(hooks[1]).toContain('싱크대 주변 정리')
  })

  it('cycles when count is larger than template count', () => {
    const hooks = buildHooks(product, HOOK_TEMPLATES.length + 1)
    expect(hooks).toHaveLength(HOOK_TEMPLATES.length + 1)
    expect(hooks[HOOK_TEMPLATES.length]).toBe(hooks[0])
  })

  it('does not leave unresolved placeholders in generated hooks', () => {
    for (const hook of buildHooks(product, 5)) {
      expect(hook).not.toMatch(/\{[^}]+\}/)
    }
  })
})

describe('reviewHooks', () => {
  it('reports duplicate hooks', () => {
    const review = reviewHooks(['같은 훅', '다른 훅', '같은 훅'])
    expect(review.duplicates).toEqual(['같은 훅'])
  })

  it('reports hooks above the length limit', () => {
    const review = reviewHooks(['짧은 훅', '이 문장은 길이 제한을 넘기기 위한 훅입니다'], 12)
    expect(review.tooLong).toHaveLength(1)
  })
})
