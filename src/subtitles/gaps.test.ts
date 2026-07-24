import { describe, it, expect } from 'vitest'
import { fillGaps } from './gaps.js'
import type { Cue } from './srt.js'

describe('fillGaps', () => {
  it('종료 시간을 다음 시작까지 연장한다', () => {
    const cues: Cue[] = [
      { startMs: 0, endMs: 1000, text: 'a' },
      { startMs: 1500, endMs: 2000, text: 'b' },
    ]
    const out = fillGaps(cues)
    expect(out[0]?.endMs).toBe(1500) // 1000 -> 1500 (다음 시작)
  })

  it('시작 시간은 유지한다', () => {
    const cues: Cue[] = [
      { startMs: 0, endMs: 1000, text: 'a' },
      { startMs: 1500, endMs: 2000, text: 'b' },
    ]
    const out = fillGaps(cues)
    expect(out[0]?.startMs).toBe(0)
    expect(out[1]?.startMs).toBe(1500)
  })

  it('마지막 자막은 그대로 둔다', () => {
    const cues: Cue[] = [
      { startMs: 0, endMs: 1000, text: 'a' },
      { startMs: 1500, endMs: 2000, text: 'b' },
    ]
    expect(fillGaps(cues)[1]?.endMs).toBe(2000)
  })

  it('연속 후 겹치지 않는다', () => {
    const cues: Cue[] = [
      { startMs: 0, endMs: 800, text: 'a' },
      { startMs: 1000, endMs: 1800, text: 'b' },
      { startMs: 2000, endMs: 2500, text: 'c' },
    ]
    const out = fillGaps(cues)
    for (let i = 0; i < out.length - 1; i++) {
      expect((out[i] as Cue).endMs).toBeLessThanOrEqual((out[i + 1] as Cue).startMs)
    }
  })

  it('원본을 변경하지 않는다(불변)', () => {
    const cues: Cue[] = [
      { startMs: 0, endMs: 1000, text: 'a' },
      { startMs: 1500, endMs: 2000, text: 'b' },
    ]
    fillGaps(cues)
    expect(cues[0]?.endMs).toBe(1000)
  })
})
