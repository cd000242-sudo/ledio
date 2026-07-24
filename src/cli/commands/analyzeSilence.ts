import { access } from 'node:fs/promises'
import { loadProject } from '../../config/loadProject.js'
import { resolveClipPath } from '../../utils/paths.js'
import { logger } from '../../utils/logger.js'
import { probeClip } from '../../video/ffprobe.js'
import { buildSilenceEditPlan, detectSilences } from '../../video/silence.js'

export interface AnalyzeSilenceOptions {
  clip?: string
  noiseDb?: string
  minDuration?: string
  padding?: string
  json?: boolean
}

function numberOption(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function runAnalyzeSilence(
  projectPath: string,
  options: AnalyzeSilenceOptions = {},
): Promise<number> {
  try {
    const { project, projectDir } = await loadProject(projectPath)
    const clip = options.clip
      ? project.clips.find((candidate) => candidate.file === options.clip)
      : project.clips[0]
    if (!clip) throw new Error(options.clip ? `클립을 찾을 수 없습니다: ${options.clip}` : '분석할 클립이 없습니다.')

    const clipPath = resolveClipPath(projectDir, clip.file)
    await access(clipPath)
    const media = await probeClip(clipPath)
    const silenceOptions = {
      noiseDb: numberOption(options.noiseDb, -35),
      minDurationSec: numberOption(options.minDuration, 0.6),
      paddingSec: numberOption(options.padding, 0.08),
    }
    const silences = media.hasAudio ? await detectSilences(clipPath, media.duration, silenceOptions) : []
    const plan = buildSilenceEditPlan(media.duration, silences, silenceOptions)
    const report = {
      projectName: project.projectName,
      clip: {
        file: clip.file,
        role: clip.role,
        path: clipPath,
        start: clip.start,
        end: clip.end,
      },
      media,
      plan,
      warnings: media.hasAudio ? [] : ['오디오 스트림이 없어 무음 구간을 감지하지 않았습니다.'],
    }

    if (options.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      logger.step(`무음 분석: ${clip.file}`)
      logger.success(`감지 ${plan.silences.length}개, 삭제 후보 ${plan.remove.length}개`)
      logger.dim(`  기존 길이: ${plan.sourceDurationSec}s`)
      logger.dim(`  예상 길이: ${plan.outputDurationSec}s`)
    }
    return 0
  } catch (err) {
    if (options.json) {
      console.log(JSON.stringify({ error: (err as Error).message }, null, 2))
    } else {
      logger.error((err as Error).message)
    }
    return 1
  }
}
