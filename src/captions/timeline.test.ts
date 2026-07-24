import { describe, expect, it } from 'vitest'
import { projectSchema, type Project } from '../config/schema.js'
import { buildCaptionTimeline, timelineDuration } from './timeline.js'

function project(): Project {
  return projectSchema.parse({
    projectName: 'caption-test',
    product: {
      name: '접이식 선반',
      category: '주방 수납',
      priceRange: '10000-30000',
      affiliateUrl: 'https://example.com/product',
      painPoint: '좁은 싱크대',
      benefit: '접으면 작고 펼치면 물 빠짐 공간이 생깁니다.',
    },
    disclosure: {
      type: 'affiliate',
      text: '이 콘텐츠는 제휴 링크를 포함합니다.',
    },
    style: {
      duration: 20,
      ratio: '9:16',
      resolution: '1080x1920',
      tone: 'friendly',
      captionPosition: 'bottom',
      bgmVolume: 0.18,
    },
    clips: [
      { file: 'clips/hook.mp4', role: 'hook', start: 0, end: 2.5 },
      { file: 'clips/use.mp4', role: 'use', start: 0, end: 8 },
      { file: 'clips/result.mp4', role: 'result', start: 0, end: 5 },
    ],
    variants: { count: 1 },
    publish: {
      platforms: ['youtube_shorts'],
      hashtags: ['주방수납'],
      cta: '가격은 링크에서 확인하세요.',
    },
  })
}

describe('caption timeline', () => {
  it('computes total timeline duration from clip ranges', () => {
    expect(timelineDuration(project())).toBe(15.5)
  })

  it('creates hook, body, cta, and disclosure segments in order', () => {
    const segments = buildCaptionTimeline(project(), '첫 훅')
    expect(segments.map((segment) => segment.kind)).toEqual(['hook', 'body', 'cta', 'disclosure'])
    expect(segments[0]?.text).toBe('첫 훅')
    expect(segments[1]?.text).toContain('물 빠짐')
    expect(segments[2]?.text).toContain('링크')
    expect(segments[3]?.text).toContain('제휴')
    for (const segment of segments) {
      expect(segment.end).toBeGreaterThan(segment.start)
      expect(segment.position).toBe('bottom')
    }
  })

  it('스토리 톤(tone=story)은 장면 자막과 겹치지 않게 공시 문구만 얹는다', () => {
    const p = project()
    const storyProject = { ...p, style: { ...p.style, tone: 'story' } }
    const segments = buildCaptionTimeline(storyProject, '이 훅은 무시되어야 함')
    expect(segments.map((segment) => segment.kind)).toEqual(['disclosure'])
    expect(segments[0]?.text).toContain('제휴')
  })
})
