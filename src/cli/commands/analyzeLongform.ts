import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import YAML from 'yaml'
import {
  analyzeLongformMedia,
  candidateToShortsProject,
  cuesToTranscriptSegments,
} from '../../modes/longform.js'
import { parseSrt } from '../../subtitles/srt.js'
import { logger } from '../../utils/logger.js'

interface AnalyzeLongformCliOptions {
  projectName?: string
  productName?: string
  affiliateUrl?: string
  targetDuration?: string
  outDir?: string
  transcript?: string
  visionScoring?: boolean
  sceneThreshold?: string
}

function defaultProjectName(file: string): string {
  return basename(file, extname(file)) || 'longform-source'
}

function parsePositiveNumber(value: string | undefined, fallback: number, label: string): number {
  if (value === undefined || value.trim() === '') return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number.`)
  }
  return parsed
}

function requireOption(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required.`)
  return value
}

async function readTranscript(path: string | undefined) {
  if (!path) return undefined
  const raw = await readFile(resolve(path), 'utf8')
  return cuesToTranscriptSegments(parseSrt(raw))
}

export async function runAnalyzeLongform(
  file: string,
  options: AnalyzeLongformCliOptions,
): Promise<number> {
  logger.step(`Analyzing longform media: ${file}`)

  try {
    const inputFile = resolve(file)
    const outDir = resolve(options.outDir ?? join(dirname(inputFile), 'longform-analysis'))
    const transcript = await readTranscript(options.transcript)
    const report = await analyzeLongformMedia({
      file: inputFile,
      projectName: options.projectName ?? defaultProjectName(inputFile),
      productName: requireOption(options.productName, '--product-name'),
      affiliateUrl: requireOption(options.affiliateUrl, '--affiliate-url'),
      targetDurationSec: parsePositiveNumber(options.targetDuration, 45, '--target-duration'),
      transcript,
      visionScoring: options.visionScoring ?? false,
      sceneThreshold:
        options.sceneThreshold === undefined
          ? undefined
          : parsePositiveNumber(options.sceneThreshold, 0.18, '--scene-threshold'),
    })

    await mkdir(outDir, { recursive: true })
    const reportPath = join(outDir, 'longform_analysis.json')
    await writeFile(reportPath, JSON.stringify(report, null, 2), 'utf8')

    if (report.candidates[0]) {
      const project = candidateToShortsProject(report.source, report.candidates[0])
      await writeFile(join(outDir, 'first_shorts_project.yaml'), YAML.stringify(project), 'utf8')
    }

    logger.success(`Analysis report: ${reportPath}`)
    logger.dim(`  duration: ${report.media.durationSec}s`)
    logger.dim(`  silences: ${report.silences.length}`)
    logger.dim(`  candidates: ${report.candidates.length}`)
    if (report.transcript) logger.dim(`  transcript segments: ${report.transcript.segmentCount}`)
    if (report.visual) logger.dim(`  visual scene signals: ${report.visual.signalCount}`)
    for (const warning of report.warnings) logger.warn(warning)
    return 0
  } catch (err) {
    logger.error(`Longform analysis failed: ${(err as Error).message}`)
    return 1
  }
}
