import { z } from 'zod'
import { PLATFORM_IDS, type PlatformId, type Project } from '../config/schema.js'
import { getPlatformProfile, type PlatformProfile } from '../platforms/profiles.js'

export interface RenderReportVariant {
  file: string
  hook: string
}

export interface RenderReport {
  projectName: string
  generatedAt: string
  resolution: string
  fps: number
  timelineDurationSec: number
  variantCount: number
  variants: RenderReportVariant[]
}

export interface PlatformPublishItem {
  platform: PlatformId
  platformLabel: string
  videoFile: string
  title: string
  caption: string
  fixedComment: string
  affiliateUrl: string
  hashtags: string[]
  hook: string
}

export interface PublishPlan {
  projectName: string
  campaignName: string
  productName: string
  affiliateUrl: string
  disclosure: string
  generatedAt: string
  platforms: PlatformId[]
  items: PlatformPublishItem[]
}

export interface PerformanceTemplateRow {
  videoFile: string
  platform: PlatformId
  productName: string
  hook: string
  postedUrl: string
  views: string
  clicks: string
  orders: string
  revenue: string
  cost: string
  notes: string
}

export const platformPublishItemSchema = z.object({
  platform: z.enum(PLATFORM_IDS),
  platformLabel: z.string().min(1),
  videoFile: z.string().min(1),
  title: z.string().min(1),
  caption: z.string().min(1),
  fixedComment: z.string().min(1),
  affiliateUrl: z.string().url(),
  hashtags: z.array(z.string().regex(/^#/)).default([]),
  hook: z.string().min(1),
})

export const publishPlanSchema = z.object({
  projectName: z.string().min(1),
  campaignName: z.string().min(1),
  productName: z.string().min(1),
  affiliateUrl: z.string().url(),
  disclosure: z.string().min(1),
  generatedAt: z.string().min(1),
  platforms: z.array(z.enum(PLATFORM_IDS)).min(1),
  items: z.array(platformPublishItemSchema).min(1),
})

function truncateText(text: string, maxChars: number): string {
  const chars = [...text]
  if (chars.length <= maxChars) return text
  if (maxChars <= 3) return chars.slice(0, maxChars).join('')
  return `${chars.slice(0, maxChars - 3).join('').trimEnd()}...`
}

function normalizeHashtag(input: string): string | null {
  const raw = input.trim().replace(/^#/, '')
  const compact = raw.replace(/[^\p{L}\p{N}_]/gu, '')
  return compact ? `#${compact}` : null
}

export function buildDefaultHashtags(project: Project): string[] {
  const raw = [
    project.product.name,
    project.product.category,
    project.product.benefit,
    '추천템',
    '리뷰',
    '쇼츠',
  ]
  return Array.from(new Set(raw.map((tag) => normalizeHashtag(tag)).filter((tag) => tag !== null)))
}

export function buildHashtags(project: Project, profile: PlatformProfile): string[] {
  const configured = project.publish.hashtags
    .map((tag) => normalizeHashtag(tag))
    .filter((tag) => tag !== null)
  const defaults = buildDefaultHashtags(project)
  return Array.from(new Set([...configured, ...defaults])).slice(0, profile.hashtagLimit)
}

function buildTitle(project: Project, variant: RenderReportVariant, profile: PlatformProfile): string {
  return truncateText(`${project.product.name} | ${variant.hook}`, profile.titleMaxChars)
}

function buildCaption(
  project: Project,
  variant: RenderReportVariant,
  profile: PlatformProfile,
  hashtags: string[],
): string {
  const cta =
    project.publish.cta ??
    `가격과 자세한 정보는 제휴링크에서 확인하세요: ${project.product.affiliateUrl}`
  const lines = [
    variant.hook,
    project.product.benefit,
    cta,
    project.disclosure.text,
    hashtags.join(' '),
  ]
  return truncateText(lines.filter(Boolean).join('\n'), profile.captionMaxChars)
}

function buildFixedComment(project: Project): string {
  return (
    project.publish.fixedComment ??
    `${project.product.name} 상세 정보: ${project.product.affiliateUrl}\n${project.disclosure.text}`
  )
}

export function validatePublishPlan(plan: PublishPlan): PublishPlan {
  return publishPlanSchema.parse(plan)
}

export function buildPublishPlan(
  project: Project,
  report: RenderReport,
  generatedAt = new Date().toISOString(),
): PublishPlan {
  const platforms = project.publish.platforms
  const items = report.variants.flatMap((variant) =>
    platforms.map((platform) => {
      const profile = getPlatformProfile(platform)
      const hashtags = buildHashtags(project, profile)
      return {
        platform,
        platformLabel: profile.label,
        videoFile: variant.file,
        title: buildTitle(project, variant, profile),
        caption: buildCaption(project, variant, profile, hashtags),
        fixedComment: buildFixedComment(project),
        affiliateUrl: project.product.affiliateUrl,
        hashtags,
        hook: variant.hook,
      }
    }),
  )

  return validatePublishPlan({
    projectName: project.projectName,
    campaignName: project.publish.campaignName ?? project.projectName,
    productName: project.product.name,
    affiliateUrl: project.product.affiliateUrl,
    disclosure: project.disclosure.text,
    generatedAt,
    platforms,
    items,
  })
}

function csvEscape(value: string): string {
  if (!/[",\r\n]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

export function buildPerformanceRows(plan: PublishPlan): PerformanceTemplateRow[] {
  return plan.items.map((item) => ({
    videoFile: item.videoFile,
    platform: item.platform,
    productName: plan.productName,
    hook: item.hook,
    postedUrl: '',
    views: '',
    clicks: '',
    orders: '',
    revenue: '',
    cost: '',
    notes: '',
  }))
}

export function serializePerformanceCsv(rows: PerformanceTemplateRow[]): string {
  const headers = [
    'videoFile',
    'platform',
    'productName',
    'hook',
    'postedUrl',
    'views',
    'clicks',
    'orders',
    'revenue',
    'cost',
    'notes',
  ] as const
  const lines = [
    headers.join(','),
    ...rows.map((row) => headers.map((key) => csvEscape(String(row[key]))).join(',')),
  ]
  return `${lines.join('\n')}\n`
}
