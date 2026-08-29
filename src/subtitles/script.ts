import type { Cue } from './srt.js'

/**
 * 자막 큐 → 읽을 수 있는 대본 텍스트.
 *
 * 자막은 타임코드가 붙은 조각이라 그대로는 읽기 어렵다.
 * 문장으로 잇고, 말이 길게 쉬는 지점에서 문단을 나눈다(사람이 실제로 숨 쉬는 곳이 문단 경계다).
 */

export interface ScriptOptions {
  /** 이 시간 이상 말이 비면 문단을 나눈다(기본 1.2초). */
  paragraphGapMs?: number
  /** 문단이 이 길이를 넘으면 다음 문장 끝에서 나눈다(기본 400자) — 너무 긴 덩어리 방지. */
  maxParagraphChars?: number
}

const SENTENCE_END = /[.!?。…？！]$/

const charLength = (text: string): number => [...text].length

/** 문장이 끝나는 자리인지 — 마침표류로 끝나면 문장 끝으로 본다. */
function endsSentence(text: string): boolean {
  return SENTENCE_END.test(text.trim())
}

export function cuesToScript(cues: Cue[], options: ScriptOptions = {}): string {
  const paragraphGapMs = options.paragraphGapMs ?? 1200
  const maxParagraphChars = options.maxParagraphChars ?? 400

  const paragraphs: string[] = []
  let current = ''
  let previousEndMs: number | null = null

  const flush = () => {
    const text = current.trim()
    if (text) paragraphs.push(text)
    current = ''
  }

  for (const cue of cues) {
    const piece = String(cue.text ?? '').trim()
    if (!piece) continue

    const gapMs = previousEndMs === null ? 0 : cue.startMs - previousEndMs
    // 긴 쉼 뒤이고 앞 문장이 끝나 있으면 문단을 바꾼다.
    if (current && gapMs >= paragraphGapMs && endsSentence(current)) flush()
    // 문단이 너무 길어지면 문장 끝에서 끊는다.
    else if (current && charLength(current) >= maxParagraphChars && endsSentence(current)) flush()

    current = current ? `${current} ${piece}` : piece
    previousEndMs = cue.endMs
  }
  flush()

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
