import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import YAML from 'yaml'
import { logger } from '../../utils/logger.js'
import { readStoryImageGenerationInput } from '../../ai/imageGeneration.js'
import { planPipelineStages, type PipelineStage } from '../../pipeline/storyPipeline.js'
import { runGenerateStoryImages } from './generateStoryImages.js'
import { runNarrate } from './narrate.js'
import { runStoryboardRender } from './storyboardRender.js'
import { runRender } from './render.js'

export interface StoryPipelineOptions {
  voice?: string
  imageProvider?: string
  imageModel?: string
  ttsProvider?: string
  outDir?: string
  force?: boolean
  /** 장면 영상화: none(정지 이미지) | hook(첫 장면만) | all(전체) */
  motionMode?: string
  /** 영상화 엔진: seedance(fal.ai, FAL_KEY 필요) | dropshot(구독 크레딧) */
  motionEngine?: string
  /** 배경음악 파일 경로(선택). 최종 렌더에 낮은 볼륨으로 깔린다. */
  bgm?: string
  /** AI 촬영감독 숏 연출 JSON 경로(선택). 장면별 구도·앵글·감정 지시. */
  shots?: string
  /** 문장별 낭독 말투 연출 계획 JSON 경로. */
  delivery?: string
}

interface PipelinePaths {
  outDir: string
  storyboardJson: string
  storyboardYaml: string
  narratedYaml: string
  videoDir: string
  projectYaml: string
  finalVideo: string
}

function buildPaths(inputPath: string, projectName: string, outDir?: string): PipelinePaths {
  const base = resolve(outDir ?? join(dirname(resolve(inputPath)), `${projectName}-pipeline`))
  const videoDir = join(base, 'video')
  return {
    outDir: base,
    storyboardJson: join(base, 'storyboard.json'),
    storyboardYaml: join(base, 'storyboard.yaml'),
    narratedYaml: join(base, 'storyboard.narrated.yaml'),
    videoDir,
    projectYaml: join(videoDir, 'project.yaml'),
    finalVideo: join(videoDir, 'output', 'video_01.mp4'),
  }
}

async function jsonToYaml(jsonPath: string, yamlPath: string): Promise<void> {
  const data = JSON.parse(await readFile(jsonPath, 'utf8')) as unknown
  await writeFile(yamlPath, YAML.stringify(data), 'utf8')
}

interface MotionStageOptions {
  mode: 'hook' | 'all'
  engine: 'seedance' | 'dropshot'
  force: boolean
}

interface MotionModule {
  makeSeedanceVideo?: (
    prompt: string,
    options: { apiKey: string; imagePath: string; outPath: string; durationSec?: number; resolution?: string },
    onLog?: (message: string) => void,
  ) => Promise<{ ok: boolean; error?: string }>
  makeDropshotVideo?: (
    prompt: string,
    options: { imagePath: string; outPath: string },
    onLog?: (message: string) => void,
  ) => Promise<{ ok: boolean; error?: string }>
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/** 장면 이미지들을 i2v 엔진으로 영상화한다. 이미 있는 scene_XX.mp4는 건너뛴다(재개 가능). */
async function runMotionStage(paths: PipelinePaths, options: MotionStageOptions): Promise<number> {
  const { mkdir } = await import('node:fs/promises')
  const { pathToFileURL } = await import('node:url')
  const raw = await readFile(paths.storyboardJson, 'utf8')
  const bundle = JSON.parse(raw) as { scenes?: Array<{ image: string; narration?: string }> }
  const scenes = bundle.scenes ?? []
  if (scenes.length === 0) {
    logger.error('storyboard에 장면이 없습니다.')
    return 1
  }
  const motionDir = join(paths.outDir, 'motion')
  await mkdir(motionDir, { recursive: true })
  const targets = options.mode === 'hook' ? [0] : scenes.map((_, index) => index)

  const moduleFile = options.engine === 'dropshot' ? 'dropshot-generator.mjs' : 'seedance-generator.mjs'
  const mod = (await import(
    pathToFileURL(join(process.cwd(), 'scripts', moduleFile)).href
  )) as MotionModule

  for (const index of targets) {
    const scene = scenes[index]
    if (!scene) continue
    const outPath = join(motionDir, `scene_${pad2(index + 1)}.mp4`)
    if (!options.force && existsSync(outPath)) {
      logger.dim(`  장면 ${index + 1}: 이미 영상화됨 (스킵)`)
      continue
    }
    const imagePath = resolve(paths.outDir, scene.image)
    const motionPrompt = `${scene.narration ?? ''}. 이 이미지의 인물과 배경을 그대로 유지한 채 자연스럽고 부드러운 움직임과 은은한 카메라 이동을 넣어줘.`
    logger.step(`  장면 ${index + 1}/${scenes.length} 영상화 (${options.engine})`)
    const result =
      options.engine === 'dropshot'
        ? await mod.makeDropshotVideo?.(motionPrompt, { imagePath, outPath }, (m) => logger.dim(`  ${m}`))
        : await mod.makeSeedanceVideo?.(
            motionPrompt,
            { apiKey: process.env.FAL_KEY ?? '', imagePath, outPath, durationSec: 5, resolution: '480p' },
            (m) => logger.dim(`  ${m}`),
          )
    if (!result?.ok) {
      logger.error(`장면 ${index + 1} 영상화 실패: ${result?.error ?? '알 수 없는 오류'}`)
      return 1
    }
  }
  logger.success(`영상화 완료: ${targets.length}개 장면 → ${motionDir}`)
  return 0
}

export interface PipelineProgress {
  status: 'running' | 'done' | 'error'
  stages: PipelineStage[]
  current: PipelineStage | null
  completed: PipelineStage[]
  updatedAt: string
}

/** UI/폴링용 진행 상태 파일. 실패해도 파이프라인 자체는 막지 않는다. */
async function writeProgress(outDir: string, progress: PipelineProgress): Promise<void> {
  try {
    await writeFile(join(outDir, 'progress.json'), JSON.stringify(progress, null, 2), 'utf8')
  } catch {
    // 진행 표시는 부가 기능 — 기록 실패는 무시
  }
}

/**
 * 스토리 쇼츠 전체 파이프라인: 이미지 생성 → 나레이션 → 장면 클립 → 최종 렌더.
 * 단계 산출물이 있으면 그 지점부터 재개한다(--force로 전체 재실행).
 */
export async function runStoryPipeline(
  inputPath: string,
  options: StoryPipelineOptions = {},
): Promise<number> {
  let projectName: string
  try {
    projectName = (await readStoryImageGenerationInput(resolve(inputPath))).projectName
  } catch (err) {
    logger.error(`입력을 읽을 수 없습니다: ${(err as Error).message}`)
    return 1
  }

  const paths = buildPaths(inputPath, projectName, options.outDir)
  const skipNarration = !options.voice
  const motionEnabled = options.motionMode === 'hook' || options.motionMode === 'all'
  const stages = planPipelineStages({
    force: options.force ?? false,
    skipNarration,
    useMotion: motionEnabled,
    hasMotion: existsSync(join(paths.outDir, 'motion', 'scene_01.mp4')),
    hasStoryboard: existsSync(paths.storyboardJson),
    hasNarrated: existsSync(paths.narratedYaml),
    hasProject: existsSync(paths.projectYaml),
    hasVideo: existsSync(paths.finalVideo),
  })

  logger.step(`스토리 파이프라인: ${projectName}`)
  if (skipNarration) logger.warn('--voice 미지정: 나레이션 없이(자막만) 만듭니다.')
  if (stages.length === 0) {
    logger.success(`이미 완성됨: ${paths.finalVideo} (--force로 재실행 가능)`)
    return 0
  }
  logger.dim(`  실행 단계: ${stages.join(' → ')}`)

  const runners: Record<PipelineStage, () => Promise<number>> = {
    images: async () => {
      const code = await runGenerateStoryImages(inputPath, {
        outDir: paths.outDir,
        provider: options.imageProvider,
        model: options.imageModel,
        shots: options.shots,
      })
      if (code === 0) await jsonToYaml(paths.storyboardJson, paths.storyboardYaml)
      return code
    },
    motion: () =>
      runMotionStage(paths, {
        mode: options.motionMode === 'all' ? 'all' : 'hook',
        engine: options.motionEngine === 'dropshot' ? 'dropshot' : 'seedance',
        force: options.force ?? false,
      }),
    narrate: () =>
      runNarrate(paths.storyboardYaml, {
        voice: options.voice as string,
        provider: options.ttsProvider,
        outDir: join(paths.outDir, 'narration'),
        delivery: options.delivery,
      }),
    clips: () =>
      runStoryboardRender(skipNarration ? paths.storyboardYaml : paths.narratedYaml, {
        outDir: paths.videoDir,
        motionDir: motionEnabled ? join(paths.outDir, 'motion') : undefined,
        bgm: options.bgm,
      }),
    render: () => runRender(paths.videoDir),
  }

  const { mkdir } = await import('node:fs/promises')
  await mkdir(paths.outDir, { recursive: true })
  const completed: PipelineStage[] = []

  for (const stage of stages) {
    logger.step(`[${stages.indexOf(stage) + 1}/${stages.length}] ${stage}`)
    await writeProgress(paths.outDir, {
      status: 'running',
      stages,
      current: stage,
      completed: [...completed],
      updatedAt: new Date().toISOString(),
    })
    const code = await runners[stage]()
    if (code !== 0) {
      logger.error(`${stage} 단계 실패 — 수정 후 같은 명령으로 재개할 수 있습니다.`)
      await writeProgress(paths.outDir, {
        status: 'error',
        stages,
        current: stage,
        completed: [...completed],
        updatedAt: new Date().toISOString(),
      })
      return code
    }
    completed.push(stage)
  }

  await writeProgress(paths.outDir, {
    status: 'done',
    stages,
    current: null,
    completed: [...completed],
    updatedAt: new Date().toISOString(),
  })
  logger.success(`완성: ${paths.finalVideo}`)
  return 0
}
