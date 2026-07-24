import { describe, expect, it } from 'vitest'
import { buildProductProject } from './productProject.js'

const input = {
  projectName: 'shop-1',
  productName: '접이식 선반',
  affiliateUrl: 'https://example.com/p',
  benefit: '접으면 작다',
  painPoint: '좁은 주방',
  clips: ['clips/a.mp4', 'clips/b.mp4', 'clips/c.mp4'],
  variants: 5,
}
const infos = [
  { file: 'clips/a.mp4', durationSec: 2.5 },
  { file: 'clips/b.mp4', durationSec: 4 },
  { file: 'clips/c.mp4', durationSec: 3 },
]

describe('buildProductProject', () => {
  it('클립마다 역할을 순환 부여하고 길이를 반영한다', () => {
    const project = buildProductProject(input, infos)
    expect(project.clips.map((c) => c.role)).toEqual(['hook', 'problem', 'product'])
    expect(project.clips[0]?.end).toBe(2.5)
    expect(project.style.duration).toBe(9.5)
    expect(project.variants.count).toBe(5)
  })

  it('빈 링크는 안전한 기본 URL로 대체한다', () => {
    const project = buildProductProject({ ...input, affiliateUrl: '' }, infos)
    expect(project.product.affiliateUrl).toBe('https://example.com/product')
  })

  it('빈 장점/불편은 상품명 기반 기본값으로 채운다', () => {
    const project = buildProductProject({ ...input, benefit: '', painPoint: '' }, infos)
    expect(project.product.benefit).toContain('접이식 선반')
    expect(project.product.painPoint).toContain('접이식 선반')
  })

  it('길이 정보가 없는 클립이면 명확히 실패한다', () => {
    expect(() => buildProductProject(input, infos.slice(0, 1))).toThrow('클립 길이')
  })

  it('결과는 projectSchema를 통과하는 유효한 프로젝트다', () => {
    const project = buildProductProject(input, infos)
    expect(project.clips).toHaveLength(3)
    expect(project.sources).toHaveLength(3)
    expect(project.publish.platforms).toContain('youtube_shorts')
  })

  it('생성한 쇼핑 나레이션 파일을 최종 프로젝트에 연결한다', () => {
    const project = buildProductProject(
      { ...input, narrationFile: 'narration/product-narration.wav' },
      infos,
    )
    expect(project.narration).toEqual({
      file: 'narration/product-narration.wav',
      volume: 1,
      originalVolume: 0.2,
    })
  })
})
