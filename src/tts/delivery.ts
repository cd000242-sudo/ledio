import { splitSentences } from './chunk.js'

/**
 * 낭독 연출 계획: 문장별 페이스(배속)와 문장 뒤 쉼(초).
 * 에이전트가 대본 분위기를 읽고 만들어 준다 — 긴박한 구간은 빠르고 쉼이 짧게,
 * 소름 포인트 직전은 길게 멈추는 식.
 */
export interface DeliveryStep {
  pace: number
  pause: number
  pitch?: number
  gain?: number
  ending?: DeliveryEnding
}

export type DeliveryEnding = 'neutral' | 'fall' | 'soft-fall' | 'rise' | 'crisp' | 'linger'

export interface DeliveryChunk {
  text: string
  pace: number
  pauseAfter: number
  pitch?: number
  gain?: number
  ending?: DeliveryEnding
}

const DEFAULT_STEP: DeliveryStep = { pace: 1, pause: 0.25 }

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return (min + max) / 2
  return Math.min(max, Math.max(min, value))
}

function normalizeStep(step: DeliveryStep | undefined): DeliveryStep {
  const source = step ?? DEFAULT_STEP
  const normalized: DeliveryStep = {
    pace: Math.round(clamp(source.pace, 0.8, 1.25) * 100) / 100,
    pause: Math.round(clamp(source.pause, 0.05, 1) * 100) / 100,
  }
  if (source.pitch !== undefined) normalized.pitch = Math.round(clamp(source.pitch, -2, 2) * 100) / 100
  if (source.gain !== undefined) normalized.gain = Math.round(clamp(source.gain, -3, 3) * 100) / 100
  if (source.ending !== undefined) {
    normalized.ending = ['neutral', 'fall', 'soft-fall', 'rise', 'crisp', 'linger'].includes(source.ending)
      ? source.ending
      : 'neutral'
  }
  return normalized
}

/**
 * 문장별 연출 계획을 TTS 생성 조각으로 바꾼다.
 * 페이스가 같은 연속 문장은 한 조각으로 묶고(생성 횟수 절약),
 * 조각 뒤 쉼은 마지막 문장의 쉼을 쓴다. 계획이 모자라면 기본값으로 채운다.
 */
export function buildDeliveryChunks(text: string, plan: DeliveryStep[], maxChars = 120): DeliveryChunk[] {
  const sentences = splitSentences(text)
  if (sentences.length === 0) return []

  const chunks: DeliveryChunk[] = []
  let current: DeliveryChunk | null = null
  for (let i = 0; i < sentences.length; i++) {
    const sentence = sentences[i] as string
    const step = normalizeStep(plan[i])
    const candidate: string = current ? `${current.text} ${sentence}` : sentence
    const hasExpressiveProcessing =
      step.pitch !== undefined || step.gain !== undefined || step.ending !== undefined ||
      current?.pitch !== undefined || current?.gain !== undefined || current?.ending !== undefined
    if (current && !hasExpressiveProcessing && current.pace === step.pace && [...candidate].length <= maxChars) {
      current = { text: candidate, pace: current.pace, pauseAfter: step.pause }
    } else {
      if (current) chunks.push(current)
      current = {
        text: sentence,
        pace: step.pace,
        pauseAfter: step.pause,
        ...(step.pitch !== undefined ? { pitch: step.pitch } : {}),
        ...(step.gain !== undefined ? { gain: step.gain } : {}),
        ...(step.ending !== undefined ? { ending: step.ending } : {}),
      }
    }
  }
  if (current) chunks.push(current)
  return chunks
}

/**
 * 장면별로 이미 나뉜 스토리보드 낭독에 문장 단위 연출 계획을 적용한다.
 * 한 장면에 문장이 여러 개면 수치 연출은 평균을, 쉼과 끝음은 마지막 문장의 값을 쓴다.
 */
export function buildDeliveryChunksForTexts(texts: string[], plan: DeliveryStep[]): DeliveryChunk[] {
  let planIndex = 0
  return texts.map((text) => {
    const sentences = splitSentences(text)
    const steps = (sentences.length > 0 ? sentences : [text]).map(() => normalizeStep(plan[planIndex++]))
    const average = (field: 'pace' | 'pitch' | 'gain', fallback = 0) =>
      Math.round(
        (steps.reduce((sum, step) => sum + (step[field] ?? fallback), 0) / Math.max(1, steps.length)) * 100,
      ) / 100
    const last = steps.at(-1) ?? normalizeStep(undefined)
    return {
      text,
      pace: average('pace', 1),
      pauseAfter: last.pause,
      ...(steps.some((step) => step.pitch !== undefined) ? { pitch: average('pitch') } : {}),
      ...(steps.some((step) => step.gain !== undefined) ? { gain: average('gain') } : {}),
      ...(last.ending !== undefined ? { ending: last.ending } : {}),
    }
  })
}
