import { z } from 'zod'

/** 클립이 가질 수 있는 역할. 사용자가 각 클립의 목적을 명확히 지정한다. */
export const CLIP_ROLES = ['hook', 'problem', 'product', 'use', 'result', 'cta'] as const
export type ClipRole = (typeof CLIP_ROLES)[number]

/** 검증 단계에서 권장하는 최소 역할. 없으면 경고만 낸다. */
export const ESSENTIAL_ROLES = ['hook', 'use', 'result'] as const

export const PLATFORM_IDS = ['youtube_shorts', 'instagram_reels', 'tiktok'] as const
export type PlatformId = (typeof PLATFORM_IDS)[number]

export const LINK_PLACEMENTS = ['profile_link', 'fixed_comment', 'description', 'profile_and_comment'] as const
export type LinkPlacement = (typeof LINK_PLACEMENTS)[number]

export const SOURCE_RIGHTS = [
  'owned',
  'licensed',
  'official_brand',
  'creative_commons',
  'ai_generated',
  'permission_pending',
  'reference_only',
  'unknown',
] as const
export type SourceRights = (typeof SOURCE_RIGHTS)[number]

export const SOURCE_USAGES = ['edit', 'reference'] as const
export type SourceUsage = (typeof SOURCE_USAGES)[number]

/** 자막 스타일 프리셋. 초보자가 고르기 쉽게 소수의 검증된 조합만 제공한다. */
export const CAPTION_STYLES = ['basic', 'bold-yellow', 'clean-white', 'strong-box'] as const
export type CaptionStyle = (typeof CAPTION_STYLES)[number]

/** 장면 전환 프리셋. 클립 경계에서 페이드 인/아웃으로 부드럽게 잇는다. */
export const TRANSITIONS = ['none', 'fade', 'slow-fade'] as const
export type Transition = (typeof TRANSITIONS)[number]

/** 화면 위에 얹는 텍스트 스티커의 위치. */
export const STICKER_POSITIONS = ['top', 'center', 'bottom'] as const
export type StickerPosition = (typeof STICKER_POSITIONS)[number]

const ratioRegex = /^\d+:\d+$/
const resolutionRegex = /^\d+x\d+$/
const priceRangeRegex = /^\d+-\d+$/

export const clipSchema = z
  .object({
    file: z.string().min(1, 'clip.file 경로가 필요합니다.'),
    role: z.enum(CLIP_ROLES),
    start: z.number().min(0, 'start는 0 이상이어야 합니다.'),
    end: z.number().min(0, 'end는 0 이상이어야 합니다.'),
    speed: z.number().min(0.25).max(4).optional(),
    mute: z.boolean().optional(),
  })
  .refine((c) => c.end > c.start, {
    message: 'end는 start보다 커야 합니다.',
    path: ['end'],
  })

export const productSchema = z.object({
  name: z.string().min(1),
  category: z.string().min(1),
  priceRange: z.string().regex(priceRangeRegex, 'priceRange는 "10000-30000" 형식이어야 합니다.'),
  affiliateUrl: z.string().url('affiliateUrl은 올바른 URL이어야 합니다.'),
  painPoint: z.string().min(1),
  benefit: z.string().min(1),
})

export const disclosureSchema = z.object({
  type: z.string().min(1),
  text: z.string().min(1, '제휴/광고 고지 문구(text)는 비울 수 없습니다.'),
})

export const styleSchema = z.object({
  duration: z.number().positive('duration(초)은 양수여야 합니다.'),
  ratio: z.string().regex(ratioRegex, 'ratio는 "9:16" 형식이어야 합니다.'),
  resolution: z.string().regex(resolutionRegex, 'resolution은 "1080x1920" 형식이어야 합니다.'),
  tone: z.string().min(1),
  captionPosition: z.enum(['top', 'center', 'bottom']),
  captionStyle: z.enum(CAPTION_STYLES).default('basic'),
  transition: z.enum(TRANSITIONS).default('none'),
  bgmVolume: z.number().min(0).max(1, 'bgmVolume은 0~1 사이여야 합니다.'),
})

export const variantsSchema = z.object({
  count: z.number().int().min(1).max(20),
})

export const bgmSchema = z
  .object({
    file: z.string().min(1, 'bgm.file 경로가 필요합니다.'),
  })
  .optional()

export const narrationSchema = z
  .object({
    file: z.string().min(1, 'narration.file 경로가 필요합니다.'),
    volume: z.number().min(0).max(2).default(1),
    originalVolume: z.number().min(0).max(1).default(0.2),
  })
  .optional()

export const publishSchema = z
  .object({
    campaignName: z.string().min(1).optional(),
    platforms: z.array(z.enum(PLATFORM_IDS)).min(1).default([...PLATFORM_IDS]),
    hashtags: z.array(z.string().min(1)).default([]),
    linkPlacement: z.enum(LINK_PLACEMENTS).default('profile_link'),
    cta: z.string().min(1).optional(),
    fixedComment: z.string().min(1).optional(),
  })
  .default({})

export const stickerSchema = z
  .object({
    text: z.string().min(1, '스티커 문구가 필요합니다.'),
    start: z.number().min(0, '스티커 start는 0 이상이어야 합니다.'),
    end: z.number().min(0, '스티커 end는 0 이상이어야 합니다.'),
    position: z.enum(STICKER_POSITIONS).default('center'),
  })
  .refine((s) => s.end > s.start, {
    message: '스티커 end는 start보다 커야 합니다.',
    path: ['end'],
  })

export const sourceSchema = z
  .object({
    title: z.string().min(1),
    url: z.string().url().optional(),
    file: z.string().min(1).optional(),
    rights: z.enum(SOURCE_RIGHTS).default('unknown'),
    usage: z.enum(SOURCE_USAGES).default('reference'),
    notes: z.string().optional(),
  })
  .refine((s) => s.url !== undefined || s.file !== undefined, {
    message: 'source는 url 또는 file 중 하나가 필요합니다.',
    path: ['url'],
  })

export const projectSchema = z.object({
  projectName: z.string().min(1),
  product: productSchema,
  disclosure: disclosureSchema,
  style: styleSchema,
  bgm: bgmSchema,
  narration: narrationSchema,
  clips: z.array(clipSchema).min(1, '클립은 최소 1개 필요합니다.'),
  stickers: z.array(stickerSchema).default([]),
  variants: variantsSchema,
  publish: publishSchema,
  sources: z.array(sourceSchema).default([]),
})

export type Clip = z.infer<typeof clipSchema>
export type Product = z.infer<typeof productSchema>
export type Style = z.infer<typeof styleSchema>
export type Project = z.infer<typeof projectSchema>
export type Source = z.infer<typeof sourceSchema>
export type Sticker = z.infer<typeof stickerSchema>
export type Bgm = z.infer<typeof bgmSchema>
export type Narration = z.infer<typeof narrationSchema>
