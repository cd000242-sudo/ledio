import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  extractGeminiImageBase64,
  extractOpenAIImageBase64,
  generateStoryImages,
  GeminiImageProvider,
  LeadersNanoBananaImageProvider,
  MockImageProvider,
  OpenAIResponsesImageProvider,
} from './imageGeneration.js'

const tempRoots: string[] = []

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'story-images-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('image generation', () => {
  it('extracts base64 image output from an OpenAI Responses result', () => {
    const base64 = Buffer.from('png').toString('base64')

    expect(
      extractOpenAIImageBase64({
        output: [
          { type: 'message', content: [] },
          { type: 'image_generation_call', result: base64 },
        ],
      }),
    ).toBe(base64)
  })

  it('extracts base64 image output from a Gemini result', () => {
    const base64 = Buffer.from('gemini-png').toString('base64')

    expect(
      extractGeminiImageBase64({
        candidates: [
          {
            content: {
              parts: [{ inlineData: { mimeType: 'image/png', data: base64 } }],
            },
          },
        ],
      }),
    ).toBe(base64)
  })

  it('calls OpenAI Responses with the image_generation tool', async () => {
    const base64 = Buffer.from('openai-image').toString('base64')
    const calls: Array<{ url: string; body: unknown; auth: string | undefined }> = []
    const provider = new OpenAIResponsesImageProvider({
      apiKey: 'test-key',
      model: 'gpt-5.5',
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          body: JSON.parse(init.body) as unknown,
          auth: init.headers.authorization,
        })
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              output: [{ type: 'image_generation_call', result: base64 }],
            }),
        }
      },
    })

    const result = await provider.generateImage('vertical story scene')

    expect(result.toString()).toBe('openai-image')
    expect(calls[0]?.url).toBe('https://api.openai.com/v1/responses')
    expect(calls[0]?.auth).toBe('Bearer test-key')
    expect(calls[0]?.body).toMatchObject({
      model: 'gpt-5.5',
      input: 'vertical story scene',
      tools: [{ type: 'image_generation' }],
    })
  })

  it('calls Gemini with the selected image model', async () => {
    const base64 = Buffer.from('gemini-image').toString('base64')
    const calls: Array<{ url: string; body: unknown }> = []
    const provider = new GeminiImageProvider({
      apiKey: 'gemini-key',
      model: 'gemini-image-model',
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          body: JSON.parse(init.body) as unknown,
        })
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              candidates: [{ content: { parts: [{ inlineData: { data: base64 } }] } }],
            }),
        }
      },
    })

    const result = await provider.generateImage('vertical story scene')

    expect(result.toString()).toBe('gemini-image')
    expect(calls[0]?.url).toContain('/models/gemini-image-model:generateContent')
    expect(calls[0]?.url).toContain('key=gemini-key')
    expect(calls[0]?.body).toMatchObject({
      contents: [{ role: 'user', parts: [{ text: 'vertical story scene' }] }],
    })
  })

  it('calls Leaders Nano Banana Pro through a private endpoint adapter', async () => {
    const base64 = Buffer.from('leaders-image').toString('base64')
    const calls: Array<{ url: string; body: unknown; auth: string | undefined }> = []
    const provider = new LeadersNanoBananaImageProvider({
      apiKey: 'leaders-key',
      endpoint: 'https://leaders.example.test/image',
      model: 'nano-banana-pro',
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          body: JSON.parse(init.body) as unknown,
          auth: init.headers.authorization,
        })
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ image_base64: base64 }),
        }
      },
    })

    const result = await provider.generateImage('vertical story scene')

    expect(result.toString()).toBe('leaders-image')
    expect(calls[0]?.url).toBe('https://leaders.example.test/image')
    expect(calls[0]?.auth).toBe('Bearer leaders-key')
    expect(calls[0]?.body).toMatchObject({
      model: 'nano-banana-pro',
      prompt: 'vertical story scene',
      aspectRatio: '9:16',
    })
  })

  it('참조를 지원하는 생성기는 주인공 초상을 먼저 만들고 모든 장면이 그것을 참조한다', async () => {
    const outDir = await makeTempRoot()
    const calls: Array<{ prompt: string; refs?: string[] }> = []
    const provider = {
      name: 'fake-ref',
      model: 'fake-model',
      supportsReference: true,
      async generateImage(prompt: string, options?: { referenceImagePaths?: string[] }) {
        calls.push({ prompt, refs: options?.referenceImagePaths })
        return Buffer.from('png')
      },
    }
    await generateStoryImages(
      {
        projectName: 'ref-test',
        title: '참조 테스트',
        script: '첫 문장입니다. 둘째 문장입니다.',
        maxSceneChars: 10,
        character: '한국인 남성, 30대, 짧은 검은 머리',
      },
      { outDir, provider },
    )

    // 첫 호출 = 캐릭터 시트(참조 없음), 이후 = 장면(캐릭터 참조)
    expect(calls.length).toBe(3)
    expect(calls[0]?.prompt).toContain('character reference')
    expect(calls[0]?.refs).toBeUndefined()
    await expect(readFile(join(outDir, 'images', 'character.png'))).resolves.toBeInstanceOf(Buffer)
    for (const call of calls.slice(1)) {
      expect(call.refs?.some((ref) => ref.includes('character.png'))).toBe(true)
      expect(call.prompt).toContain('reference image')
    }
  })

  it('세트 시트(world)가 있으면 설정샷을 만들어 장면들이 인물+세트 참조 2장을 쓴다', async () => {
    const outDir = await makeTempRoot()
    const calls: Array<{ prompt: string; refs?: string[] }> = []
    const provider = {
      name: 'fake-ref',
      model: 'fake-model',
      supportsReference: true,
      async generateImage(prompt: string, options?: { referenceImagePaths?: string[] }) {
        calls.push({ prompt, refs: options?.referenceImagePaths })
        return Buffer.from('png')
      },
    }
    await generateStoryImages(
      {
        projectName: 'set-test',
        title: '세트 테스트',
        script: '첫 문장입니다. 둘째 문장입니다.',
        maxSceneChars: 10,
        character: '한국인 남성, 30대',
      },
      { outDir, provider, world: '1990년대 복도식 아파트, 청록색 철문 1103호' },
    )

    // 캐릭터 시트 → 세트 설정샷 → 장면 2개
    expect(calls.length).toBe(4)
    expect(calls[1]?.prompt).toContain('establishing shot')
    expect(calls[1]?.prompt).toContain('1103호')
    await expect(readFile(join(outDir, 'images', 'set.png'))).resolves.toBeInstanceOf(Buffer)
    for (const call of calls.slice(2)) {
      expect(call.refs?.length).toBe(2)
      expect(call.refs?.some((ref) => ref.includes('set.png'))).toBe(true)
      expect(call.prompt).toContain('location reference')
    }
  })

  it('참조 미지원 생성기는 캐릭터 시트 없이 기존 방식으로 동작한다', async () => {
    const outDir = await makeTempRoot()
    const calls: string[] = []
    const provider = {
      name: 'fake-plain',
      model: 'fake-model',
      async generateImage(prompt: string) {
        calls.push(prompt)
        return Buffer.from('png')
      },
    }
    await generateStoryImages(
      {
        projectName: 'plain-test',
        title: '기본 테스트',
        script: '첫 문장입니다. 둘째 문장입니다.',
        maxSceneChars: 10,
        character: '한국인 남성',
      },
      { outDir, provider },
    )
    expect(calls.length).toBe(2)
  })

  it('generates storyboard files with a mock provider', async () => {
    const outDir = await makeTempRoot()

    const result = await generateStoryImages(
      {
        projectName: 'story-smoke',
        title: 'A Late Package',
        script: 'A package arrived after midnight. The label was dated tomorrow.',
        productName: 'Story Channel',
        affiliateUrl: 'https://example.com/story',
        sceneDurationSec: 3,
      },
      {
        outDir,
        provider: new MockImageProvider(),
      },
    )

    const storyboard = JSON.parse(await readFile(result.storyboardPath, 'utf8')) as {
      scenes: Array<{ image: string; durationSec: number }>
      imageRights: string
    }
    const report = JSON.parse(await readFile(result.reportPath, 'utf8')) as {
      provider: string
      imageCount: number
    }

    expect(storyboard.imageRights).toBe('ai_generated')
    expect(storyboard.scenes[0]?.image).toBe('images/scene_01.png')
    expect(storyboard.scenes[0]?.durationSec).toBe(3)
    expect(report.provider).toBe('mock')
    expect(report.imageCount).toBeGreaterThan(0)
    await expect(readFile(join(outDir, 'images', 'scene_01.png'))).resolves.toBeInstanceOf(Buffer)
  })
})
