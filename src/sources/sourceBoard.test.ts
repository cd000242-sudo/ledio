import { describe, expect, it } from 'vitest'
import { classifyCandidateUrl, presetSource, traceSource } from './sourceBoard.js'

describe('source board', () => {
  it('creates safe owned clip sources from a preset', () => {
    const source = presetSource('owned_clip', '직접 촬영 훅', 'clips/hook.mp4')
    expect(source.rights).toBe('owned')
    expect(source.usage).toBe('edit')
    expect(traceSource(source).level).toBe('safe')
  })

  it('keeps short-form URLs as reference-only by default', () => {
    const classified = classifyCandidateUrl('https://www.youtube.com/shorts/example')
    expect(classified.preset).toBe('reference_short')
    expect(classified.rights).toBe('reference_only')
    expect(classified.usage).toBe('reference')
  })

  it('classifies market URLs as product-page references', () => {
    const classified = classifyCandidateUrl('https://smartstore.naver.com/example/products/1')
    expect(classified.preset).toBe('product_page')
    expect(classified.usage).toBe('reference')
  })

  it('escalates reference-only material when used as an edit source', () => {
    const trace = traceSource({
      title: '경쟁 쇼츠 원본',
      url: 'https://www.tiktok.com/@brand/video/1',
      rights: 'reference_only',
      usage: 'edit',
    })
    expect(trace.level).toBe('risk')
    expect(trace.action).toBe('편집 소스에서 제외')
  })
})
