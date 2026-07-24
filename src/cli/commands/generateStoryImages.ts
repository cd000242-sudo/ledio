import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  generateStoryImages,
  DropshotImageProvider,
  GeminiImageProvider,
  LeadersNanoBananaImageProvider,
  MockImageProvider,
  OpenAIResponsesImageProvider,
  readStoryImageGenerationInput,
} from '../../ai/imageGeneration.js'
import { logger } from '../../utils/logger.js'

interface GenerateStoryImagesOptions {
  outDir?: string
  provider?: string
  model?: string
  /** AI 촬영감독이 만든 장면별 숏 연출 JSON 경로(문장 순서와 같은 배열). */
  shots?: string
}

/** 숏 연출 파일을 읽는다. 형식이 이상하면 null(기본 프롬프트로 폴백). */
async function readShotPlan(path: string): Promise<{ shots: string[]; world: string } | null> {
  try {
    const parsed = JSON.parse(await readFile(resolve(path), 'utf8')) as
      | string[]
      | { shots?: string[]; world?: string }
    const shots = Array.isArray(parsed) ? parsed : parsed?.shots
    if (!Array.isArray(shots) || shots.length === 0) return null
    const world = Array.isArray(parsed) ? '' : String(parsed?.world ?? '').trim()
    return { shots: shots.map((shot) => String(shot)), world }
  } catch {
    return null
  }
}

function requireKey(envName: string, providerLabel: string): string {
  const key = process.env[envName]
  if (!key) {
    throw new Error(
      `${providerLabel} 이미지 생성에는 ${envName}가 필요합니다. ` +
        `키를 환경변수로 설정하거나, UI에서는 "API 키" 칸에 입력하세요. ` +
        `키 없이 테스트하려면 --provider mock 을 사용하세요.`,
    )
  }
  return key
}

function createProvider(options: GenerateStoryImagesOptions) {
  const provider = options.provider ?? 'openai'
  if (provider === 'mock') return new MockImageProvider()
  if (provider === 'openai' || provider === 'gpt') {
    // 모델명이 gpt-image-* 형태면 Responses 모델이 아니라 image_generation 툴의 이미지 모델 지정이다(예: GPT Image 2).
    const isImageToolModel = Boolean(options.model?.startsWith('gpt-image'))
    return new OpenAIResponsesImageProvider({
      apiKey: requireKey('OPENAI_API_KEY', 'GPT'),
      model: isImageToolModel ? undefined : options.model,
      imageToolModel: isImageToolModel ? options.model : undefined,
    })
  }
  if (provider === 'gemini') {
    return new GeminiImageProvider({
      apiKey: requireKey('GEMINI_API_KEY', 'Gemini'),
      model: options.model,
    })
  }
  if (provider === 'dropshot') return new DropshotImageProvider()
  if (provider === 'leaders_nano_banana_pro' || provider === 'leaders') {
    return new LeadersNanoBananaImageProvider({
      apiKey: process.env.LEADERS_NANO_BANANA_API_KEY ?? '',
      endpoint: process.env.LEADERS_NANO_BANANA_ENDPOINT ?? '',
      model: options.model,
    })
  }
  throw new Error(`Unknown image provider: ${provider}`)
}

export async function runGenerateStoryImages(
  inputPath: string,
  options: GenerateStoryImagesOptions = {},
): Promise<number> {
  logger.step(`Generating story images: ${inputPath}`)

  try {
    const input = await readStoryImageGenerationInput(resolve(inputPath))
    const outDir = resolve(options.outDir ?? `${input.projectName}-generated-images`)
    const provider = createProvider(options)
    let plan: { shots: string[]; world: string } | null = null
    if (options.shots) {
      plan = await readShotPlan(options.shots)
      if (plan) logger.dim(`  숏 연출 적용: ${plan.shots.length}개 장면${plan.world ? ' (+세트 시트)' : ''}`)
      else logger.warn('숏 연출 파일을 읽지 못해 기본 프롬프트로 진행합니다.')
    }
    const result = await generateStoryImages(input, {
      outDir,
      provider,
      shots: plan?.shots,
      world: plan?.world || undefined,
    })

    logger.success(`Storyboard: ${result.storyboardPath}`)
    logger.success(`Image report: ${result.reportPath}`)
    logger.dim(`  provider: ${provider.name}`)
    logger.dim(`  model: ${provider.model}`)
    logger.dim(`  images: ${result.images.length}`)
    return 0
  } catch (err) {
    logger.error(`Story image generation failed: ${(err as Error).message}`)
    return 1
  }
}
