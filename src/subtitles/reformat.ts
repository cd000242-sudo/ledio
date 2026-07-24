import type { Cue } from './srt.js'

export interface ReformatOptions {
  /** 의미 단위로 끊을 때 이 길이 이상이면 문장부호에서 끊는다(소프트). */
  minChars?: number
  /** 한 줄 최대 길이(하드 상한). */
  maxChars?: number
}

const SENTENCE_END = /[.!?。…？！]$/

function len(s: string): number {
  return [...s].length
}

/**
 * 세밀한(단어 단위) 자막을 "한 큐 = 한 줄" 형태로 재구성한다.
 *
 * 규칙(참고: subtitle-automation-rules):
 * - 줄바꿈 금지. 문장을 나눠야 하면 새 타임스탬프를 가진 새 큐로 분리.
 * - maxChars는 하드 상한, minChars 이상이면 문장부호에서 의미 단위로 끊는다.
 * - 각 큐의 시작/끝 시간은 원본 큐의 실제 시간에서 가져와 싱크를 유지한다.
 */
export function reformatSubtitles(cues: Cue[], opts: ReformatOptions = {}): Cue[] {
  const minChars = opts.minChars ?? 18
  const maxChars = opts.maxChars ?? 44
  const out: Cue[] = []
  let buf: Cue | null = null

  for (const cue of cues) {
    const piece = cue.text.trim()
    if (!piece) continue

    if (buf === null) {
      buf = { startMs: cue.startMs, endMs: cue.endMs, text: piece }
    } else {
      const merged: string = `${buf.text} ${piece}`
      if (len(merged) > maxChars) {
        out.push({ ...buf, text: buf.text.trim() })
        buf = { startMs: cue.startMs, endMs: cue.endMs, text: piece }
      } else {
        buf = { startMs: buf.startMs, endMs: cue.endMs, text: merged }
      }
    }

    // 문장 끝이고 충분히 길면 의미 단위로 끊는다
    if (buf !== null && SENTENCE_END.test(piece) && len(buf.text) >= minChars) {
      out.push({ ...buf, text: buf.text.trim() })
      buf = null
    }
  }
  if (buf !== null) out.push({ ...buf, text: buf.text.trim() })
  return out
}
