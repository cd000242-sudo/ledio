import { mkdir, rm, access } from 'node:fs/promises'
import { join } from 'node:path'
import { loadProject } from '../../config/loadProject.js'
import { resolveClipPath } from '../../utils/paths.js'
import { logger } from '../../utils/logger.js'
import { ensureFfmpeg, resolveFontPath } from '../../video/ffmpeg.js'
import { probeClip, type ClipInfo } from '../../video/ffprobe.js'
import { normalizeClip } from '../../video/normalize.js'
import { concatClips } from '../../video/concat.js'
import { renderVariant } from '../../video/renderVariant.js'
import { buildHooks, reviewHooks } from '../../templates/hooks.js'
import { buildCaptionTimeline } from '../../captions/timeline.js'
import { loadAutoCaptionTimeline } from '../../captions/autoTimeline.js'
import { writeRenderReport } from '../../package/report.js'
import type { Clip } from '../../config/schema.js'

interface ProbedClip {
  clip: Clip
  path: string
  info: ClipInfo
}

function parseResolution(resolution: string): { width: number; height: number } {
  const [width, height] = resolution.split('x').map(Number)
  return { width: width ?? 1080, height: height ?? 1920 }
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

export async function runRender(projectPath: string): Promise<number> {
  logger.step(`렌더: ${projectPath}`)

  try {
    await ensureFfmpeg()
  } catch (err) {
    logger.error((err as Error).message)
    return 1
  }

  let loaded
  try {
    loaded = await loadProject(projectPath)
  } catch (err) {
    logger.error((err as Error).message)
    return 1
  }

  const { project, projectDir } = loaded
  const { width, height } = parseResolution(project.style.resolution)
  const fps = 30
  let bgmPath: string | undefined
  let narrationPath: string | undefined

  if (project.bgm?.file) {
    bgmPath = resolveClipPath(projectDir, project.bgm.file)
    try {
      await access(bgmPath)
    } catch {
      logger.error(`BGM 파일을 찾을 수 없습니다: ${project.bgm.file}`)
      return 1
    }
  }

  if (project.narration?.file) {
    narrationPath = resolveClipPath(projectDir, project.narration.file)
    try {
      await access(narrationPath)
    } catch {
      logger.error(`나레이션 파일을 찾을 수 없습니다: ${project.narration.file}`)
      return 1
    }
  }

  const probed: ProbedClip[] = []
  for (const clip of project.clips) {
    const clipPath = resolveClipPath(projectDir, clip.file)
    try {
      await access(clipPath)
    } catch {
      logger.error(`클립 파일을 찾을 수 없습니다: ${clip.file}`)
      return 1
    }

    let info: ClipInfo
    try {
      info = await probeClip(clipPath)
    } catch (err) {
      logger.error((err as Error).message)
      return 1
    }

    if (clip.end > info.duration + 0.05) {
      logger.error(
        `클립 ${clip.file}: end(${clip.end}s)가 실제 길이(${info.duration.toFixed(2)}s)를 초과합니다.`,
      )
      return 1
    }
    probed.push({ clip, path: clipPath, info })
  }

  const outputDir = join(projectDir, 'output')
  const workDir = join(outputDir, '.work')

  try {
    await rm(workDir, { recursive: true, force: true })
    await mkdir(workDir, { recursive: true })

    const normalized: string[] = []
    for (let index = 0; index < probed.length; index++) {
      const probedClip = probed[index] as ProbedClip
      const out = join(workDir, `norm_${pad2(index)}.mp4`)
      logger.dim(`  정규화 ${index + 1}/${probed.length}: ${probedClip.clip.role} (${probedClip.clip.file})`)
      await normalizeClip({
        input: probedClip.path,
        start: probedClip.clip.start,
        end: probedClip.clip.end,
        outPath: out,
        width,
        height,
        fps,
        info: probedClip.info,
        speed: probedClip.clip.speed ?? 1,
        mute: probedClip.clip.mute ?? false,
        transition: {
          type: project.style.transition,
          fadeIn: index > 0,
          fadeOut: index < probed.length - 1,
        },
      })
      normalized.push(out)
    }

    const basePath = join(workDir, 'base.mp4')
    logger.dim('  클립 결합(base)')
    await concatClips(normalized, basePath, workDir)

    const hooks = buildHooks(project.product, project.variants.count)
    const hookReview = reviewHooks(hooks)
    for (const hook of hookReview.duplicates) logger.warn(`중복 훅 문구: ${hook}`)
    for (const hook of hookReview.tooLong) logger.warn(`긴 훅 문구: ${hook}`)

    const fontPath = resolveFontPath()
    const variantFiles: Array<{ file: string; hook: string }> = []
    const autoCaptionTimeline = await loadAutoCaptionTimeline(projectDir, project)
    if (autoCaptionTimeline.files.length > 0) {
      logger.dim(`  자동자막 SRT ${autoCaptionTimeline.files.length}개 적용`)
      for (const warning of autoCaptionTimeline.warnings) logger.warn(warning)
    }

    for (let variantIndex = 0; variantIndex < project.variants.count; variantIndex++) {
      const file = `video_${pad2(variantIndex + 1)}.mp4`
      const outPath = join(outputDir, file)
      const hook = hooks[variantIndex] as string
      const captions =
        autoCaptionTimeline.segments.length > 0 ? autoCaptionTimeline.segments : buildCaptionTimeline(project, hook)
      logger.dim(`  변형 ${variantIndex + 1}/${project.variants.count}: ${hook}`)
      await renderVariant({
        basePath,
        captions,
        captionStyle: project.style.captionStyle,
        stickers: project.stickers,
        bgmPath,
        bgmVolume: project.style.bgmVolume,
        narrationPath,
        narrationVolume: project.narration?.volume,
        originalVolume: project.narration?.originalVolume,
        fontPath,
        outPath,
        workDir: join(workDir, `v${pad2(variantIndex + 1)}`),
        height,
      })
      variantFiles.push({ file, hook })
    }

    await writeRenderReport({
      outputDir,
      project,
      clips: probed.map(({ clip, info }) => ({
        file: clip.file,
        role: clip.role,
        start: clip.start,
        end: clip.end,
        speed: clip.speed ?? 1,
        sourceDuration: Number(info.duration.toFixed(2)),
        width: info.width,
        height: info.height,
      })),
      variants: variantFiles,
      resolution: project.style.resolution,
      fps,
    })

    await rm(workDir, { recursive: true, force: true })

    logger.success(`완료: ${project.variants.count}개 변형 -> ${outputDir}`)
    return 0
  } catch (err) {
    logger.error(`렌더 실패: ${(err as Error).message}`)
    logger.dim(`  작업 폴더 보존(디버그용): ${workDir}`)
    return 1
  }
}
