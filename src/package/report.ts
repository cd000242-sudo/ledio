import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Project } from '../config/schema.js'

export interface ReportClip {
  file: string
  role: string
  start: number
  end: number
  speed?: number
  sourceDuration: number
  width: number
  height: number
}

export interface ReportVariant {
  file: string
  hook: string
}

export interface RenderReportInput {
  outputDir: string
  project: Project
  clips: ReportClip[]
  variants: ReportVariant[]
  resolution: string
  fps: number
}

/** render_report.json을 생성한다. 디버깅/기록용 메타데이터. */
export async function writeRenderReport(input: RenderReportInput): Promise<string> {
  const timelineDuration = input.clips.reduce((sum, c) => sum + (c.end - c.start) / Math.max(0.25, c.speed ?? 1), 0)
  const report = {
    projectName: input.project.projectName,
    generatedAt: new Date().toISOString(),
    resolution: input.resolution,
    fps: input.fps,
    timelineDurationSec: Number(timelineDuration.toFixed(2)),
    variantCount: input.variants.length,
    clips: input.clips,
    variants: input.variants,
  }
  const path = join(input.outputDir, 'render_report.json')
  await writeFile(path, JSON.stringify(report, null, 2), 'utf8')
  return path
}
