import { execa } from 'execa'
import { FFMPEG_BIN } from './ffmpeg.js'

export interface SilenceRange {
  start: number
  end: number
}

export interface DetectSilenceOptions {
  noiseDb?: number
  minDurationSec?: number
}

export interface KeepRange {
  start: number
  end: number
  duration: number
}

export interface SilenceEditPlan {
  sourceDurationSec: number
  noiseDb: number
  minDurationSec: number
  paddingSec: number
  silences: SilenceRange[]
  remove: SilenceRange[]
  keep: KeepRange[]
  removedDurationSec: number
  outputDurationSec: number
}

function round2(value: number): number {
  return Number(value.toFixed(2))
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function numberFromMatch(line: string, pattern: RegExp): number | null {
  const match = pattern.exec(line)
  if (!match?.[1]) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

export function parseSilencedetectLog(log: string, totalDurationSec?: number): SilenceRange[] {
  const ranges: SilenceRange[] = []
  let pendingStart: number | null = null

  for (const line of log.split(/\r?\n/)) {
    const start = numberFromMatch(line, /silence_start:\s*([0-9.]+)/)
    if (start !== null) {
      pendingStart = start
      continue
    }

    const end = numberFromMatch(line, /silence_end:\s*([0-9.]+)/)
    if (end !== null && pendingStart !== null && end > pendingStart) {
      ranges.push({ start: round2(pendingStart), end: round2(end) })
      pendingStart = null
    }
  }

  if (pendingStart !== null && totalDurationSec !== undefined && totalDurationSec > pendingStart) {
    ranges.push({ start: round2(pendingStart), end: round2(totalDurationSec) })
  }

  return ranges
}

export async function detectSilences(
  file: string,
  durationSec?: number,
  options: DetectSilenceOptions = {},
): Promise<SilenceRange[]> {
  const noiseDb = options.noiseDb ?? -35
  const minDurationSec = options.minDurationSec ?? 0.6

  try {
    const { stderr } = await execa(FFMPEG_BIN, [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-af',
      `silencedetect=noise=${noiseDb}dB:d=${minDurationSec}`,
      '-f',
      'null',
      '-',
    ])
    return parseSilencedetectLog(stderr, durationSec)
  } catch (err) {
    const e = err as { stderr?: string; shortMessage?: string }
    throw new Error(`silence analysis failed: ${e.shortMessage ?? e.stderr ?? 'unknown error'}`)
  }
}

export function buildSilenceEditPlan(
  sourceDurationSec: number,
  silences: SilenceRange[],
  options: DetectSilenceOptions & { paddingSec?: number } = {},
): SilenceEditPlan {
  const duration = Math.max(0, sourceDurationSec)
  const paddingSec = Math.max(0, options.paddingSec ?? 0.08)
  const remove = silences
    .map((silence) => ({
      start: round2(clamp(silence.start + paddingSec, 0, duration)),
      end: round2(clamp(silence.end - paddingSec, 0, duration)),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start)

  const keep: KeepRange[] = []
  let cursor = 0
  for (const range of remove) {
    if (range.start > cursor) {
      keep.push({
        start: round2(cursor),
        end: range.start,
        duration: round2(range.start - cursor),
      })
    }
    cursor = Math.max(cursor, range.end)
  }
  if (cursor < duration) {
    keep.push({
      start: round2(cursor),
      end: round2(duration),
      duration: round2(duration - cursor),
    })
  }

  const removedDurationSec = round2(remove.reduce((sum, range) => sum + (range.end - range.start), 0))
  return {
    sourceDurationSec: round2(duration),
    noiseDb: options.noiseDb ?? -35,
    minDurationSec: options.minDurationSec ?? 0.6,
    paddingSec,
    silences,
    remove,
    keep,
    removedDurationSec,
    outputDurationSec: round2(Math.max(0, duration - removedDurationSec)),
  }
}
