import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import YAML from 'yaml'
import { z } from 'zod'
import { buildStoryScenes, storyProjectSchema } from '../modes/story.js'

export const storyImageGenerationInputSchema = storyProjectSchema.extend({
  productName: z.string().min(1).default('Story Channel'),
  affiliateUrl: z.string().url().default('https://example.com/story'),
  sceneDurationSec: z.number().positive().default(4),
  /** 사용자 참조 이미지(절대경로) — 있으면 캐릭터/세트 시트 자동 생성을 생략하고 이를 참조로 쓴다(예: 쿠팡 상품 캡처). */
  referenceImages: z.array(z.string().min(1)).default([]),
  /** 스토리보드에 실을 고지 문구(예: 쿠팡파트너스 대가성 고지). 최종 렌더 하단 자막으로 구워진다. */
  disclosure: z.string().min(1).optional(),
})

export type StoryImageGenerationInput = z.input<typeof storyImageGenerationInputSchema>
export type StoryImageGenerationProject = z.infer<typeof storyImageGenerationInputSchema>

export interface GeneratedStoryImage {
  index: number
  prompt: string
  imageFile: string
  narration: string
  caption: string
}

export interface GenerateStoryImagesResult {
  storyboardPath: string
  reportPath: string
  images: GeneratedStoryImage[]
}

export interface ImageGenerationProvider {
  name: string
  model: string
  /** 참조 이미지(인물·세트 고정)를 지원하면 true — 캐릭터/세트 시트 선행 생성 대상. */
  supportsReference?: boolean
  generateImage(prompt: string, options?: { referenceImagePaths?: string[] }): Promise<Buffer>
}

interface FetchResponseLike {
  ok: boolean
  status: number
  text(): Promise<string>
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<FetchResponseLike>

interface OpenAIResponseOutput {
  type?: unknown
  result?: unknown
  content?: unknown
}

interface OpenAIResponseBody {
  output?: unknown
}

export interface OpenAIImageProviderOptions {
  apiKey: string
  model?: string
  /** image_generation 툴의 이미지 모델 지정(예: gpt-image-2 = "덕테이프"). 없으면 기본 모델. */
  imageToolModel?: string
  fetchImpl?: FetchLike
}

export interface GeminiImageProviderOptions {
  apiKey: string
  model?: string
  fetchImpl?: FetchLike
}

export interface LeadersNanoBananaProviderOptions {
  apiKey: string
  endpoint: string
  model?: string
  fetchImpl?: FetchLike
}

export interface GenerateStoryImagesOptions {
  outDir: string
  provider: ImageGenerationProvider
  /** AI 촬영감독의 장면별 숏 연출(문장 순서와 같은 배열). */
  shots?: string[]
  /** 세트 시트 — 반복 등장하는 장소·소품의 고정 시각 디테일. */
  world?: string
}

const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
)

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function findImageBase64(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findImageBase64(item)
      if (found) return found
    }
    return null
  }
  if (!isRecord(value)) return null

  for (const key of ['result', 'image_base64', 'b64_json', 'inlineData', 'inline_data', 'data']) {
    const found = findImageBase64(value[key])
    if (found) return found
  }
  return null
}

function normalizeBase64(value: string): string {
  return value.replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '').trim()
}

function imageMimeType(path: string): string {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}

async function readReferenceImages(
  paths: string[] | undefined,
): Promise<Array<{ base64: string; mimeType: string }>> {
  if (!paths || paths.length === 0) return []
  const images: Array<{ base64: string; mimeType: string }> = []
  for (const path of paths) {
    const data = await readFile(path)
    images.push({ base64: data.toString('base64'), mimeType: imageMimeType(path) })
  }
  return images
}

export function extractOpenAIImageBase64(response: unknown): string {
  const body = response as OpenAIResponseBody
  const output = Array.isArray(body.output) ? (body.output as OpenAIResponseOutput[]) : []

  for (const item of output) {
    if (item.type === 'image_generation_call') {
      const found = findImageBase64(item.result)
      if (found) return normalizeBase64(found)
    }
  }

  const fallback = findImageBase64(output)
  if (fallback) return normalizeBase64(fallback)
  throw new Error('OpenAI image response did not include base64 image data.')
}

export function extractGeminiImageBase64(response: unknown): string {
  const body = isRecord(response) ? response : {}
  const candidates = Array.isArray(body.candidates) ? body.candidates : []
  for (const candidate of candidates) {
    if (!isRecord(candidate) || !isRecord(candidate.content)) continue
    const parts = Array.isArray(candidate.content.parts) ? candidate.content.parts : []
    for (const part of parts) {
      if (!isRecord(part)) continue
      const inlineData = isRecord(part.inlineData) ? part.inlineData : part.inline_data
      if (isRecord(inlineData) && typeof inlineData.data === 'string' && inlineData.data.trim()) {
        return normalizeBase64(inlineData.data)
      }
    }
  }
  throw new Error('Gemini image response did not include base64 image data.')
}

export function extractGenericImageBase64(response: unknown, providerName: string): string {
  const found = findImageBase64(response)
  if (found) return normalizeBase64(found)
  throw new Error(`${providerName} image response did not include base64 image data.`)
}

export class OpenAIResponsesImageProvider implements ImageGenerationProvider {
  readonly name = 'gpt'
  readonly model: string
  readonly #apiKey: string
  readonly #fetchImpl: FetchLike

  readonly #imageToolModel?: string

  constructor(options: OpenAIImageProviderOptions) {
    if (!options.apiKey.trim()) throw new Error('OPENAI_API_KEY is required for GPT image generation.')
    this.model = options.model ?? 'gpt-5.5'
    this.#apiKey = options.apiKey
    this.#imageToolModel = options.imageToolModel
    this.#fetchImpl = options.fetchImpl ?? fetch
  }

  async generateImage(prompt: string, options?: { referenceImagePaths?: string[] }): Promise<Buffer> {
    const references = await readReferenceImages(options?.referenceImagePaths)
    // 참조 이미지가 있으면 멀티모달 입력, 없으면 종전과 동일한 문자열 입력을 유지한다.
    const input =
      references.length === 0
        ? prompt
        : [
            {
              role: 'user',
              content: [
                { type: 'input_text', text: prompt },
                ...references.map((image) => ({
                  type: 'input_image',
                  image_url: `data:${image.mimeType};base64,${image.base64}`,
                })),
              ],
            },
          ]
    const response = await this.#fetchImpl('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        input,
        tools: [{ type: 'image_generation', ...(this.#imageToolModel ? { model: this.#imageToolModel } : {}) }],
      }),
    })
    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`OpenAI image generation failed (${response.status}): ${raw.slice(0, 800)}`)
    }
    const base64 = extractOpenAIImageBase64(JSON.parse(raw))
    return Buffer.from(base64, 'base64')
  }
}

export class GeminiImageProvider implements ImageGenerationProvider {
  readonly name = 'gemini'
  readonly model: string
  readonly #apiKey: string
  readonly #fetchImpl: FetchLike

  constructor(options: GeminiImageProviderOptions) {
    if (!options.apiKey.trim()) throw new Error('GEMINI_API_KEY is required for Gemini image generation.')
    this.model = options.model ?? 'gemini-3-pro-image-preview'
    this.#apiKey = options.apiKey
    this.#fetchImpl = options.fetchImpl ?? fetch
  }

  async generateImage(prompt: string, options?: { referenceImagePaths?: string[] }): Promise<Buffer> {
    const references = await readReferenceImages(options?.referenceImagePaths)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      this.model,
    )}:generateContent?key=${encodeURIComponent(this.#apiKey)}`
    const response = await this.#fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: prompt },
              ...references.map((image) => ({
                inline_data: { mime_type: image.mimeType, data: image.base64 },
              })),
            ],
          },
        ],
      }),
    })
    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`Gemini image generation failed (${response.status}): ${raw.slice(0, 800)}`)
    }
    const base64 = extractGeminiImageBase64(JSON.parse(raw))
    return Buffer.from(base64, 'base64')
  }
}

export class LeadersNanoBananaImageProvider implements ImageGenerationProvider {
  readonly name = 'leaders-nano-banana-pro'
  readonly model: string
  readonly #apiKey: string
  readonly #endpoint: string
  readonly #fetchImpl: FetchLike

  constructor(options: LeadersNanoBananaProviderOptions) {
    if (!options.apiKey.trim()) throw new Error('LEADERS_NANO_BANANA_API_KEY is required.')
    if (!options.endpoint.trim()) throw new Error('LEADERS_NANO_BANANA_ENDPOINT is required.')
    this.model = options.model ?? 'nano-banana-pro'
    this.#apiKey = options.apiKey
    this.#endpoint = options.endpoint
    this.#fetchImpl = options.fetchImpl ?? fetch
  }

  async generateImage(prompt: string): Promise<Buffer> {
    const response = await this.#fetchImpl(this.#endpoint, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        prompt,
        aspectRatio: '9:16',
      }),
    })
    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`Leaders Nano Banana Pro image generation failed (${response.status}): ${raw.slice(0, 800)}`)
    }
    const base64 = extractGenericImageBase64(JSON.parse(raw), 'Leaders Nano Banana Pro')
    return Buffer.from(base64, 'base64')
  }
}

interface DropshotModule {
  makeDropshotImage(
    prompt: string,
    options?: Record<string, unknown>,
    onLog?: (message: string) => void,
  ): Promise<{ ok: boolean; dataUrl: string; error?: string }>
}

/** 드롭샷(나노바나나프로) — Playwright UI 자동화 기반. Pro 구독 시 이미지당 비용 0원. */
export class DropshotImageProvider implements ImageGenerationProvider {
  name = 'dropshot'
  model = 'google/nano-banana-pro'
  supportsReference = true

  async generateImage(prompt: string, options?: { referenceImagePaths?: string[] }): Promise<Buffer> {
    const { pathToFileURL } = await import('node:url')
    const { join } = await import('node:path')
    const moduleUrl = pathToFileURL(join(process.cwd(), 'scripts', 'dropshot-generator.mjs')).href
    const mod = (await import(moduleUrl)) as DropshotModule
    const result = await mod.makeDropshotImage(
      prompt,
      { aspectRatio: '9:16', referenceImagePaths: options?.referenceImagePaths },
      (message) => console.log(`  ${message}`),
    )
    if (!result.ok) throw new Error(result.error ?? '드롭샷 이미지 생성 실패')
    const match = /^data:image\/\w+;base64,(.+)$/.exec(result.dataUrl)
    if (!match) throw new Error('드롭샷 응답에서 이미지 데이터를 찾지 못했습니다.')
    return Buffer.from(match[1] as string, 'base64')
  }
}

export class MockImageProvider implements ImageGenerationProvider {
  readonly name = 'mock'
  readonly model = 'mock-1x1-png'

  async generateImage(_prompt: string): Promise<Buffer> {
    return MOCK_PNG
  }
}

export async function readStoryImageGenerationInput(path: string): Promise<StoryImageGenerationProject> {
  const raw = await readFile(path, 'utf8')
  return storyImageGenerationInputSchema.parse(YAML.parse(raw))
}

export async function generateStoryImages(
  input: StoryImageGenerationInput,
  options: GenerateStoryImagesOptions,
): Promise<GenerateStoryImagesResult> {
  const project = storyImageGenerationInputSchema.parse(input)
  const scenes = buildStoryScenes(project, options.shots, options.world)
  const imagesDir = join(options.outDir, 'images')
  await mkdir(imagesDir, { recursive: true })

  // 사용자 참조(예: 쿠팡 상품 캡처)가 있으면 캐릭터/세트 시트 자동 생성을 건너뛰고 이를 그대로 참조로 쓴다.
  const userReferences = project.referenceImages

  // 인물 고정: 참조 이미지를 지원하는 생성기면 주인공 초상(캐릭터 시트)을 먼저 만들고,
  // 모든 장면이 그 이미지를 참조해 같은 얼굴·머리·의상으로 그려지게 한다.
  let characterRefPath: string | undefined
  if (userReferences.length === 0 && project.character && options.provider.supportsReference) {
    // 초상도 대본의 톤·분위기를 따라간다(공포면 서늘한 조명, 밝은 주제면 밝은 톤) —
    // 단, 참조로 쓸 수 있게 얼굴은 또렷하게.
    const characterPrompt = [
      `character reference portrait of the main character: ${project.character}`,
      'Korean (East Asian), photorealistic, upper body, facing camera, face clearly visible',
      `styled to match the mood of this story — title: ${project.title}, tone: ${project.tone}`,
      project.imageStyle,
      'simple background that fits the story mood, cinematic lighting, Korean drama still quality',
      project.ratio === '16:9' ? 'horizontal 16:9, no text in image' : 'vertical 9:16, no text in image',
    ].join(', ')
    const portrait = await options.provider.generateImage(characterPrompt)
    characterRefPath = join(imagesDir, 'character.png')
    await writeFile(characterRefPath, portrait)
  }

  // 세트 고정: 세트 시트(world)가 있으면 주 무대의 설정샷(사람 없는 빈 장소)을 만들어
  // 모든 장면이 같은 문·복도·건물을 그대로 쓰게 참조로 넘긴다.
  let setRefPath: string | undefined
  if (userReferences.length === 0 && options.world && options.provider.supportsReference) {
    const setPrompt = [
      `establishing shot of the main recurring location of this story: ${options.world}`,
      'empty scene, no people, photorealistic',
      project.imageStyle,
      `tone: ${project.tone}`,
      'this exact location will be reused in every scene of the story — show the key door, hallway and lighting clearly',
      project.ratio === '16:9'
        ? 'horizontal 16:9 widescreen composition, no text in image'
        : 'vertical 9:16 composition, no text in image',
    ].join(', ')
    const setShot = await options.provider.generateImage(setPrompt)
    setRefPath = join(imagesDir, 'set.png')
    await writeFile(setRefPath, setShot)
  }

  const referencePaths =
    userReferences.length > 0
      ? userReferences
      : ([characterRefPath, setRefPath].filter(Boolean) as string[])
  const referenceNote =
    userReferences.length > 0
      ? project.promptProfile === 'product'
        ? 'the product must look exactly identical to the attached product reference photos: same shape, color, logo, materials and proportions'
        : 'match the attached reference images exactly: keep the same subjects, faces, objects and visual details'
      : referencePaths.length > 0
        ? [
            characterRefPath
              ? 'the main character must be the exact same person as in the attached character reference image: identical face, hairstyle and outfit'
              : '',
            setRefPath
              ? 'recurring locations must exactly match the attached location reference image: same door, same hallway, same building, same lighting fixtures'
              : '',
          ]
            .filter(Boolean)
            .join(', ')
        : ''

  const generated: GeneratedStoryImage[] = []
  for (const scene of scenes) {
    const relFile = `images/scene_${pad2(scene.index)}.png`
    const scenePrompt = referenceNote ? `${scene.imagePrompt}, ${referenceNote}` : scene.imagePrompt
    const image = await options.provider.generateImage(
      scenePrompt,
      referencePaths.length > 0 ? { referenceImagePaths: referencePaths } : undefined,
    )
    await writeFile(join(options.outDir, relFile), image)
    generated.push({
      index: scene.index,
      prompt: scene.imagePrompt,
      imageFile: relFile,
      narration: scene.narration,
      caption: scene.caption,
    })
  }

  const storyboard = {
    projectName: project.projectName,
    title: project.title,
    productName: project.productName,
    affiliateUrl: project.affiliateUrl,
    ...(project.disclosure ? { disclosure: project.disclosure } : {}),
    imageRights: 'ai_generated' as const,
    ratio: project.ratio,
    scenes: generated.map((image) => ({
      image: image.imageFile,
      narration: image.narration,
      caption: image.caption,
      durationSec: project.sceneDurationSec,
    })),
  }
  const report = {
    projectName: project.projectName,
    title: project.title,
    provider: options.provider.name,
    model: options.provider.model,
    imageCount: generated.length,
    images: generated,
  }
  const storyboardPath = join(options.outDir, 'storyboard.json')
  const reportPath = join(options.outDir, 'image_generation_report.json')
  await writeFile(storyboardPath, JSON.stringify(storyboard, null, 2), 'utf8')
  await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')
  return { storyboardPath, reportPath, images: generated }
}
