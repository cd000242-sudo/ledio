import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { escapeFilterPath, resolveFontPath, runFfmpeg } from '../video/ffmpeg.js'
import { captionYExpression, type CaptionPosition } from '../video/captionStyle.js'
import type { ClipRole, Project } from '../config/schema.js'
import type { SceneCaptionCue } from '../captions/sceneCues.js'
import { wrapText } from '../utils/text.js'

export const storyAssetSceneSchema = z.object({
  image: z.string().min(1),
  narration: z.string().min(1),
  caption: z.string().min(1).optional(),
  durationSec: z.number().positive().default(4),
  /** narrate 명령이 생성한 장면 나레이션 wav(스토리보드 기준 상대경로) */
  narrationAudio: z.string().min(1).optional(),
})

export const storyAssetBundleSchema = z.object({
  projectName: z.string().min(1),
  title: z.string().min(1),
  productName: z.string().min(1).default('Story Channel'),
  affiliateUrl: z.string().url().default('https://example.com/story'),
  disclosure: z
    .string()
    .min(1)
    .default('This video uses AI-generated or user-provided story visuals.'),
  imageRights: z.enum(['owned', 'licensed', 'ai_generated']).default('ai_generated'),
  /** 화면 비율 — 숏폼 9:16(기본) 또는 롱폼 16:9. */
  ratio: z.enum(['9:16', '16:9']).default('9:16'),
  scenes: z.array(storyAssetSceneSchema).min(1),
})

export type StoryAssetBundleInput = z.input<typeof storyAssetBundleSchema>
export type StoryAssetBundle = z.infer<typeof storyAssetBundleSchema>
export type StoryAssetScene = z.infer<typeof storyAssetSceneSchema>

export interface RenderStoryImageOptions {
  imagePath: string
  outPath: string
  durationSec: number
  caption?: string
  /** 있으면 caption 대신 cue별로 시간 구간을 지정해 굽는다(TTS 동기 자막). */
  captionCues?: SceneCaptionCue[]
  /** 자막 위치. 지정하지 않으면 종전 하단 위치를 그대로 쓴다. */
  captionPosition?: CaptionPosition
  captionFontSize?: number
  fontPath?: string
  width?: number
  height?: number
  fps?: number
  /** 있으면 무음 대신 이 wav를 장면 오디오로 쓴다(짧으면 apad로 채움) */
  narrationAudio?: string
  /** 있으면 정지 이미지 대신 i2v 결과 영상을 장면 소스로 쓴다. */
  motionVideoPath?: string
}

export interface StoryClipArgsInput {
  imagePath: string
  outPath: string
  durationSec: number
  vf: string
  fps?: number
  narrationAudio?: string
  /** 있으면 정지 이미지 대신 이 영상(i2v 결과)을 장면 소스로 쓴다. 짧으면 반복 재생. */
  motionVideoPath?: string
}

/**
 * 장면 클립용 ffmpeg 인자를 만든다(순수 함수, 테스트 대상).
 * - 나레이션 없음: 무음 트랙 + -shortest
 * - 나레이션 있음: wav 입력 + apad(무음 패딩)로 durationSec까지 채움
 */
export function buildStoryClipArgs(input: StoryClipArgsInput): string[] {
  const fps = input.fps ?? 30
  const imageInput = input.motionVideoPath
    ? ['-stream_loop', '-1', '-i', input.motionVideoPath]
    : ['-loop', '1', '-framerate', String(fps), '-i', input.imagePath]
  const encode = [
    '-t',
    String(input.durationSec),
    '-vf',
    input.vf,
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-movflags',
    '+faststart',
    input.outPath,
  ]

  if (input.narrationAudio) {
    return ['-y', ...imageInput, '-i', input.narrationAudio, '-af', 'apad', ...encode]
  }
  return [
    '-y',
    ...imageInput,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest',
    ...encode,
  ]
}

function round2(value: number): number {
  return Number(value.toFixed(2))
}

function cleanCaption(scene: StoryAssetScene): string {
  const caption = scene.caption ?? scene.narration
  return caption.length > 72 ? `${caption.slice(0, 69).trim()}...` : caption
}

function sceneRole(index: number, total: number): ClipRole {
  if (index === 0) return 'hook'
  if (index === total - 1) return 'result'
  if (index === Math.floor(total / 2)) return 'use'
  const fallback: ClipRole[] = ['problem', 'product', 'cta']
  return fallback[(index - 1) % fallback.length] ?? 'problem'
}

export function buildStoryProjectFromAssets(
  input: StoryAssetBundleInput,
  clipFiles: string[],
  bgmFile?: string,
): Pick<Project, 'projectName' | 'product' | 'disclosure' | 'style' | 'clips' | 'variants' | 'publish' | 'sources' | 'bgm'> {
  const bundle = storyAssetBundleSchema.parse(input)
  if (clipFiles.length !== bundle.scenes.length) {
    throw new Error('clipFiles must match story scene count.')
  }

  const totalDuration = round2(bundle.scenes.reduce((sum, scene) => sum + scene.durationSec, 0))
  return {
    ...(bgmFile ? { bgm: { file: bgmFile } } : {}),
    projectName: bundle.projectName,
    product: {
      name: bundle.productName,
      category: 'story-channel',
      priceRange: '0-0',
      affiliateUrl: bundle.affiliateUrl,
      painPoint: 'Story scripts need fast visual production.',
      benefit: 'Turns prepared or AI-generated images into shorts-ready video scenes.',
    },
    disclosure: {
      type: 'story_visuals',
      text: bundle.disclosure,
    },
    style: {
      duration: totalDuration,
      ratio: bundle.ratio,
      resolution: bundle.ratio === '16:9' ? '1920x1080' : '1080x1920',
      tone: 'story',
      captionPosition: 'bottom',
      captionStyle: 'basic',
      transition: 'none',
      bgmVolume: 0.08,
    },
    clips: bundle.scenes.map((scene, index) => ({
      file: clipFiles[index] as string,
      role: sceneRole(index, bundle.scenes.length),
      start: 0,
      end: round2(scene.durationSec),
    })),
    variants: { count: 1 },
    publish: {
      campaignName: `${bundle.projectName}-story`,
      platforms: ['youtube_shorts', 'instagram_reels', 'tiktok'],
      hashtags: ['story', 'shorts', bundle.title],
      linkPlacement: 'profile_link',
      cta: 'Watch the next story from the channel.',
    },
    sources: bundle.scenes.map((scene, index) => ({
      title: `story scene ${index + 1}: ${cleanCaption(scene)}`,
      file: scene.image,
      rights: bundle.imageRights,
      usage: 'edit',
      notes: `narration: ${scene.narration}`,
    })),
  }
}

export interface CaptionDrawtextInput {
  caption?: string
  /** 있으면 caption보다 우선한다 — cue별 enable 구간으로 굽는다. */
  captionCues?: SceneCaptionCue[]
  fontPath: string
  /** 자막 텍스트 파일 이름의 밑동(예: `<outPath>.caption`). */
  captionFileBase: string
  height: number
  /** 지정하지 않으면 종전 스토리 클립의 하단 위치(y=h-height*0.28)를 유지한다. */
  position?: CaptionPosition
  fontSize?: number
  wrapChars?: number
}

function captionSec(value: number): string {
  return Math.max(0, value).toFixed(3)
}

/**
 * 장면 자막의 drawtext 필터와 텍스트 파일 목록을 만든다(순수 함수, 테스트 대상).
 * cue가 없으면 종전과 동일한 "장면 전체에 자막 1개" 필터를 그대로 만든다.
 */
export function buildCaptionDrawtextFilters(input: CaptionDrawtextInput): {
  files: Array<{ path: string; text: string }>
  filters: string[]
} {
  const fontSize = input.fontSize ?? 48
  const wrapChars = input.wrapChars ?? 18
  const fontEsc = escapeFilterPath(input.fontPath)
  const yExpr = input.position
    ? captionYExpression(input.position, input.height)
    : `h-${Math.round(input.height * 0.28)}`

  const baseParams = (textFile: string) => [
    `drawtext=fontfile='${fontEsc}'`,
    `textfile='${escapeFilterPath(textFile)}'`,
    'fontcolor=white',
    `fontsize=${fontSize}`,
    'box=1',
    'boxcolor=black@0.58',
    'boxborderw=18',
    'line_spacing=12',
    'x=(w-text_w)/2',
    `y=${yExpr}`,
  ]

  if (input.captionCues && input.captionCues.length > 0) {
    const files: Array<{ path: string; text: string }> = []
    const filters: string[] = []
    input.captionCues.forEach((cue, index) => {
      const path = `${input.captionFileBase}.${String(index + 1).padStart(2, '0')}.txt`
      files.push({ path, text: wrapText(cue.text, wrapChars) })
      filters.push(
        [...baseParams(path), `enable='between(t,${captionSec(cue.start)},${captionSec(cue.end)})'`].join(':'),
      )
    })
    return { files, filters }
  }

  if (input.caption) {
    const path = `${input.captionFileBase}.txt`
    return {
      files: [{ path, text: wrapText(input.caption, wrapChars) }],
      filters: [baseParams(path).join(':')],
    }
  }

  return { files: [], filters: [] }
}

export async function renderStoryImageClip(options: RenderStoryImageOptions): Promise<void> {
  const width = options.width ?? 1080
  const height = options.height ?? 1920
  const fps = options.fps ?? 30
  const vfParts = [
    `scale=${width}:${height}:force_original_aspect_ratio=increase`,
    `crop=${width}:${height}`,
    'setsar=1',
    `fps=${fps}`,
  ]

  const captionResult = buildCaptionDrawtextFilters({
    caption: options.caption,
    captionCues: options.captionCues,
    fontPath: options.fontPath ?? resolveFontPath(),
    captionFileBase: `${options.outPath}.caption`,
    height,
    position: options.captionPosition,
    fontSize: options.captionFontSize,
  })
  if (captionResult.files.length > 0) {
    await mkdir(dirname(options.outPath), { recursive: true })
    for (const file of captionResult.files) {
      await writeFile(file.path, file.text, 'utf8')
    }
    vfParts.push(...captionResult.filters)
  }

  await mkdir(dirname(options.outPath), { recursive: true })
  await runFfmpeg(
    buildStoryClipArgs({
      imagePath: options.imagePath,
      outPath: options.outPath,
      durationSec: options.durationSec,
      vf: vfParts.join(','),
      fps,
      narrationAudio: options.narrationAudio,
      motionVideoPath: options.motionVideoPath,
    }),
  )
}
