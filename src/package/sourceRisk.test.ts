import { describe, expect, it } from 'vitest'
import { projectSchema, type Project } from '../config/schema.js'
import { assessSourceRisk, buildSourceRiskReport } from './sourceRisk.js'

function project(): Project {
  return projectSchema.parse({
    projectName: 'risk-test',
    product: {
      name: '상품',
      category: '생활용품',
      priceRange: '10000-30000',
      affiliateUrl: 'https://example.com/product',
      painPoint: '불편함',
      benefit: '정리됨',
    },
    disclosure: { type: 'affiliate', text: '제휴 고지' },
    style: {
      duration: 20,
      ratio: '9:16',
      resolution: '1080x1920',
      tone: 'friendly',
      captionPosition: 'bottom',
      bgmVolume: 0.2,
    },
    clips: [{ file: 'clips/hook.mp4', role: 'hook', start: 0, end: 2 }],
    variants: { count: 1 },
    sources: [
      { title: '직접 촬영', file: 'clips/hook.mp4', rights: 'owned', usage: 'edit' },
      {
        title: '경쟁 쇼츠',
        url: 'https://example.com/short',
        rights: 'reference_only',
        usage: 'reference',
      },
      {
        title: '권리 미확인 영상',
        url: 'https://example.com/video',
        rights: 'unknown',
        usage: 'edit',
      },
    ],
  })
}

describe('source risk', () => {
  it('marks editable owned sources as safe', () => {
    expect(
      assessSourceRisk({
        title: '직접 촬영',
        file: 'clips/a.mp4',
        rights: 'owned',
        usage: 'edit',
      }).level,
    ).toBe('safe')
  })

  it('marks reference-only material used for editing as risk', () => {
    const risk = assessSourceRisk({
      title: '참고 전용 영상',
      url: 'https://example.com/video',
      rights: 'reference_only',
      usage: 'edit',
    })
    expect(risk.level).toBe('risk')
    expect(risk.reason).toContain('참고 전용')
  })

  it('summarizes project source risk', () => {
    const report = buildSourceRiskReport(project())
    expect(report.summary.safe).toBe(2)
    expect(report.summary.caution).toBe(1)
    expect(report.summary.risk).toBe(0)
  })
})
