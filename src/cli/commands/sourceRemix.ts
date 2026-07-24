import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import YAML from 'yaml'
import { logger } from '../../utils/logger.js'
import {
  buildSegmentCutArgs,
  buildSubtitleBlurFilter,
  planRemixSegments,
  remixPlanSchema,
  type RemixPlan,
} from '../../modes/remixPlan.js'
import { storyAssetBundleSchema } from '../../modes/storyAssets.js'
import { ensureFfmpeg, runFfmpeg } from '../../video/ffmpeg.js'
import { runNarrate } from './narrate.js'
import { runStoryboardRender } from './storyboardRender.js'
import { runRender } from './render.js'

export interface SourceRemixOptions {
  voice: string
  ttsProvider?: string
  delivery?: string
  outDir?: string
}

const STAGES = ['analyze', 'narrate', 'cut', 'clips', 'render'] as const
type RemixStage = (typeof STAGES)[number]

/** progress.json — {status,stages,current,completed,updatedAt} 계약(UI 게이지·회로차단기). */
async function writeProgress(
  outDir: string,
  status: 'running' | 'done' | 'error',
  current: RemixStage | null,
  completed: RemixStage[],
): Promise<void> {
  try {
    await writeFile(
      join(outDir, 'progress.json'),
      JSON.stringify({ status, stages: STAGES, current, completed, updatedAt: new Date().toISOString() }, null, 2),
      'utf8',
    )
  } catch {
    // 진행 표시는 부가 기능
  }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function resolveFromPlan(baseDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(baseDir, path)
}

/** plan의 문장들을 스토리보드(장면=문장 1:1)로 변환한다. image는 대표 프레임(세그먼트 실패 시 폴백). */
function buildRemixStoryboard(plan: RemixPlan, baseDir: string): unknown {
  return storyAssetBundleSchema.parse({
    projectName: plan.projectName,
    title: plan.title ?? plan.projectName,
    productName: plan.title ?? plan.projectName,
    ...(plan.disclosure ? { disclosure: plan.disclosure } : {}),
    imageRights: 'owned',
    ratio: plan.ratio,
    scenes: plan.sentences.map((sentence, index) => {
      const source = plan.sources[plan.assignments[index] as number]
      return {
        image: resolveFromPlan(baseDir, source?.frame ?? ''),
        narration: sentence,
        durationSec: 3,
      }
    }),
  })
}

/**
 * 소스 짜집기 파이프라인: plan.json → 나레이션(실측 길이) → 소스 컷·자막 블러 → 12자 센터 자막 클립 → 최종 렌더.
 * 원본 오디오는 클립 렌더가 나레이션/무음만 매핑하므로 구조적으로 제거된다(-an은 이중 안전).
 */
export async function runSourceRemix(planPath: string, options: SourceRemixOptions): Promise<number> {
  const resolvedPlan = resolve(planPath)
  const baseDir = dirname(resolvedPlan)
  let plan: RemixPlan
  try {
    plan = remixPlanSchema.parse(JSON.parse(await readFile(resolvedPlan, 'utf8')))
  } catch (err) {
    logger.error(`리믹스 계획을 읽을 수 없습니다: ${(err as Error).message}`)
    return 1
  }
  if (!options.voice) {
    logger.error('소스 짜집기에는 --voice가 필요합니다(자막이 목소리 타이밍에 맞춰집니다).')
    return 1
  }

  const outDir = resolve(options.outDir ?? baseDir)
  const storyboardYaml = join(outDir, 'storyboard.yaml')
  const narratedYaml = join(outDir, 'storyboard.narrated.yaml')
  const motionDir = join(outDir, 'motion')
  const videoDir = join(outDir, 'video')
  const finalVideo = join(videoDir, 'output', 'video_01.mp4')

  logger.step(`소스 짜집기: ${plan.projectName} (문장 ${plan.sentences.length}개, 소스 ${plan.sources.length}개)`)
  try {
    await ensureFfmpeg()
    await mkdir(outDir, { recursive: true })
    // analyze(비전·매칭)는 서버가 이미 끝냈다 — plan.json 존재 자체가 완료 증거.
    await writeProgress(outDir, 'running', 'narrate', ['analyze'])

    // ── narrate: 문장별 TTS + 실측 길이 반영 스토리보드 ──
    await writeFile(storyboardYaml, YAML.stringify(buildRemixStoryboard(plan, baseDir)), 'utf8')
    const narrateCode = await runNarrate(storyboardYaml, {
      voice: options.voice,
      provider: options.ttsProvider,
      // narrationAudio 상대경로 계약: 반드시 스토리보드 옆 narration/ 이어야 한다.
      outDir: join(outDir, 'narration'),
      delivery: options.delivery,
    })
    if (narrateCode !== 0) {
      await writeProgress(outDir, 'error', 'narrate', ['analyze'])
      return narrateCode
    }
    await writeProgress(outDir, 'running', 'cut', ['analyze', 'narrate'])

    // ── cut: 배정된 소스에서 장면 길이만큼 잘라 motion/scene_XX.mp4 (자막 영역 블러 + -an) ──
    const narrated = storyAssetBundleSchema.parse(YAML.parse(await readFile(narratedYaml, 'utf8')))
    const durations = narrated.scenes.map((scene) => scene.durationSec)
    const segments = planRemixSegments(plan.sources, plan.assignments, durations)
    await mkdir(motionDir, { recursive: true })
    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]
      const source = plan.sources[segment?.sourceIndex ?? 0]
      if (!segment || !source) continue
      const outPath = join(motionDir, `scene_${pad2(index + 1)}.mp4`)
      if (existsSync(outPath)) continue
      const blurFilter = buildSubtitleBlurFilter(source.width, source.height, source.subtitleBand)
      await runFfmpeg(
        buildSegmentCutArgs({
          input: resolveFromPlan(baseDir, source.file),
          offsetSec: segment.offsetSec,
          cutSec: segment.cutSec,
          blurFilter,
          outPath,
        }),
      )
      logger.dim(
        `  컷 ${index + 1}/${segments.length}: 소스${segment.sourceIndex + 1} ${segment.offsetSec.toFixed(1)}s~ (${segment.cutSec.toFixed(1)}s)${blurFilter ? ' +자막 블러' : ''}`,
      )
    }
    await writeProgress(outDir, 'running', 'clips', ['analyze', 'narrate', 'cut'])

    // ── clips: 12자 센터 자막(TTS 동기) 장면 클립 ──
    const clipsCode = await runStoryboardRender(narratedYaml, {
      outDir: videoDir,
      motionDir,
      captionPosition: 'center',
      captionMaxChars: 12,
    })
    if (clipsCode !== 0) {
      await writeProgress(outDir, 'error', 'clips', ['analyze', 'narrate', 'cut'])
      return clipsCode
    }
    await writeProgress(outDir, 'running', 'render', ['analyze', 'narrate', 'cut', 'clips'])

    // ── render: 최종 합성 ──
    const renderCode = await runRender(videoDir)
    if (renderCode !== 0) {
      await writeProgress(outDir, 'error', 'render', ['analyze', 'narrate', 'cut', 'clips'])
      return renderCode
    }
    await writeProgress(outDir, 'done', null, [...STAGES])
    logger.success(`짜집기 완성: ${finalVideo}`)
    return 0
  } catch (err) {
    logger.error(`소스 짜집기 실패: ${(err as Error).message}`)
    await writeProgress(outDir, 'error', null, [])
    return 1
  }
}
