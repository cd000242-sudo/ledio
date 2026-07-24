import { describe, expect, it } from 'vitest'
import { buildStyledAudioFilter } from './styleAudio.js'

describe('buildStyledAudioFilter', () => {
  it('속도·피치·음량을 하나의 안전한 기본 필터로 만든다', () => {
    const result = buildStyledAudioFilter({ pace: 1.1, pitch: 0.6, gain: 1.4, ending: 'neutral' }, 3)
    expect(result.kind).toBe('simple')
    expect(result.filter).toContain('asetrate=24000*')
    expect(result.filter).toContain('atempo=1.1')
    expect(result.filter).toContain('volume=1.4dB')
  })

  it('내려 말하기는 마지막 짧은 구간만 낮춰 자연스럽게 연결한다', () => {
    const result = buildStyledAudioFilter({ pace: 1, pitch: 0, gain: 0, ending: 'fall' }, 4)
    expect(result.kind).toBe('complex')
    expect(result.filter).toContain('atrim=end=3.600')
    expect(result.filter).toContain('atrim=start=3.600')
    expect(result.filter).toContain('asetrate=24000*0.')
    expect(result.filter).toContain('acrossfade')
  })

  it('질문형은 끝 구간을 올리고 단호한 끝음은 짧게 정리한다', () => {
    const rise = buildStyledAudioFilter({ pace: 1, ending: 'rise' }, 2)
    const crisp = buildStyledAudioFilter({ pace: 1, ending: 'crisp' }, 2)
    expect(rise.filter).toMatch(/asetrate=24000\*1\./)
    expect(crisp.filter).toContain('afade=t=out')
  })

  it('너무 짧은 음성은 끝음 분할 없이 기본 필터만 사용한다', () => {
    const result = buildStyledAudioFilter({ pace: 1, ending: 'linger' }, 0.2)
    expect(result.kind).toBe('simple')
  })
})
