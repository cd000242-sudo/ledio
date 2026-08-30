import { describe, expect, it } from 'vitest'
import { bucketPeaks, buildPeaksArgs, PEAK_RATE } from './peaks.mjs'

describe('파형 뽑는 인자', () => {
  it('소리만 뽑되 목소리가 남을 속도로 받는다 — 너무 낮추면 저역통과 필터가 다 걸러 낸다', () => {
    const args = buildPeaksArgs('C:/영상/a.mp4')
    expect(args).toContain('-vn')
    expect(args[args.indexOf('-ar') + 1]).toBe(String(PEAK_RATE))
    expect(PEAK_RATE).toBeGreaterThanOrEqual(8000)
    expect(args[args.indexOf('-ac') + 1]).toBe('1')
    expect(args[args.indexOf('-f') + 1]).toBe('s16le')
    expect(args.at(-1)).toBe('-') // 파일로 남기지 않고 바로 받는다
  })
})

describe('파형 묶기', () => {
  it('구간마다 가장 큰 소리를 0~1로 돌려준다', () => {
    const samples = new Int16Array([0, 16384, -32768, 100, 0, 0])
    const peaks = bucketPeaks(samples, 3)
    expect(peaks).toHaveLength(3)
    expect(peaks[0]).toBeCloseTo(0.5, 2)
    expect(peaks[1]).toBeCloseTo(1, 2)
    expect(peaks[2]).toBe(0)
  })

  it('무음 구간은 0으로 나온다 — 화면에서 납작하게 보여야 자를 곳이 눈에 띈다', () => {
    expect(bucketPeaks(new Int16Array([0, 0, 0, 0]), 2)).toEqual([0, 0])
  })

  it('표본이 칸보다 적어도 칸 수를 맞춘다', () => {
    expect(bucketPeaks(new Int16Array([32767, 0]), 5)).toHaveLength(5)
  })

  it('표본이 없으면 빈 배열', () => {
    expect(bucketPeaks(new Int16Array(0), 4)).toEqual([])
  })
})
