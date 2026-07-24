import { describe, it, expect } from 'vitest'
import { buildAtempoFilter, buildNormalizeVf } from './normalize.js'

describe('buildNormalizeVf', () => {
  it('비율 유지 스케일 + 패딩 + fps를 포함한다', () => {
    const vf = buildNormalizeVf(1080, 1920, 30)
    expect(vf).toContain('scale=1080:1920:force_original_aspect_ratio=decrease')
    expect(vf).toContain('pad=1080:1920')
    expect(vf).toContain('setsar=1')
    expect(vf).toContain('fps=30')
  })

  it('속도 변경용 setpts 필터를 포함한다', () => {
    const vf = buildNormalizeVf(1080, 1920, 30, 2)
    expect(vf).toContain('setpts=0.500000*PTS')
  })

  it('오디오 속도 필터를 안전한 atempo 체인으로 만든다', () => {
    expect(buildAtempoFilter(4)).toBe('atempo=2,atempo=2')
    expect(buildAtempoFilter(0.25)).toBe('atempo=0.5,atempo=0.5')
  })
})
