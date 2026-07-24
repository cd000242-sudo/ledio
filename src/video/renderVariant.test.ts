import { describe, expect, it } from 'vitest'
import { buildAudioMixFilter } from './renderVariant.js'

describe('buildAudioMixFilter', () => {
  it('원본·쇼핑 나레이션·BGM을 각각 안전한 볼륨으로 섞는다', () => {
    const filter = buildAudioMixFilter({
      videoFilter: 'drawtext=test',
      narrationInput: 1,
      narrationVolume: 1,
      originalVolume: 0.2,
      bgmInput: 2,
      bgmVolume: 0.18,
    })

    expect(filter).toContain('[0:a]volume=0.200[original]')
    expect(filter).toContain('[1:a]apad,volume=1.000[narration]')
    expect(filter).toContain('[2:a]volume=0.180[bgm]')
    expect(filter).toContain('[original][narration][bgm]amix=inputs=3:duration=first')
  })

  it('나레이션만 있을 때도 원본 소리를 낮춰 함께 보존한다', () => {
    const filter = buildAudioMixFilter({ videoFilter: 'null', narrationInput: 1 })
    expect(filter).toContain('[original][narration]amix=inputs=2:duration=first')
    expect(filter).not.toContain('[bgm]')
  })
})
