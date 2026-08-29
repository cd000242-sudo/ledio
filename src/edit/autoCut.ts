import type { Cue } from '../subtitles/srt.js'

/**
 * 자동 편집의 판단 부분 — 무엇을 자를지 고른다.
 *
 * 원칙: **자동으로 자르지 않는다.** 후보와 이유를 만들어 주고, 자를지는 사람이 정한다.
 * (자동 편집 도구들이 욕먹는 지점이 "말한 걸 멋대로 지웠다"이다)
 */

export type CutReason = 'silence' | 'filler' | 'duplicate' | 'stumble'

export interface CutCandidate {
  startMs: number
  endMs: number
  /** 그 구간에서 실제로 한 말(무음이면 빈 문자열). */
  text: string
  reason: CutReason
  /** 화면에 보여줄 한국어 설명. */
  label: string
  /** 기본으로 체크할지 — 확실한 것만 체크해 둔다. */
  suggested: boolean
}

/** 말버릇·군더더기. 문장 전체가 이것뿐일 때만 자른다. */
const FILLER_WORDS = ['어', '음', '그', '저', '아', '뭐', '이제', '그러니까', '어어', '음음', '그니까', '뭐랄까']

/** 말이 끊긴 흔적 — 다시 말하려고 멈춘 자리. */
const STUMBLE_HINTS = ['잠깐만', '잠시만', '다시 할게', '다시 갈게', '아 잠깐', '컷', '스톱']

const charLength = (text: string): number => [...text].length

const normalize = (text: string): string =>
  text
    .replace(/[.,!?…·"'`~\-—]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

/** 두 문장이 얼마나 겹치는지(0~1). 같은 말을 다시 한 것을 찾는 데 쓴다. */
export function similarity(left: string, right: string): number {
  const a = normalize(left)
  const b = normalize(right)
  if (!a || !b) return 0
  if (a === b) return 1

  // 두 글자씩 끊어 겹치는 비율을 본다(한국어는 어미가 바뀌어도 앞부분이 같다).
  const grams = (text: string): Set<string> => {
    const out = new Set<string>()
    const chars = [...text.replace(/ /g, '')]
    for (let index = 0; index < chars.length - 1; index += 1) out.add(chars[index]! + chars[index + 1]!)
    return out
  }
  const left2 = grams(a)
  const right2 = grams(b)
  if (left2.size === 0 || right2.size === 0) return 0
  let shared = 0
  for (const gram of left2) if (right2.has(gram)) shared += 1
  return shared / Math.max(left2.size, right2.size)
}

/** 문장이 군더더기뿐인지 — "어… 그러니까" 같은 것. */
export function isFillerOnly(text: string): boolean {
  const words = normalize(text).split(' ').filter(Boolean)
  if (words.length === 0) return false
  if (words.length > 3) return false
  return words.every((word) => FILLER_WORDS.includes(word))
}

export function looksLikeStumble(text: string): boolean {
  const value = normalize(text)
  return STUMBLE_HINTS.some((hint) => value.includes(normalize(hint)))
}

export interface AutoCutOptions {
  /** 이 길이 이상 비면 무음 후보로 본다(기본 0.6초). */
  silenceMs?: number
  /** 이 정도 닮았으면 같은 말로 본다(기본 0.72). */
  duplicateThreshold?: number
  /** 다듬기 강도 — 강할수록 더 많이 제안한다. */
  strength?: 'light' | 'normal' | 'strong'
}

const STRENGTH_TUNING = {
  light: { silenceMs: 1000, duplicateThreshold: 0.85 },
  normal: { silenceMs: 600, duplicateThreshold: 0.72 },
  strong: { silenceMs: 400, duplicateThreshold: 0.62 },
} as const

/**
 * 자막 큐(문장 단위)에서 자를 후보를 고른다.
 *
 * - 무음: 문장 사이가 길게 빈 구간
 * - 군더더기: 문장 전체가 "어/음/그" 뿐
 * - 말 끊김: "잠깐만요 다시" 같은 흔적
 * - 중복: 앞 문장과 많이 겹치는 문장 → **뒤에 한 말을 남기고 앞을 자른다**(보통 뒤가 더 매끄럽다)
 */
export function findCutCandidates(cues: Cue[], options: AutoCutOptions = {}): CutCandidate[] {
  const tuning = STRENGTH_TUNING[options.strength ?? 'normal']
  const silenceMs = options.silenceMs ?? tuning.silenceMs
  const duplicateThreshold = options.duplicateThreshold ?? tuning.duplicateThreshold

  const candidates: CutCandidate[] = []

  for (let index = 0; index < cues.length; index += 1) {
    const cue = cues[index]
    if (!cue) continue
    const previous = cues[index - 1]

    // 문장 사이의 빈 구간
    if (previous) {
      const gap = cue.startMs - previous.endMs
      if (gap >= silenceMs) {
        candidates.push({
          startMs: previous.endMs,
          endMs: cue.startMs,
          text: '',
          reason: 'silence',
          label: `무음 ${(gap / 1000).toFixed(1)}초`,
          suggested: true,
        })
      }
    }

    const text = cue.text.trim()
    if (!text) continue

    if (isFillerOnly(text)) {
      candidates.push({
        startMs: cue.startMs,
        endMs: cue.endMs,
        text,
        reason: 'filler',
        label: '군더더기',
        suggested: true,
      })
      continue
    }

    if (looksLikeStumble(text)) {
      candidates.push({
        startMs: cue.startMs,
        endMs: cue.endMs,
        text,
        reason: 'stumble',
        label: '말 끊김',
        suggested: true,
      })
      continue
    }

    // 바로 다음 문장과 많이 겹치면 앞 문장을 자른다(다시 말한 쪽을 남긴다).
    const next = cues[index + 1]
    if (next && charLength(text) >= 6) {
      const score = similarity(text, next.text)
      if (score >= duplicateThreshold) {
        candidates.push({
          startMs: cue.startMs,
          endMs: cue.endMs,
          text,
          reason: 'duplicate',
          label: `중복 · 뒤가 더 매끄러움 (${Math.round(score * 100)}% 일치)`,
          // 중복 판정은 틀릴 수 있어 기본 체크는 하지 않는다.
          suggested: false,
        })
      }
    }
  }

  return candidates.sort((left, right) => left.startMs - right.startMs)
}

export interface CutPlan {
  /** 실제로 잘라낼 구간(겹침 정리 완료). */
  remove: { startMs: number; endMs: number }[]
  removedMs: number
  keptMs: number
}

/** 고른 후보를 합쳐 실제 자를 구간으로 만든다. 겹치거나 붙은 구간은 하나로 합친다. */
export function buildCutPlan(candidates: CutCandidate[], totalMs: number): CutPlan {
  const sorted = [...candidates].sort((left, right) => left.startMs - right.startMs)
  const remove: { startMs: number; endMs: number }[] = []

  for (const candidate of sorted) {
    const last = remove[remove.length - 1]
    if (last && candidate.startMs <= last.endMs) {
      last.endMs = Math.max(last.endMs, candidate.endMs)
      continue
    }
    remove.push({ startMs: candidate.startMs, endMs: candidate.endMs })
  }

  const removedMs = remove.reduce((sum, range) => sum + Math.max(0, range.endMs - range.startMs), 0)
  return { remove, removedMs, keptMs: Math.max(0, totalMs - removedMs) }
}

/** 잘라낸 뒤 남는 구간 — 렌더가 이 순서로 이어 붙인다. */
export function keepRanges(plan: CutPlan, totalMs: number): { startMs: number; endMs: number }[] {
  const keep: { startMs: number; endMs: number }[] = []
  let cursor = 0
  for (const range of plan.remove) {
    if (range.startMs > cursor) keep.push({ startMs: cursor, endMs: range.startMs })
    cursor = Math.max(cursor, range.endMs)
  }
  if (cursor < totalMs) keep.push({ startMs: cursor, endMs: totalMs })
  return keep
}
