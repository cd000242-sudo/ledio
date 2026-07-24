import { describe, it, expect } from 'vitest'
import {
  parseSilenceLog,
  computeKeepSegments,
  summarizeCut,
  type Interval,
} from './silence.js'

describe('parseSilenceLog', () => {
  it('start/end 쌍을 파싱한다', () => {
    const log = `
[silencedetect @ 0x1] silence_start: 3.512
[silencedetect @ 0x1] silence_end: 4.238 | silence_duration: 0.726
[silencedetect @ 0x1] silence_start: 7.0
[silencedetect @ 0x1] silence_end: 7.8 | silence_duration: 0.8`
    expect(parseSilenceLog(log)).toEqual<Interval[]>([
      { start: 3.512, end: 4.238 },
      { start: 7.0, end: 7.8 },
    ])
  })

  it('start 없이 end만 나오면 0에서 시작으로 본다', () => {
    expect(parseSilenceLog('silence_end: 1.5 | silence_duration: 1.5')).toEqual([
      { start: 0, end: 1.5 },
    ])
  })

  it('음수 start는 0으로 클램프한다', () => {
    const out = parseSilenceLog('silence_start: -0.02\nsilence_end: 0.5')
    expect(out[0]?.start).toBe(0)
  })
})

describe('computeKeepSegments', () => {
  it('긴 무음을 잘라 유지 구간을 만든다', () => {
    // 0~3 말, 3~5 무음(2s), 5~8 말
    const keep = computeKeepSegments(8, [{ start: 3, end: 5 }], {
      minSilence: 0.6,
      padding: 0.1,
      minKeep: 0.3,
    })
    expect(keep).toEqual([
      { start: 0, end: 3.1 }, // 무음 앞 padding 0.1 유지
      { start: 4.9, end: 8 }, // 무음 뒤 padding 0.1 유지
    ])
  })

  it('minSilence 미만인 짧은 무음은 자르지 않는다', () => {
    const keep = computeKeepSegments(5, [{ start: 2, end: 2.3 }], { minSilence: 0.6 })
    expect(keep).toEqual([{ start: 0, end: 5 }])
  })

  it('무음이 없으면 전체가 하나의 유지 구간', () => {
    expect(computeKeepSegments(10, [])).toEqual([{ start: 0, end: 10 }])
  })

  it('minKeep 미만의 짧은 유지 구간은 버린다', () => {
    // 0~0.2 짧은 말, 0.2~2 무음, 2~5 말 → 앞 0.2 조각은 버려짐
    const keep = computeKeepSegments(5, [{ start: 0.2, end: 2 }], {
      minSilence: 0.6,
      padding: 0.05,
      minKeep: 0.3,
    })
    expect(keep.every((k) => k.end - k.start >= 0.3)).toBe(true)
    expect(keep[0]?.start).toBeGreaterThan(0) // 앞 짧은 조각 제거됨
  })

  it('인접한 무음 컷 영역을 병합한다', () => {
    const keep = computeKeepSegments(10, [
      { start: 2, end: 3 },
      { start: 3, end: 4 },
    ], { minSilence: 0.6, padding: 0 })
    expect(keep).toEqual([
      { start: 0, end: 2 },
      { start: 4, end: 10 },
    ])
  })
})

describe('summarizeCut', () => {
  it('제거/유지 길이와 컷 개수를 집계한다', () => {
    const s = summarizeCut(8, [
      { start: 0, end: 3.1 },
      { start: 4.9, end: 8 },
    ])
    expect(s.keptDuration).toBeCloseTo(6.2, 3)
    expect(s.removedDuration).toBeCloseTo(1.8, 3)
    expect(s.segmentCount).toBe(2)
    expect(s.cutCount).toBe(1) // 3.1~4.9 사이 하나
  })

  it('앞뒤 잘림도 컷으로 센다', () => {
    const s = summarizeCut(10, [{ start: 2, end: 8 }])
    expect(s.cutCount).toBe(2) // 앞(0~2) + 뒤(8~10)
  })
})
