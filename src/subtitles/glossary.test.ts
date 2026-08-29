import { describe, expect, it } from 'vitest'
import { applyGlossary, glossaryHint, parseGlossary } from './glossary.js'

describe('용어 사전 읽기', () => {
  it('"틀린표기 => 바른표기" 규칙과 단어 힌트를 함께 읽는다', () => {
    const glossary = parseGlossary(['AID => AI들', '기묘한자동화', '# 주석은 무시', '', '에이아이 -> AI'].join('\n'))
    expect(glossary.entries).toEqual([
      { wrong: '에이아이', right: 'AI' },
      { wrong: 'AID', right: 'AI들' },
    ])
    expect(glossary.terms).toContain('기묘한자동화')
    expect(glossary.terms).toContain('AI들')
  })

  it('긴 규칙을 먼저 적용한다 — 짧은 규칙이 먼저 먹으면 엉뚱하게 바뀐다', () => {
    const glossary = parseGlossary(['AI => 에이아이', 'AID => AI들'].join('\n'))
    expect(glossary.entries[0]?.wrong).toBe('AID')
  })

  it('화살표는 =>, ->, →, : 를 모두 받는다', () => {
    expect(parseGlossary('가 : 나').entries).toEqual([{ wrong: '가', right: '나' }])
    expect(parseGlossary('가 → 나').entries).toEqual([{ wrong: '가', right: '나' }])
  })
})

describe('받아쓰기 힌트', () => {
  it('바른 표기를 한 줄로 모은다', () => {
    const hint = glossaryHint(parseGlossary(['AID => AI들', '기묘한자동화'].join('\n')))
    expect(hint).toContain('AI들')
    expect(hint).toContain('기묘한자동화')
  })

  it('사전이 비면 힌트도 비운다', () => {
    expect(glossaryHint(parseGlossary(''))).toBe('')
  })
})

describe('자막에 사전 적용', () => {
  const cues = [
    { startMs: 0, endMs: 1000, text: 'AID을 소개합니다' },
    { startMs: 1000, endMs: 2000, text: '문제 없는 문장' },
  ]

  it('텍스트만 바꾸고 시각은 그대로 둔다', () => {
    const result = applyGlossary(cues, parseGlossary('AID => AI들'))
    expect(result.cues[0]).toEqual({ startMs: 0, endMs: 1000, text: 'AI들을 소개합니다' })
    expect(result.cues[1]).toEqual(cues[1])
    expect(result.changed).toBe(1)
  })

  it('사전이 비면 원본을 그대로 돌려준다', () => {
    const result = applyGlossary(cues, parseGlossary(''))
    expect(result.cues).toBe(cues)
    expect(result.changed).toBe(0)
  })
})
