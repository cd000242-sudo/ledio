import { describe, expect, it } from 'vitest'
import { buildSilenceEditPlan, parseSilencedetectLog } from './silence.js'

describe('silence edit planning', () => {
  it('parses FFmpeg silencedetect output including trailing silence', () => {
    const ranges = parseSilencedetectLog(
      [
        '[silencedetect @ 000001] silence_start: 1.20',
        '[silencedetect @ 000001] silence_end: 2.50 | silence_duration: 1.30',
        '[silencedetect @ 000001] silence_start: 8.75',
      ].join('\n'),
      10,
    )

    expect(ranges).toEqual([
      { start: 1.2, end: 2.5 },
      { start: 8.75, end: 10 },
    ])
  })

  it('builds remove and keep ranges for an automatic silence cut', () => {
    const plan = buildSilenceEditPlan(
      12,
      [
        { start: 1, end: 2 },
        { start: 5, end: 6.5 },
      ],
      { noiseDb: -38, minDurationSec: 0.4, paddingSec: 0.1 },
    )

    expect(plan.remove).toEqual([
      { start: 1.1, end: 1.9 },
      { start: 5.1, end: 6.4 },
    ])
    expect(plan.keep).toEqual([
      { start: 0, end: 1.1, duration: 1.1 },
      { start: 1.9, end: 5.1, duration: 3.2 },
      { start: 6.4, end: 12, duration: 5.6 },
    ])
    expect(plan.removedDurationSec).toBe(2.1)
    expect(plan.outputDurationSec).toBe(9.9)
    expect(plan.noiseDb).toBe(-38)
  })
})
