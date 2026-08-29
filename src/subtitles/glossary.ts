import type { Cue } from './srt.js'

/**
 * 용어 사전 — 내가 자주 쓰는 말이 잘못 받아써질 때 바로잡는다.
 *
 * 두 곳에서 쓴다.
 * 1) 받아쓰기 힌트(initial_prompt) — 애초에 맞게 듣도록 유도한다.
 * 2) 받아쓴 뒤 치환 — 그래도 틀린 것을 고정된 규칙으로 고친다.
 *
 * 예: `AID => AI들` 처럼 "틀린 표기 => 바른 표기"로 적는다.
 * 화살표 없이 단어만 적으면 힌트로만 쓴다(예: `기묘한자동화`).
 */

export interface GlossaryEntry {
  wrong: string
  right: string
}

export interface Glossary {
  /** 치환 규칙 — 긴 것부터 적용해 부분 치환 사고를 막는다. */
  entries: GlossaryEntry[]
  /** 받아쓰기 힌트에 넣을 바른 표기 목록. */
  terms: string[]
}

const ARROW = /\s*(?:=>|->|→|:)\s*/

export function parseGlossary(text: string): Glossary {
  const entries: GlossaryEntry[] = []
  const terms: string[] = []

  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const parts = line.split(ARROW)
    if (parts.length >= 2) {
      const wrong = (parts[0] ?? '').trim()
      const right = parts.slice(1).join(' ').trim()
      if (wrong && right && wrong !== right) {
        entries.push({ wrong, right })
        terms.push(right)
      }
      continue
    }
    terms.push(line)
  }

  entries.sort((left, right) => right.wrong.length - left.wrong.length)
  return { entries, terms: [...new Set(terms)] }
}

/** 받아쓰기 힌트 문장 — 모델이 이 단어들을 알고 듣게 한다. */
export function glossaryHint(glossary: Glossary, limit = 200): string {
  if (glossary.terms.length === 0) return ''
  return `자주 나오는 표현: ${glossary.terms.join(', ')}`.slice(0, limit)
}

/** 한 줄에 사전을 적용한다. */
export function applyGlossaryToText(text: string, glossary: Glossary): string {
  let result = String(text ?? '')
  for (const entry of glossary.entries) {
    result = result.split(entry.wrong).join(entry.right)
  }
  return result
}

/**
 * 자막 큐에 사전을 적용한다. **시각은 건드리지 않는다** — 텍스트만 바꾼다.
 * 몇 군데가 바뀌었는지 함께 돌려줘 화면에 알릴 수 있게 한다.
 */
export function applyGlossary(cues: Cue[], glossary: Glossary): { cues: Cue[]; changed: number } {
  if (glossary.entries.length === 0) return { cues, changed: 0 }
  let changed = 0
  const next = cues.map((cue) => {
    const text = applyGlossaryToText(cue.text, glossary)
    if (text !== cue.text) changed += 1
    return { ...cue, text }
  })
  return { cues: next, changed }
}
