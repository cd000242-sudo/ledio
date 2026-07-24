/**
 * 장면 나레이션을 짧은 자막 조각(cue)으로 나누고 장면 길이 안에서 타이밍을 배분한다.
 *
 * 표시 전용 분할이다 — tts/chunk.ts(splitSentences)·서버 splitSentencesForDelivery의
 * 문장 분할 계약과 무관하며, 낭독 연출·숏 번호 매기기에 재사용해서는 안 된다.
 * (알고리즘은 app/edit-workbench.js의 splitLongCaptionText/scriptToCaptionCues에서 이식 —
 * UI 계층을 도메인에서 import할 수 없어 사본을 둔다.)
 */

export interface SceneCaptionCue {
  text: string
  /** 장면 클립 기준(클립-로컬) 시작 초 */
  start: number
  end: number
}

export interface SceneCaptionInput {
  caption?: string
  narration?: string
  durationSec: number
}

export interface SceneCueOptions {
  maxChars?: number
  /** cue 하나의 최소 표시 시간(깜빡임 방지). 장면이 그보다 짧으면 비례 축소. */
  minCueSec?: number
}

function charLength(text: string): number {
  return [...text].length
}

function splitByWords(text: string, maxChars: number): string[] {
  if (charLength(text) <= maxChars) return [text]
  const words = text.split(/\s+/u).filter(Boolean)
  if (words.length <= 1) {
    const chars = [...text]
    const chunks: string[] = []
    for (let index = 0; index < chars.length; index += maxChars) {
      chunks.push(chars.slice(index, index + maxChars).join('').trim())
    }
    return chunks.filter(Boolean)
  }
  const chunks: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (current && charLength(candidate) > maxChars) {
      chunks.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current) chunks.push(current)
  return chunks.flatMap((chunk) => splitByWords(chunk, maxChars)).filter(Boolean)
}

/** 문장부호 우선, 그다음 어절 경계로 maxChars 이하 조각을 만든다. */
export function splitCaptionChunks(text: string, maxChars = 12): string[] {
  const source = String(text ?? '').replace(/\r\n?/gu, '\n').trim()
  if (!source) return []
  const lines: string[] = []
  let buffer = ''
  const flush = () => {
    const cleaned = buffer.replace(/\s+/gu, ' ').trim()
    buffer = ''
    if (cleaned) lines.push(...splitByWords(cleaned, maxChars))
  }
  for (const char of source) {
    if (char === '\n') {
      flush()
      continue
    }
    buffer += char
    if (/[.!?。！？]/u.test(char)) flush()
  }
  flush()
  return lines
}

/**
 * 장면 배열 → 장면별 클립-로컬 cue 배열.
 * 글자수 비례로 시간을 나누되 minCueSec 하한을 지키고, 마지막 cue는 장면 길이에 스냅한다.
 */
export function buildSceneCaptionCues(
  scenes: SceneCaptionInput[],
  options: SceneCueOptions = {},
): SceneCaptionCue[][] {
  const maxChars = Math.max(4, Math.round(options.maxChars ?? 12))
  const minCueSec = Math.max(0.1, options.minCueSec ?? 0.5)

  return scenes.map((scene) => {
    const text = (scene.caption ?? scene.narration ?? '').trim()
    const durationSec = Math.max(0.1, scene.durationSec)
    const lines = splitCaptionChunks(text, maxChars)
    if (lines.length === 0) return []

    // 장면이 너무 짧으면 하한을 비례 축소해 cue 합이 장면 길이를 넘지 않게 한다.
    const effectiveMin = Math.min(minCueSec, durationSec / lines.length)
    const weights = lines.map((line) => Math.max(1, charLength(line)))
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)

    const cues: SceneCaptionCue[] = []
    let elapsedWeight = 0
    let cursor = 0
    lines.forEach((line, index) => {
      elapsedWeight += weights[index] as number
      const remainingMin = (lines.length - index - 1) * effectiveMin
      const weightedEnd = (elapsedWeight / totalWeight) * durationSec
      const end =
        index === lines.length - 1
          ? durationSec
          : Math.min(durationSec - remainingMin, Math.max(cursor + effectiveMin, weightedEnd))
      cues.push({ text: line, start: cursor, end })
      cursor = end
    })
    return cues
  })
}
