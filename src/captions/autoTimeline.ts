import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import type { Project } from '../config/schema.js'
import { parseSrt } from '../subtitles/srt.js'
import type { CaptionSegment } from './timeline.js'

export interface AutoCaptionTimeline {
  segments: CaptionSegment[]
  files: string[]
  warnings: string[]
}

function clean(value: string | undefined): string {
  return String(value ?? '').trim()
}

function safeStem(file: string): string {
  const raw = basename(file, extname(file))
  const stem = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return stem || 'captions'
}

export function autoCaptionFileForClip(projectDir: string, clipFile: string): string {
  return join(projectDir, 'captions', `${safeStem(clipFile)}.auto.srt`)
}

function appendDisclosure(project: Project, segments: CaptionSegment[], totalDuration: number): void {
  const text = clean(project.disclosure.text)
  if (!text || totalDuration <= 0) return
  const disclosureDuration = Math.min(3.5, Math.max(1.5, totalDuration * 0.16))
  segments.push({
    kind: 'disclosure',
    text,
    start: Math.max(0, totalDuration - disclosureDuration),
    end: totalDuration,
    position: project.style.captionPosition,
  })
}

export async function loadAutoCaptionTimeline(projectDir: string, project: Project): Promise<AutoCaptionTimeline> {
  const segments: CaptionSegment[] = []
  const files: string[] = []
  const warnings: string[] = []
  let cursor = 0

  for (const clip of project.clips) {
    const duration = Math.max(0, clip.end - clip.start)
    const srtFile = autoCaptionFileForClip(projectDir, clip.file)
    if (!existsSync(srtFile)) {
      cursor += duration
      continue
    }

    files.push(srtFile)
    const cues = parseSrt(await readFile(srtFile, 'utf8'))
    for (const cue of cues) {
      const sourceStart = cue.startMs / 1000
      const sourceEnd = cue.endMs / 1000
      const clippedStart = Math.max(sourceStart, clip.start)
      const clippedEnd = Math.min(sourceEnd, clip.end)
      const start = cursor + clippedStart - clip.start
      const end = cursor + clippedEnd - clip.start
      const text = clean(cue.text)
      if (!text || end - start < 0.25) continue
      segments.push({
        kind: 'body',
        text,
        start,
        end,
        position: project.style.captionPosition,
      })
    }
    cursor += duration
  }

  if (files.length > 0 && segments.length === 0) {
    warnings.push('자동자막 SRT 파일은 찾았지만 렌더링할 자막 구간이 없습니다.')
  }
  if (segments.length > 0) appendDisclosure(project, segments, cursor)

  return { segments, files, warnings }
}
