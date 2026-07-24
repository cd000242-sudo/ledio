import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import YAML from 'yaml'
import {
  buildStoryProjectFromAssets,
  renderStoryImageClip,
  storyAssetBundleSchema,
} from '../../modes/storyAssets.js'
import { ensureFfmpeg } from '../../video/ffmpeg.js'
import { logger } from '../../utils/logger.js'

interface StoryboardRenderOptions {
  outDir?: string
  /** scene_XX.mp4 형태의 i2v 결과가 들어있는 폴더. 있으면 정지 이미지 대신 사용한다. */
  motionDir?: string
  /** 배경음악 파일 경로. 최종 렌더에서 낮은 볼륨으로 깔린다. */
  bgm?: string
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function resolveInputPath(baseDir: string, file: string): string {
  return resolve(baseDir, file)
}

export async function runStoryboardRender(
  inputPath: string,
  options: StoryboardRenderOptions = {},
): Promise<number> {
  logger.step(`Rendering storyboard images: ${inputPath}`)

  try {
    await ensureFfmpeg()
    const resolvedInput = resolve(inputPath)
    const inputDir = dirname(resolvedInput)
    const raw = await readFile(resolvedInput, 'utf8')
    const bundle = storyAssetBundleSchema.parse(YAML.parse(raw))
    const outDir = resolve(options.outDir ?? join(inputDir, `${bundle.projectName}-story-video`))
    const clipsDir = join(outDir, 'clips')
    const clipFiles: string[] = []

    await mkdir(clipsDir, { recursive: true })
    for (let index = 0; index < bundle.scenes.length; index++) {
      const scene = bundle.scenes[index]
      if (!scene) continue
      const clipRel = `clips/scene_${pad2(index + 1)}.mp4`
      const clipPath = join(outDir, clipRel)
      const motionCandidate = options.motionDir
        ? resolve(options.motionDir, `scene_${pad2(index + 1)}.mp4`)
        : ''
      const motionVideoPath = motionCandidate && existsSync(motionCandidate) ? motionCandidate : undefined
      const wide = bundle.ratio === '16:9'
      await renderStoryImageClip({
        imagePath: resolveInputPath(inputDir, scene.image),
        outPath: clipPath,
        durationSec: scene.durationSec,
        caption: scene.caption ?? scene.narration,
        narrationAudio: scene.narrationAudio
          ? resolveInputPath(inputDir, scene.narrationAudio)
          : undefined,
        motionVideoPath,
        width: wide ? 1920 : 1080,
        height: wide ? 1080 : 1920,
      })
      clipFiles.push(clipRel)
      logger.dim(`  scene ${index + 1}/${bundle.scenes.length}: ${clipRel}${motionVideoPath ? ' (i2v 영상)' : ''}`)
    }

    // BGM이 있으면 렌더 폴더 안으로 복사해 project.yaml이 상대경로로 참조하게 한다.
    let bgmRel: string | undefined
    if (options.bgm && existsSync(resolve(options.bgm))) {
      const { copyFile } = await import('node:fs/promises')
      const ext = (resolve(options.bgm).split('.').pop() || 'mp3').toLowerCase()
      bgmRel = `audio/bgm.${ext}`
      await mkdir(join(outDir, 'audio'), { recursive: true })
      await copyFile(resolve(options.bgm), join(outDir, bgmRel))
      logger.dim(`  배경음악: ${options.bgm} → ${bgmRel}`)
    }

    const project = buildStoryProjectFromAssets(bundle, clipFiles, bgmRel)
    const projectPath = join(outDir, 'project.yaml')
    const reportPath = join(outDir, 'story_video_report.json')
    await writeFile(projectPath, YAML.stringify(project), 'utf8')
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          projectName: bundle.projectName,
          title: bundle.title,
          sceneCount: bundle.scenes.length,
          projectPath,
          clips: clipFiles,
        },
        null,
        2,
      ),
      'utf8',
    )

    logger.success(`Storyboard project: ${projectPath}`)
    logger.success(`Storyboard report: ${reportPath}`)
    return 0
  } catch (err) {
    logger.error(`Storyboard render failed: ${(err as Error).message}`)
    return 1
  }
}
