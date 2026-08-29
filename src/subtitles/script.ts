import type { Cue } from './srt.js'

/**
 * 자막 큐 → 읽을 수 있는 대본 텍스트.
 *
 * 자막은 타임코드가 붙은 조각이라 그대로는 읽기 어렵다.
 * 문장으로 잇고, 말이 길게 쉬는 지점에서 문단을 나눈다(사람이 실제로 숨 쉬는 곳이 문단 경계다).
 */

export interface ScriptOptions {
  /**
   * 문단을 나눌 쉼의 기준을 이 분위수로 정한다(기본 0.75 = 상위 25% 긴 쉼).
   * 말 속도는 사람마다 다르므로 고정 ms가 아니라 그 사람의 쉼 분포에서 뽑는다.
   * (실측: 어떤 화자는 문장 사이 최대 쉼이 1.5초였다 — 고정 1.2초 기준으로는 거의 안 끊겼다.)
   */
  gapPercentile?: number
  /** 그래도 이보다 짧은 쉼에서는 나누지 않는다(기본 300ms). */
  minGapMs?: number
  /** 문단이 이 문장 수 미만이면 쉼이 길어도 넘어간다(기본 2). */
  minSentences?: number
  /** 이 문장 수에 도달하면 쉼과 무관하게 나눈다(기본 5). */
  maxSentences?: number
}

const SENTENCE_END = /[.!?。…？！]$/

const charLength = (text: string): number => [...text].length

/** 문장이 끝나는 자리인지 — 마침표류로 끝나면 문장 끝으로 본다. */
function endsSentence(text: string): boolean {
  return SENTENCE_END.test(text.trim())
}

interface Sentence {
  text: string
  /** 앞 문장이 끝나고 이 문장이 시작되기까지 비어 있던 시간. */
  gapBeforeMs: number
}

/** 단어 큐를 문장으로 묶고, 문장 사이의 쉼을 함께 들고 온다. */
function toSentences(cues: Cue[]): Sentence[] {
  const sentences: Sentence[] = []
  let buffer = ''
  let gapBeforeMs = 0
  let previousEndMs: number | null = null
  let pendingGapMs = 0

  for (const cue of cues) {
    const piece = String(cue.text ?? '').trim()
    if (!piece) continue
    const gap = previousEndMs === null ? 0 : Math.max(0, cue.startMs - previousEndMs)
    if (!buffer) gapBeforeMs = pendingGapMs || gap
    buffer = buffer ? `${buffer} ${piece}` : piece
    previousEndMs = cue.endMs

    if (endsSentence(buffer)) {
      sentences.push({ text: buffer, gapBeforeMs })
      buffer = ''
      pendingGapMs = 0
    }
  }
  if (buffer) sentences.push({ text: buffer, gapBeforeMs })
  return sentences
}

/** 화자의 쉼 분포에서 문단 경계 기준을 뽑는다. */
export function paragraphGapThreshold(sentences: Sentence[], percentile = 0.75, minGapMs = 300): number {
  const gaps = sentences
    .slice(1)
    .map((sentence) => sentence.gapBeforeMs)
    .sort((left, right) => left - right)
  if (gaps.length === 0) return minGapMs
  const index = Math.min(gaps.length - 1, Math.floor(gaps.length * percentile))
  return Math.max(minGapMs, gaps[index] ?? minGapMs)
}

/**
 * 자막 큐 → 읽을 수 있는 대본 텍스트.
 *
 * 문단은 **화자가 실제로 길게 쉰 자리**에서 나눈다. 기준은 그 사람의 쉼 분포에서 뽑아
 * 빠르게 말하는 사람과 느리게 말하는 사람 모두에서 비슷한 리듬이 나오게 한다.
 * 쉼이 고른 화자를 위해 문장 수 상한도 함께 둔다.
 */
export function cuesToScript(cues: Cue[], options: ScriptOptions = {}): string {
  const minSentences = options.minSentences ?? 2
  const maxSentences = options.maxSentences ?? 5
  const sentences = toSentences(cues)
  if (sentences.length === 0) return ''

  const threshold = paragraphGapThreshold(sentences, options.gapPercentile ?? 0.75, options.minGapMs ?? 300)
  const paragraphs: string[] = []
  let current: string[] = []

  for (const sentence of sentences) {
    const longPause = sentence.gapBeforeMs >= threshold && current.length >= minSentences
    const tooLong = current.length >= maxSentences
    if (current.length > 0 && (longPause || tooLong)) {
      paragraphs.push(current.join(' '))
      current = []
    }
    current.push(sentence.text)
  }
  if (current.length > 0) paragraphs.push(current.join(' '))

  return paragraphs.join('\n\n')
}

/** 대본을 다듬어 달라고 모델에게 보낼 프롬프트 — 내용을 바꾸지 말고 표기만 고치게 한다. */
export function buildScriptPolishPrompt(script: string): string {
  return [
    '아래는 음성인식으로 받아쓴 대본이다. 읽기 좋게 다듬어라.',
    '',
    '규칙:',
    '- 내용을 바꾸거나 요약하지 마라. 말한 그대로를 유지한다.',
    '- 오타, 띄어쓰기, 문장부호를 고친다. 숫자·영어·고유명사 표기를 자연스럽게 맞춘다.',
    '- "어", "음", "그" 같은 군더더기와 의미 없는 반복만 덜어낸다.',
    '- 문단 구분은 그대로 유지한다(빈 줄로 구분된 덩어리를 합치거나 쪼개지 마라).',
    '- 설명 없이 다듬은 대본만 출력한다.',
    '',
    '=== 대본 ===',
    script,
  ].join('\n')
}

/**
 * 다듬기 결과를 받아들일지 판단한다.
 * 분량이 크게 달라졌으면 모델이 요약했거나 잘라먹은 것이므로 원본을 지킨다.
 */
export function acceptPolishedScript(original: string, polished: string): string {
  const cleaned = String(polished ?? '').trim()
  if (!cleaned) return original
  const originalLength = charLength(original)
  const polishedLength = charLength(cleaned)
  if (polishedLength < originalLength * 0.7 || polishedLength > originalLength * 1.3) return original
  return cleaned
}
