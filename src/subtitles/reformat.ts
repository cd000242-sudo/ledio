import type { Cue } from './srt.js'

export interface ReformatOptions {
  /** 한 줄 목표 하한 — 이보다 짧은 조각은 되도록 만들지 않는다. */
  minChars?: number
  /** 한 줄 최대 길이(하드 상한). */
  maxChars?: number
  /**
   * 이 시간 이상 말이 비면 그 자리를 우선 끊는다.
   * 지정하지 않으면 화자의 쉼 분포에서 뽑는다 — 말 속도는 사람마다 다르다.
   */
  gapMs?: number
  /** 쉼 기준을 뽑을 분위수(기본 0.8 = 상위 20% 긴 쉼). */
  gapPercentile?: number
  /** 그래도 이보다 짧은 쉼은 무시한다(기본 350ms). */
  minGapMs?: number
}

const SENTENCE_END = /[.!?。…？！]$/

/** 한국어에서 끊어 읽기 좋은 자리 — 쉼표와 연결어미로 끝나는 어절. */
const CLAUSE_END =
  /(,|、|고|며|면서|지만|는데|은데|아서|어서|여서|니까|으니|면|다가|거나|든지|처럼|보다|라고|하고|이고|인데)$/

const len = (text: string): number => [...text].length

/** 단어 사이 쉼의 분위수 — 끊을 자리를 화자에게 맞춘다. */
export function wordGapThreshold(cues: Cue[], percentile = 0.8, minGapMs = 350): number {
  const gaps: number[] = []
  for (let index = 1; index < cues.length; index += 1) {
    const previous = cues[index - 1]
    const current = cues[index]
    if (previous && current) gaps.push(Math.max(0, current.startMs - previous.endMs))
  }
  if (gaps.length === 0) return minGapMs
  gaps.sort((left, right) => left - right)
  const position = Math.min(gaps.length - 1, Math.floor(gaps.length * percentile))
  return Math.max(minGapMs, gaps[position] ?? minGapMs)
}

function toCue(words: Cue[]): Cue {
  return {
    startMs: words[0]?.startMs ?? 0,
    endMs: words[words.length - 1]?.endMs ?? 0,
    text: words.map((word) => word.text).join(' ').trim(),
  }
}

/** 단어 큐를 문장 단위로 묶는다. 자막이 두 문장에 걸치지 않게 하는 첫 단추다. */
function groupSentences(cues: Cue[]): Cue[][] {
  const sentences: Cue[][] = []
  let current: Cue[] = []
  for (const cue of cues) {
    const text = cue.text.trim()
    if (!text) continue
    current.push({ ...cue, text })
    if (SENTENCE_END.test(text)) {
      sentences.push(current)
      current = []
    }
  }
  if (current.length > 0) sentences.push(current)
  return sentences
}

/**
 * 한 문장을 자막 여러 줄로 쪼갠다.
 *
 * 길이를 넘길 때만 쪼개되, **조각 길이를 고르게** 맞춘다.
 * (앞에 40자, 뒤에 6자로 떨어지면 짧은 자막이 깜빡여 읽기 나쁘다 — 실측으로 확인한 문제)
 * 끊는 자리는 큰 쉼 → 쉼표·연결어미 → 목표 길이 순으로 고른다.
 */
export function splitSentence(words: Cue[], maxChars: number, gapThreshold: number): Cue[] {
  const total = len(toCue(words).text)
  if (total <= maxChars || words.length < 2) return [toCue(words)]

  const pieces = Math.ceil(total / maxChars)
  const target = Math.ceil(total / pieces)
  const groups: Cue[][] = []
  let buffer: Cue[] = []
  let chars = 0

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]
    if (!word) continue
    const previous = words[index - 1]
    const gapMs = previous ? Math.max(0, word.startMs - previous.endMs) : 0

    const reachedTarget = chars >= target
    const goodPlace = gapMs >= gapThreshold || (previous ? CLAUSE_END.test(previous.text) : false)
    // 미리 정한 조각 수를 넘기지 않는다 — 목표 길이에서 고르게 나누는 게 목적이다.
    const canSplitMore = groups.length < pieces - 1
    // 목표를 한참 지났는데도 좋은 자리가 없으면 그냥 끊는다. 안 그러면 뒤에 짧은 꼬리만 남는다.
    const overshoot = chars >= target + Math.min(8, Math.round(target * 0.35))
    const wouldOverflow = chars + 1 + len(word.text) > maxChars

    // 크게 쉰 자리는 목표 길이 전이라도 끊는다 — 호흡과 자막이 어긋나면 읽기 나쁘다.
    const strongPause = gapMs >= gapThreshold && chars >= Math.max(6, Math.round(target * 0.5))

    if (
      buffer.length > 0 &&
      (((reachedTarget || strongPause) && canSplitMore && (goodPlace || overshoot)) || wouldOverflow)
    ) {
      groups.push(buffer)
      buffer = []
      chars = 0
    }

    buffer.push(word)
    chars = chars === 0 ? len(word.text) : chars + 1 + len(word.text)
  }
  if (buffer.length > 0) groups.push(buffer)

  return rebalance(groups, maxChars, target).map(toCue)
}

/**
 * 조각 길이를 다시 고르게 맞춘다.
 * 뒤 조각이 너무 짧으면 앞 조각의 마지막 어절을 넘겨준다 — 한 단어짜리 자막이 깜빡이는 것을 막는다.
 */
function rebalance(groups: Cue[][], maxChars: number, target: number): Cue[][] {
  const floor = Math.max(6, Math.round(target * 0.5))
  for (let index = groups.length - 1; index > 0; index -= 1) {
    const previous = groups[index - 1]
    const current = groups[index]
    if (!previous || !current) continue
    while (
      len(toCue(current).text) < floor &&
      previous.length > 1 &&
      len(toCue(previous).text) > floor &&
      len(toCue([previous[previous.length - 1] as Cue, ...current]).text) <= maxChars
    ) {
      const moved = previous.pop()
      if (!moved) break
      current.unshift(moved)
    }
  }
  return groups
}

/**
 * 세밀한(단어 단위) 자막을 "한 큐 = 한 줄" 형태로 재구성한다.
 *
 * 규칙(참고: subtitle-automation-rules):
 * - 줄바꿈 금지. 나눠야 하면 새 타임스탬프를 가진 새 큐로 분리.
 * - **한 자막에 두 문장을 담지 않는다.**
 * - 문장이 길면 조각 길이를 고르게 나누고, 큰 쉼과 쉼표·연결어미를 끊는 자리로 우선한다.
 * - 아주 짧은 문장은 앞 자막과 합쳐 한 단어짜리 자막이 깜빡이지 않게 한다.
 * - 시각은 원본 큐에서 그대로 가져와 싱크를 지킨다.
 */
export function reformatSubtitles(cues: Cue[], opts: ReformatOptions = {}): Cue[] {
  const minChars = opts.minChars ?? 18
  const maxChars = opts.maxChars ?? 44
  const gapThreshold = opts.gapMs ?? wordGapThreshold(cues, opts.gapPercentile ?? 0.8, opts.minGapMs ?? 350)

  const out: Cue[] = []
  for (const sentence of groupSentences(cues)) {
    for (const piece of splitSentence(sentence, maxChars, gapThreshold)) {
      const previous = out[out.length - 1]
      // 아주 짧은 문장만 앞줄에 붙인다(한 단어짜리 자막이 깜빡이는 것 방지).
      // 앞줄이 문장 끝일 때만 — 쪼개진 조각 뒤에 붙이면 문장이 뒤엉킨다.
      const canAttach =
        previous !== undefined &&
        len(piece.text) <= Math.min(12, minChars) &&
        SENTENCE_END.test(previous.text) &&
        len(`${previous.text} ${piece.text}`) <= maxChars
      if (canAttach && previous) {
        out[out.length - 1] = { ...previous, endMs: piece.endMs, text: `${previous.text} ${piece.text}` }
        continue
      }
      out.push(piece)
    }
  }
  return out
}
