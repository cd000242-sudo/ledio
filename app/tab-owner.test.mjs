import { describe, expect, it } from 'vitest'
import { claimTab, ownsTab } from './tab-owner.js'

const fakeContainer = () => ({ dataset: {} })

describe('탭 화면 주인 표시', () => {
  it('탭을 차지하면 그 탭이 주인이 된다', () => {
    const container = fakeContainer()
    claimTab(container, 'autoedit')
    expect(ownsTab(container, 'autoedit')).toBe(true)
  })

  it('다른 탭으로 넘어가면 이전 탭은 더 이상 주인이 아니다 — 늦게 온 응답이 남의 화면을 덮으면 안 된다', () => {
    const container = fakeContainer()
    claimTab(container, 'autoedit')
    claimTab(container, 'captions')
    expect(ownsTab(container, 'autoedit')).toBe(false)
    expect(ownsTab(container, 'captions')).toBe(true)
  })

  it('아무도 차지하지 않은 곳에는 그리지 않는다', () => {
    expect(ownsTab(fakeContainer(), 'autoedit')).toBe(false)
  })

  it('컨테이너가 없어도 터지지 않는다', () => {
    expect(ownsTab(null, 'autoedit')).toBe(false)
    expect(() => claimTab(null, 'autoedit')).not.toThrow()
  })
})
