import type { Cue } from './srt.js'

/**
 * 대본 대조 보정 — STT 오타를 원본 대본을 참고해 고친다.
 *
 * 핵심 제약(노션 자막 자동화 규칙):
 * - **타임스탬프는 절대 바꾸지 않는다.** 텍스트만 교체한다.
 * - 대본과 강제로 1:1 일치시키지 않는다 — 실제 음성이 우선이고 대본은 참고다.
 * - 큐 개수가 달라지면 보정 결과를 통째로 버린다(싱크가 밀리느니 원본이 낫다).
 *
 * LLM 호출 자체는 서버가 한다. 여기서는 프롬프트 조립과 응답 검증만 담당한다(순수 함수).
 */

/** 한 번에 보낼 큐 수 — 너무 크면 모델이 줄을 빠뜨리고, 너무 작으면 문맥이 끊긴다. */
export const CORRECTION_BATCH_SIZE = 40

export function buildCorrectionPrompt(cues: Cue[], script: string): string {
  const numbered = cues.map((cue, index) => `${index + 1}. ${cue.text}`).join('\n')
  return [
    '아래는 음성인식(STT)으로 만든 자막이다. 원본 대본을 참고해서 잘못 들린 부분을 고쳐라.',
    '',
    '규칙:',
    '- 오타, 영어 단어, 숫자, 고유명사를 문맥에 맞게 고친다.',
    '- 대본을 그대로 읽은 것이 아니므로 강제로 대본과 일치시키지 마라. 실제 발화가 우선이다.',
    '- 문장을 합치거나 나누지 마라. 줄 수를 바꾸지 마라.',
    '- 각 줄의 번호를 그대로 유지하고, 고칠 것이 없는 줄도 원문 그대로 다시 출력한다.',
    '- 설명·인사·코드블록 없이 "번호. 텍스트" 형식의 줄만 출력한다.',
    '',
    '=== 원본 대본 (참고용) ===',
    script.trim().slice(0, 12000),
    '',
    '=== 고칠 자막 ===',
    numbered,
  ].join('\n')
}

/**
 * 모델 응답을 원본 큐에 덮어쓴다.
 * 줄 수가 맞지 않거나 번호가 어긋나면 `null`을 돌려준다 — 호출부는 원본을 그대로 쓴다.
 */
export function applyCorrectionResponse(cues: Cue[], response: string): Cue[] | null {
  const parsed = new Map<number, string>()
  for (const rawLine of String(response ?? '').split(/\r?\n/)) {
    const match = /^\s*(\d+)\s*[.)]\s*(.*)$/.exec(rawLine)
    if (!match) continue
    const index = Number(match[1]) - 1
    const text = (match[2] ?? '').trim()
    if (index < 0 || index >= cues.length || !text) continue
    // 같은 번호가 여러 번 나오면 첫 줄만 믿는다(모델이 예시를 반복하는 경우가 있다).
    if (!parsed.has(index)) parsed.set(index, text)
  }
  if (parsed.size !== cues.length) return null
  return cues.map((cue, index) => ({ ...cue, text: parsed.get(index) ?? cue.text }))
}

/** 큐를 배치로 쪼갠다 — 각 배치는 원래 위치(offset)를 들고 다닌다. */
export function splitIntoBatches(cues: Cue[], size = CORRECTION_BATCH_SIZE): { offset: number; cues: Cue[] }[] {
  const batches: { offset: number; cues: Cue[] }[] = []
  for (let offset = 0; offset < cues.length; offset += size) {
    batches.push({ offset, cues: cues.slice(offset, offset + size) })
  }
  return batches
}

/** 배치 보정 결과를 원본 자리에 합친다. 실패한 배치는 원본을 유지한다. */
export function mergeCorrectedBatches(cues: Cue[], results: { offset: number; cues: Cue[] | null }[]): Cue[] {
  const merged = [...cues]
  for (const result of results) {
    if (!result.cues) continue
    result.cues.forEach((cue, index) => {
      const target = result.offset + index
      // 시간은 원본 것을 그대로 지킨다 — 모델이 준 값은 쓰지 않는다.
      const original = merged[target]
      if (original) merged[target] = { ...original, text: cue.text }
    })
  }
  return merged
}

/**
 * 대본이 없을 때의 교정 프롬프트 — 문맥만 보고 잘못 들린 말을 고친다.
 * 대본 대조와 규칙은 같다: **줄 수·타임스탬프를 바꾸지 않고 텍스트만** 고친다.
 */
export function buildProofreadPrompt(cues: Cue[], terms: string[] = []): string {
  const numbered = cues.map((cue, index) => `${index + 1}. ${cue.text}`).join('\n')
  return [
    '아래는 음성인식(STT)으로 만든 자막이다. 문맥을 보고 잘못 들린 부분만 고쳐라.',
    '',
    '규칙:',
    '- 오타, 잘못 들린 단어, 영어·숫자·고유명사 표기를 문맥에 맞게 고친다.',
    '- 말투와 내용은 그대로 둔다. 요약하거나 다듬지 마라.',
    '- 문장을 합치거나 나누지 마라. 줄 수를 바꾸지 마라.',
    '- 각 줄의 번호를 유지하고, 고칠 것이 없는 줄도 원문 그대로 다시 출력한다.',
    '- 설명 없이 "번호. 텍스트" 형식의 줄만 출력한다.',
    terms.length > 0 ? `- 이 표현들은 바르게 쓴 것이다: ${terms.join(', ')}` : '',
    '',
    '=== 자막 ===',
    numbered,
  ]
    .filter(Boolean)
    .join('\n')
}
