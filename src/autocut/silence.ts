/** 초 단위 구간. */
export interface Interval {
  start: number
  end: number
}

export type Segment = Interval

export interface KeepOptions {
  /** 이 길이(초) 이상인 무음만 자른다. 짧은 숨은 자연스러움을 위해 남긴다. */
  minSilence?: number
  /** 말 앞뒤로 이만큼(초) 무음을 남긴다(너무 딱 붙지 않게). */
  padding?: number
  /** 이 길이(초) 미만의 유지 구간은 잡음으로 보고 버린다. */
  minKeep?: number
}

export interface CutSummary {
  originalDuration: number
  keptDuration: number
  removedDuration: number
  cutCount: number
  segmentCount: number
}

const DEFAULTS: Required<KeepOptions> = { minSilence: 0.6, padding: 0.1, minKeep: 0.3 }

/**
 * ffmpeg silencedetect 필터의 stderr 로그에서 무음 구간을 파싱한다.
 *   silence_start: 3.512
 *   silence_end: 4.238 | silence_duration: 0.726
 */
export function parseSilenceLog(log: string): Interval[] {
  const intervals: Interval[] = []
  let pendingStart: number | null = null
  for (const line of log.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*(-?[\d.]+)/)
    if (startMatch) {
      pendingStart = Math.max(0, Number(startMatch[1]))
      continue
    }
    const endMatch = line.match(/silence_end:\s*(-?[\d.]+)/)
    if (endMatch) {
      const end = Number(endMatch[1])
      intervals.push({ start: pendingStart ?? 0, end })
      pendingStart = null
    }
  }
  return intervals
}

/**
 * 무음 구간과 총 길이로부터 "남길 구간"들을 계산한다.
 * - minSilence 이상인 무음만 컷 대상
 * - 컷하는 무음의 양끝에 padding만큼 남겨 자연스럽게
 * - minKeep 미만의 유지 구간은 버림
 */
export function computeKeepSegments(
  duration: number,
  silences: Interval[],
  options: KeepOptions = {},
): Segment[] {
  const { minSilence, padding, minKeep } = { ...DEFAULTS, ...options }

  // 1) 컷할 영역(=무음에서 padding 뺀 부분) 목록
  const removed: Interval[] = []
  for (const s of silences) {
    if (s.end - s.start < minSilence) continue
    const rs = Math.max(0, s.start + padding)
    const re = Math.min(duration, s.end - padding)
    if (re - rs > 0.001) removed.push({ start: rs, end: re })
  }

  // 2) 정렬 후 겹치는 컷 영역 병합(불변)
  const sorted = [...removed].sort((a, b) => a.start - b.start)
  const merged: Interval[] = []
  for (const r of sorted) {
    const last = merged[merged.length - 1]
    if (last && r.start <= last.end) {
      merged[merged.length - 1] = { start: last.start, end: Math.max(last.end, r.end) }
    } else {
      merged.push({ start: r.start, end: r.end })
    }
  }

  // 3) [0, duration]에서 컷 영역의 여집합 = 유지 구간
  const keep: Segment[] = []
  let cursor = 0
  for (const r of merged) {
    if (r.start > cursor) keep.push({ start: cursor, end: r.start })
    cursor = Math.max(cursor, r.end)
  }
  if (cursor < duration) keep.push({ start: cursor, end: duration })

  // 4) 너무 짧은 유지 구간 제거
  return keep.filter((k) => k.end - k.start >= minKeep)
}

/** 유지 구간 기준으로 요약 통계를 만든다(컷 개수는 유지 구간 사이 간격에서 계산). */
export function summarizeCut(duration: number, keep: Segment[]): CutSummary {
  const keptDuration = keep.reduce((sum, k) => sum + (k.end - k.start), 0)
  let cutCount = 0
  let cursor = 0
  for (const k of keep) {
    if (k.start - cursor > 0.001) cutCount++
    cursor = Math.max(cursor, k.end)
  }
  if (duration - cursor > 0.001) cutCount++
  return {
    originalDuration: Number(duration.toFixed(3)),
    keptDuration: Number(keptDuration.toFixed(3)),
    removedDuration: Number((duration - keptDuration).toFixed(3)),
    cutCount,
    segmentCount: keep.length,
  }
}
