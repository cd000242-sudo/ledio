import { describe, it, expect } from 'vitest'
import { PLATFORM_IDS, projectSchema } from './schema.js'

function baseProject(): Record<string, unknown> {
  return {
    projectName: 'kitchen-shelf-001',
    product: {
      name: '접이식 싱크대 선반',
      category: '주방 수납',
      priceRange: '10000-30000',
      affiliateUrl: 'https://example.com/product',
      painPoint: '좁은 싱크대',
      benefit: '접으면 작고 펼치면 물 빠짐 공간이 생김',
    },
    disclosure: {
      type: 'affiliate',
      text: '제휴 링크를 포함합니다.',
    },
    style: {
      duration: 25,
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
    variants: { count: 5 },
  }
}

describe('projectSchema', () => {
  it('validates a complete project', () => {
    expect(projectSchema.safeParse(baseProject()).success).toBe(true)
  })

  it('rejects a clip when end <= start', () => {
    const project = baseProject()
    ;(project.clips as Array<Record<string, unknown>>)[0]!.end = 0
    const result = projectSchema.safeParse(project)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toContain('end는 start보다')
  })

  it('rejects an invalid ratio format', () => {
    const project = baseProject()
    ;(project.style as Record<string, unknown>).ratio = '916'
    expect(projectSchema.safeParse(project).success).toBe(false)
  })

  it('rejects an invalid resolution format', () => {
    const project = baseProject()
    ;(project.style as Record<string, unknown>).resolution = '1080-1920'
    expect(projectSchema.safeParse(project).success).toBe(false)
  })

  it('rejects an invalid affiliate URL', () => {
    const project = baseProject()
    ;(project.product as Record<string, unknown>).affiliateUrl = 'not-a-url'
    const result = projectSchema.safeParse(project)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toContain('올바른 URL')
  })

  it('rejects unknown clip roles', () => {
    const project = baseProject()
    ;(project.clips as Array<Record<string, unknown>>)[0]!.role = 'intro'
    expect(projectSchema.safeParse(project).success).toBe(false)
  })

  it('requires at least one clip', () => {
    const project = baseProject()
    project.clips = []
    expect(projectSchema.safeParse(project).success).toBe(false)
  })

  it('rejects bgmVolume above 1', () => {
    const project = baseProject()
    ;(project.style as Record<string, unknown>).bgmVolume = 1.5
    expect(projectSchema.safeParse(project).success).toBe(false)
  })

  it('fills safe defaults when publish and sources are omitted', () => {
    const result = projectSchema.safeParse(baseProject())
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.publish.platforms).toEqual([...PLATFORM_IDS])
    expect(result.data.publish.hashtags).toEqual([])
    expect(result.data.sources).toEqual([])
  })

  it('accepts an optional bgm file', () => {
    const project = baseProject()
    project.bgm = { file: 'bgm/bright-loop.mp3' }
    const result = projectSchema.safeParse(project)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.bgm?.file).toBe('bgm/bright-loop.mp3')
  })

  it('accepts an optional narration track with safe mix levels', () => {
    const project = baseProject()
    project.narration = { file: 'narration/shop.wav', volume: 1, originalVolume: 0.2 }
    const result = projectSchema.safeParse(project)
    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.narration?.file).toBe('narration/shop.wav')
    expect(result.data.narration?.originalVolume).toBe(0.2)
  })

  it('requires either source.url or source.file', () => {
    const project = baseProject()
    project.sources = [{ title: '권리 정보 없는 소스' }]
    expect(projectSchema.safeParse(project).success).toBe(false)
  })
})
