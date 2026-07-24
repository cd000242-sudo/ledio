import { describe, expect, it } from 'vitest'
import { canEnterPerformanceLab, summarizePerformance, type PerformanceRecord } from './performance.js'

const records: PerformanceRecord[] = [
  {
    videoFile: 'video_01.mp4',
    platform: 'youtube_shorts',
    postedUrl: 'https://example.com/post/1',
    views: 1000,
    clicks: 50,
    orders: 5,
    revenue: 50000,
    cost: 12000,
  },
  {
    videoFile: 'video_02.mp4',
    platform: 'tiktok',
    postedUrl: 'https://example.com/post/2',
    views: 500,
    clicks: 10,
    orders: 1,
    revenue: 8000,
    cost: 3000,
  },
]

describe('performance contract', () => {
  it('summarizes revenue, cost, profit, ctr, and conversion', () => {
    const summary = summarizePerformance(records)
    expect(summary.views).toBe(1500)
    expect(summary.clicks).toBe(60)
    expect(summary.orders).toBe(6)
    expect(summary.profit).toBe(43000)
    expect(summary.clickThroughRate).toBeCloseTo(0.04)
    expect(summary.conversionRate).toBeCloseTo(0.1)
  })

  it('holds the performance lab until enough real records exist', () => {
    expect(canEnterPerformanceLab(records)).toBe(false)
    expect(canEnterPerformanceLab([...records, ...records, records[0] as PerformanceRecord])).toBe(true)
  })
})
