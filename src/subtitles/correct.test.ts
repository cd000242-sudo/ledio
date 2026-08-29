import { describe, expect, it } from 'vitest'
import {
  applyCorrectionResponse,
  buildCorrectionPrompt,
  mergeCorrectedBatches,
  splitIntoBatches,
} from './correct.js'
import type { Cue } from './srt.js'

const cues: Cue[] = [
  { startMs: 0, endMs: 1000, text: '안녕하세요 기묘한 자동화 쿠키입니다' },
  { startMs: 1000, endMs: 2000, text: '서울대 AI 대학언에 입학했습니다' },
]

describe('보정 프롬프트', () => {
  it('번호를 붙이고 대본을 참고용으로 넣는다', () => {
    const prompt = buildCorrectionPrompt(cues, '안녕하세요, 기묘한자동화 쿠키입니다. 서울대 AI 대학원 입학기.')
    expect(prompt).toContain('1. 안녕하세요 기묘한 자동화 쿠키입니다')
    expect(prompt).toContain('2. 서울대 AI 대학언에 입학했습니다')
    expect(prompt).toContain('서울대 AI 대학원 입학기')
    // 싱크가 밀리는 것을 막는 지시가 반드시 들어 있어야 한다
    expect(prompt).toContain('줄 수를 바꾸지 마라')
    expect(prompt).toContain('실제 발화가 우선')
  })

  it('대본이 아주 길면 잘라서 넣는다', () => {
    const prompt = buildCorrectionPrompt(cues, '가'.repeat(20000))
    expect(prompt.length).toBeLessThan(14000)
  })
})

describe('보정 응답 적용', () => {
  it('텍스트만 바꾸고 시간은 원본을 지킨다', () => {
    const result = applyCorrectionResponse(cues, '1. 안녕하세요 기묘한자동화 쿠키입니다\n2. 서울대 AI 대학원에 입학했습니다')
    expect(result).not.toBeNull()
    expect(result?.[1]).toEqual({ startMs: 1000, endMs: 2000, text: '서울대 AI 대학원에 입학했습니다' })
  })

  it('줄 수가 모자라면 통째로 버린다 — 싱크가 밀리느니 원본이 낫다', () => {
    expect(applyCorrectionResponse(cues, '1. 안녕하세요')).toBeNull()
    expect(applyCorrectionResponse(cues, '설명만 하고 끝남')).toBeNull()
  })

  it('같은 번호를 반복하면 첫 줄만 쓴다', () => {
    const result = applyCorrectionResponse(cues, '1. 첫번째\n1. 예시 반복\n2. 두번째')
    expect(result?.[0].text).toBe('첫번째')
  })

  it('번호 형식이 1) 이어도 읽는다', () => {
    const result = applyCorrectionResponse(cues, '1) 첫번째\n2) 두번째')
    expect(result?.[0].text).toBe('첫번째')
  })
})

describe('배치 처리', () => {
  const many: Cue[] = Array.from({ length: 95 }, (_, index) => ({
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    text: `문장 ${index}`,
  }))

  it('배치는 원래 위치를 들고 다닌다', () => {
    const batches = splitIntoBatches(many, 40)
    expect(batches.map((batch) => batch.offset)).toEqual([0, 40, 80])
    expect(batches[2].cues).toHaveLength(15)
  })

  it('실패한 배치는 원본을 유지하고, 성공한 배치만 반영한다', () => {
    const batches = splitIntoBatches(many, 40)
    const merged = mergeCorrectedBatches(many, [
      { offset: batches[0].offset, cues: batches[0].cues.map((cue) => ({ ...cue, text: '고침' })) },
      { offset: batches[1].offset, cues: null },
      { offset: batches[2].offset, cues: batches[2].cues.map((cue) => ({ ...cue, text: '고침' })) },
    ])
    expect(merged[0].text).toBe('고침')
    expect(merged[40].text).toBe('문장 40')
    expect(merged[80].text).toBe('고침')
    // 시간은 어느 경우에도 원본 그대로여야 한다
    expect(merged.map((cue) => cue.startMs)).toEqual(many.map((cue) => cue.startMs))
  })
})
