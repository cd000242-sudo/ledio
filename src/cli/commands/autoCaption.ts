import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { generateAutoCaptions, normalizeAutoCaptionProvider } from '../../captions/autoCaption.js'
import { loadProject } from '../../config/loadProject.js'
import { resolveClipPath } from '../../utils/paths.js'
import { logger } from '../../utils/logger.js'

export interface AutoCaptionOptions {
  clip?: string
  provider?: string
  language?: string
  model?: string
  modelDir?: string
  minChars?: string
  maxChars?: string
  whisperBin?: string
  json?: boolean
}

function numberOption(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export async function runAutoCaption(projectPath: string, options: AutoCaptionOptions = {}): Promise<number> {
  try {
    const { project, projectDir } = await loadProject(projectPath)
    const clip = options.clip
      ? project.clips.find((candidate) => candidate.file === options.clip)
      : project.clips[0]
    if (!clip) throw new Error(options.clip ? `클립을 찾을 수 없습니다: ${options.clip}` : '자동자막을 만들 클립이 없습니다.')

    const clipPath = resolveClipPath(projectDir, clip.file)
    await access(clipPath)
    const durationSec = Math.max(1, clip.end - clip.start)
    const report = await generateAutoCaptions({
      projectName: project.projectName,
      clipFile: clip.file,
      clipPath,
      durationSec,
      provider: normalizeAutoCaptionProvider(options.provider),
      language: options.language ?? 'ko',
      model: options.model ?? 'base',
      outputDir: join(projectDir, 'captions'),
      modelDir: options.modelDir ?? process.env.SF_WHISPER_MODEL_DIR ?? join(process.cwd(), '.cache', 'whisper'),
      minChars: numberOption(options.minChars, 8),
      maxChars: numberOption(options.maxChars, 28),
      whisperBin: options.whisperBin,
    })

    if (options.json) {
      console.log(JSON.stringify(report, null, 2))
    } else {
      logger.step(`자동자막 생성: ${clip.file}`)
      logger.success(`${report.cueCount}개 자막 큐 생성`)
      logger.dim(`  SRT: ${report.srtFile}`)
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
