import { z } from 'zod'

export const performanceRecordSchema = z.object({
  videoFile: z.string().min(1),
  platform: z.enum(['youtube_shorts', 'instagram_reels', 'tiktok']),
  postedUrl: z.string().url(),
  views: z.number().int().min(0),
  clicks: z.number().int().min(0),
  orders: z.number().int().min(0),
  revenue: z.number().min(0),
  cost: z.number().min(0),
  notes: z.string().optional(),
})

export type PerformanceRecord = z.infer<typeof performanceRecordSchema>

export interface PerformanceSummary {
  recordCount: number
  views: number
  clicks: number
  orders: number
  revenue: number
  cost: number
  profit: number
  clickThroughRate: number
  conversionRate: number
}

export function summarizePerformance(records: PerformanceRecord[]): PerformanceSummary {
  const parsed = records.map((record) => performanceRecordSchema.parse(record))
  const totals = parsed.reduce(
    (sum, record) => ({
      views: sum.views + record.views,
      clicks: sum.clicks + record.clicks,
      orders: sum.orders + record.orders,
      revenue: sum.revenue + record.revenue,
      cost: sum.cost + record.cost,
    }),
    { views: 0, clicks: 0, orders: 0, revenue: 0, cost: 0 },
  )

  return {
    recordCount: parsed.length,
    ...totals,
    profit: totals.revenue - totals.cost,
    clickThroughRate: totals.views > 0 ? totals.clicks / totals.views : 0,
    conversionRate: totals.clicks > 0 ? totals.orders / totals.clicks : 0,
  }
}

export function canEnterPerformanceLab(records: PerformanceRecord[], minimumRecords = 5): boolean {
  return records.length >= minimumRecords
}
