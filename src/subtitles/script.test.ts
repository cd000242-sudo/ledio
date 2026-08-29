import { describe, expect, it } from 'vitest'
import { acceptPolishedScript, buildScriptPolishPrompt, cuesToScript } from './script.js'
import type { Cue } from './srt.js'

const cue = (startMs: number, endMs: number, text: string): Cue => ({ startMs, endMs, text })

describe('자막 → 대본', () => {
  it('문장을 잇고 긴 쉼에서 문단을 나눈다', () => {
    const script = cuesToScript([
      cue(0, 2000, '안녕하세요 쿠키입니다.'),
      cue(2100, 4000, '오늘은 자막 이야기를 하려고 합니다.'),
      // 2초 쉼 — 여기서 문단이 바뀐다
      cue(6000, 8000, '먼저 받아쓰기부터 보겠습니다.'),
    ])
    expect(script).toBe(
      '안녕하세요 쿠키입니다. 오늘은 자막 이야기를 하려고 합니다.\n\n먼저 받아쓰기부터 보겠습니다.',
    )
  })

  it('문장이 안 끝났으면 쉼이 길어도 자르지 않는다', () => {
    const script = cuesToScript([
      cue(0, 2000, '그러니까 제 말은'),
      cue(6000, 8000, '이게 생각보다 오래 걸린다는 겁니다.'),
    ])
    expect(script).toBe('그러니까 제 말은 이게 생각보다 오래 걸린다는 겁니다.')
  })

  it('문단이 너무 길면 문장 끝에서 나눈다', () => {
    const long = Array.from({ length: 12 }, (_, index) => cue(index * 1000, index * 1000 + 900, '같은 문장을 계속 반복합니다.'))
    const script = cuesToScript(long, { maxParagraphChars: 100 })
    const paragraphs = script.split('\n\n')
    expect(paragraphs.length).toBeGreaterThan(1)
    for (const paragraph of paragraphs) expect([...paragraph].length).toBeLessThan(200)
  })

  it('빈 큐는 버리고, 큐가 없으면 빈 문자열', () => {
    expect(cuesToScript([cue(0, 1000, '   '), cue(1000, 2000, '내용')])).toBe('내용')
    expect(cuesToScript([])).toBe('')
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
