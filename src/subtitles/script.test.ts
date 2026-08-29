import { describe, expect, it } from 'vitest'
import {
  acceptPolishedScript,
  buildScriptPolishPrompt,
  cuesToScript,
  paragraphGapThreshold,
} from './script.js'
import type { Cue } from './srt.js'

describe('자막 → 대본', () => {
  /** 문장 사이 쉼을 지정해 큐를 만든다(단어 단위 큐가 문장으로 묶인다). */
  const speech = (sentences: { text: string; gapMs: number }[]): Cue[] => {
    const cues: Cue[] = []
    let clock = 0
    for (const sentence of sentences) {
      clock += sentence.gapMs
      cues.push({ startMs: clock, endMs: clock + 1500, text: sentence.text })
      clock += 1500
    }
    return cues
  }

  it('길게 쉰 자리에서 문단을 나눈다 — 기준은 그 화자의 쉼 분포에서 뽑는다', () => {
    const script = cuesToScript(
      speech([
        { text: '안녕하세요 쿠키입니다.', gapMs: 0 },
        { text: '오늘은 자막 이야기를 합니다.', gapMs: 100 },
        { text: '먼저 받아쓰기부터 보겠습니다.', gapMs: 900 },
        { text: '그 다음은 정렬입니다.', gapMs: 100 },
      ]),
      { minSentences: 2, maxSentences: 5 },
    )
    expect(script).toBe(
      '안녕하세요 쿠키입니다. 오늘은 자막 이야기를 합니다.\n\n먼저 받아쓰기부터 보겠습니다. 그 다음은 정렬입니다.',
    )
  })

  it('쉼이 고른 화자도 문장 수 상한으로 끊어 준다 — 안 그러면 벽처럼 읽힌다', () => {
    const sentences = Array.from({ length: 9 }, (_, index) => ({ text: `문장 ${index}입니다.`, gapMs: 200 }))
    const paragraphs = cuesToScript(speech(sentences), { maxSentences: 3 }).split('\n\n')
    expect(paragraphs).toHaveLength(3)
    for (const paragraph of paragraphs) expect((paragraph.match(/\./g) ?? []).length).toBe(3)
  })

  it('문단이 너무 잘게 쪼개지지 않게 최소 문장 수를 지킨다', () => {
    const script = cuesToScript(
      speech([
        { text: '첫 문장입니다.', gapMs: 0 },
        { text: '둘째 문장입니다.', gapMs: 2000 },
        { text: '셋째 문장입니다.', gapMs: 2000 },
      ]),
      { minSentences: 2 },
    )
    expect(script.split('\n\n')[0]).toBe('첫 문장입니다. 둘째 문장입니다.')
  })

  it('마침표가 없는 마지막 조각도 버리지 않는다', () => {
    expect(cuesToScript([{ startMs: 0, endMs: 1000, text: '끝맺지 않은 말' }])).toBe('끝맺지 않은 말')
  })

  it('빈 큐는 버리고, 큐가 없으면 빈 문자열', () => {
    expect(cuesToScript([{ startMs: 0, endMs: 1000, text: '   ' }, { startMs: 1000, endMs: 2000, text: '내용' }])).toBe('내용')
    expect(cuesToScript([])).toBe('')
  })
})

describe('문단 기준 계산', () => {
  it('쉼 분포의 분위수를 쓰되 최소값 아래로는 내려가지 않는다', () => {
    const sentences = [
      { text: 'a', gapBeforeMs: 0 },
      { text: 'b', gapBeforeMs: 100 },
      { text: 'c', gapBeforeMs: 200 },
      { text: 'd', gapBeforeMs: 900 },
    ]
    expect(paragraphGapThreshold(sentences, 0.75, 300)).toBe(900)
    // 전부 짧게 쉬는 화자라면 최소 기준이 걸린다
    expect(paragraphGapThreshold(sentences.slice(0, 3), 0.5, 300)).toBe(300)
  })
})

describe('대본 다듬기', () => {
  it('내용을 바꾸지 말라는 지시가 들어간다', () => {
    const prompt = buildScriptPolishPrompt('원본 대본입니다.')
    expect(prompt).toContain('요약하지 마라')
    expect(prompt).toContain('문단 구분은 그대로')
    expect(prompt).toContain('원본 대본입니다.')
  })

  it('분량이 비슷하면 다듬은 것을 쓴다', () => {
    const original = '안녕하세요 어 그 오늘은요 자막 이야기입니다.'
    const polished = '안녕하세요. 오늘은 자막 이야기입니다.'
    expect(acceptPolishedScript(original, polished)).toBe(polished)
  })

  it('요약해버리면 원본을 지킨다 — 대본은 말한 그대로여야 한다', () => {
    const original = '가'.repeat(1000)
    expect(acceptPolishedScript(original, '요약: 자막 이야기')).toBe(original)
    expect(acceptPolishedScript(original, '나'.repeat(2000))).toBe(original)
    expect(acceptPolishedScript(original, '   ')).toBe(original)
  })
})
