import { describe, expect, it } from 'vitest'
import { projectSchema, type Project } from '../config/schema.js'
import {
  buildHashtags,
  buildPerformanceRows,
  buildPublishPlan,
  publishPlanSchema,
  serializePerformanceCsv,
  validatePublishPlan,
  type RenderReport,
} from './publishPlan.js'
import { getPlatformProfile } from '../platforms/profiles.js'

function project(): Project {
  return projectSchema.parse({
    projectName: 'kitchen-shelf-001',
    product: {
      name: '접이식 싱크대 선반',
      category: '주방 수납',
      priceRange: '10000-30000',
      affiliateUrl: 'https://example.com/product',
      painPoint: '좁은 싱크대에서 컵과 접시를 둘 곳이 없음',
      benefit: '접으면 작고 펼치면 물 빠짐 공간이 생김',
    },
    disclosure: {
      type: 'affiliate',
      text: '이 콘텐츠는 제휴 링크를 포함합니다.',
    },
    style: {
      duration: 25,
      ratio: '9:16',
      resolution: '1080x1920',
      tone: 'friendly',
      captionPosition: 'bottom',
      bgmVolume: 0.18,
    },
    clips: [{ file: 'clips/hook.mp4', role: 'hook', start: 0, end: 2.5 }],
    variants: { count: 2 },
    publish: {
      campaignName: 'kitchen-test',
      platforms: ['youtube_shorts', 'tiktok'],
      hashtags: ['#주방 수납', '살림템'],
      cta: '상세 정보는 링크에서 확인하세요.',
    },
  })
}

const report: RenderReport = {
  projectName: 'kitchen-shelf-001',
  generatedAt: '2026-06-23T00:00:00.000Z',
  resolution: '1080x1920',
  fps: 30,
  timelineDurationSec: 25,
  variantCount: 2,
  variants: [
    { file: 'video_01.mp4', hook: '좁은 주방 정리가 필요하다면 이 장면부터 보세요' },
    { file: 'video_02.mp4', hook: '접이식 선반 하나로 물 빠짐 공간이 생깁니다' },
  ],
}

describe('publish plan', () => {
  it('creates upload items for every render variant and platform', () => {
    const plan = buildPublishPlan(project(), report, 'now')
    expect(plan.items).toHaveLength(4)
    expect(plan.items[0]?.platform).toBe('youtube_shorts')
    expect(plan.items[0]?.caption).toContain('제휴 링크')
    expect(publishPlanSchema.safeParse(plan).success).toBe(true)
  })

  it('normalizes hashtags to platform-safe hash tags', () => {
    const tags = buildHashtags(project(), getPlatformProfile('youtube_shorts'))
    expect(tags).toContain('#주방수납')
    expect(tags).toContain('#살림템')
    expect(tags.every((tag) => tag.startsWith('#'))).toBe(true)
  })

  it('rejects invalid manifest contracts', () => {
    const plan = buildPublishPlan(project(), report, 'now')
    expect(() => validatePublishPlan({ ...plan, affiliateUrl: 'bad-url' })).toThrow()
  })

  it('creates a performance CSV template', () => {
    const plan = buildPublishPlan(project(), report, 'now')
    const csv = serializePerformanceCsv(buildPerformanceRows(plan))
    expect(csv).toContain('videoFile,platform,productName,hook')
    expect(csv).toContain('video_01.mp4,youtube_shorts')
  })
})
