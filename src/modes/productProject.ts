import { z } from 'zod'
import { CLIP_ROLES, projectSchema, type Project } from '../config/schema.js'

export const productWizardInputSchema = z.object({
  projectName: z.string().min(1),
  productName: z.string().min(1),
  affiliateUrl: z.string().default(''),
  benefit: z.string().default(''),
  painPoint: z.string().default(''),
  category: z.string().default('쇼핑'),
  clips: z.array(z.string().min(1)).min(1),
  variants: z.number().int().min(1).max(10).default(5),
  narrationFile: z.string().min(1).optional(),
})

export type ProductWizardInput = z.input<typeof productWizardInputSchema>

export interface ClipDurationInfo {
  file: string
  durationSec: number
}

function round2(value: number): number {
  return Number(value.toFixed(2))
}

function fallbackUrl(url: string): string {
  try {
    return new URL(url).toString()
  } catch {
    return 'https://example.com/product'
  }
}

/**
 * 쇼핑쇼츠 위저드 입력 + 클립 길이 정보로 렌더 가능한 project를 만든다(순수 함수).
 * 역할은 hook→problem→product→use→result→cta 순으로 순환 부여한다.
 */
export function buildProductProject(
  rawInput: ProductWizardInput,
  clipInfos: ClipDurationInfo[],
): Project {
  const input = productWizardInputSchema.parse(rawInput)
  const durationByFile = new Map(clipInfos.map((info) => [info.file, info.durationSec]))

  const clips = input.clips.map((file, index) => {
    const duration = durationByFile.get(file)
    if (duration === undefined || duration <= 0) {
      throw new Error(`클립 길이를 알 수 없습니다: ${file}`)
    }
    return {
      file,
      role: CLIP_ROLES[index % CLIP_ROLES.length] as (typeof CLIP_ROLES)[number],
      start: 0,
      end: round2(duration),
    }
  })

  const totalDuration = round2(clips.reduce((sum, clip) => sum + clip.end, 0))

  return projectSchema.parse({
    projectName: input.projectName,
    product: {
      name: input.productName,
      category: input.category || '쇼핑',
      priceRange: '0-0',
      affiliateUrl: fallbackUrl(input.affiliateUrl),
      painPoint: input.painPoint.trim() || `${input.productName} 관련 불편함`,
      benefit: input.benefit.trim() || `${input.productName}의 장점`,
    },
    disclosure: {
      type: 'affiliate',
      text: '이 콘텐츠는 제휴 활동의 일환으로 수수료를 제공받을 수 있습니다.',
    },
    style: {
      duration: totalDuration,
      ratio: '9:16',
      resolution: '1080x1920',
      tone: 'friend',
      captionPosition: 'bottom',
      bgmVolume: 0.18,
    },
    clips,
    ...(input.narrationFile
      ? { narration: { file: input.narrationFile, volume: 1, originalVolume: 0.2 } }
      : {}),
    variants: { count: input.variants },
    publish: {
      platforms: ['youtube_shorts', 'instagram_reels', 'tiktok'],
      hashtags: [input.productName],
      cta: '자세한 정보는 프로필 링크에서 확인하세요.',
    },
    sources: clips.map((clip) => ({
      title: `업로드 클립: ${clip.file}`,
      file: clip.file,
      rights: 'owned',
      usage: 'edit',
    })),
  })
}
