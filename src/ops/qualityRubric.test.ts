import { describe, expect, it } from 'vitest'
import { reviewUploadQuality } from './qualityRubric.js'

describe('quality rubric', () => {
  it('passes when every critical check is satisfied', () => {
    const result = reviewUploadQuality({
      hookClear: true,
      captionReadable: true,
      disclosurePresent: true,
      sourceRiskClear: true,
      platformFit: true,
      packageComplete: true,
    })
    expect(result.level).toBe('pass')
  })

  it('blocks upload when disclosure or source safety is missing', () => {
    const result = reviewUploadQuality({
      hookClear: true,
      captionReadable: true,
      disclosurePresent: false,
      sourceRiskClear: false,
      platformFit: true,
      packageComplete: true,
    })
    expect(result.level).toBe('block')
    expect(result.blockingReasons).toHaveLength(2)
  })

  it('marks non-critical issues for review', () => {
    const result = reviewUploadQuality({
      hookClear: false,
      captionReadable: true,
      disclosurePresent: true,
      sourceRiskClear: true,
      platformFit: false,
      packageComplete: true,
    })
    expect(result.level).toBe('review')
    expect(result.reviewReasons).toHaveLength(2)
  })
})
