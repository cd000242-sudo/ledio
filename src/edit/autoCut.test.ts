import { describe, expect, it } from 'vitest'
import { buildCutPlan, findCutCandidates, isFillerOnly, keepRanges, looksLikeStumble, similarity } from './autoCut.js'
import type { Cue } from '../subtitles/srt.js'

const cue = (startMs: number, endMs: number, text: string): Cue => ({ startMs, endMs, text })

describe('군더더기 판정', () => {
  it('말버릇만 있는 문장을 잡는다', () => {
    expect(isFillerOnly('어… 그러니까')).toBe(true)
    expect(isFillerOnly('음')).toBe(true)
  })

  it('내용이 있으면 자르지 않는다 — 이게 더 중요하다', () => {
    expect(isFillerOnly('그러니까 제 말은 이겁니다')).toBe(false)
    expect(isFillerOnly('어제 서울에 갔습니다')).toBe(false)
  })
})

describe('말 끊김 판정', () => {
  it('다시 하려고 멈춘 흔적을 잡는다', () => {
    expect(looksLikeStumble('아 잠깐만요 다시 할게요')).toBe(true)
    expect(looksLikeStumble('오늘은 자막 이야기입니다')).toBe(false)
  })
})

describe('문장 닮은 정도', () => {
  it('같은 말을 다시 하면 높게 나온다', () => {
    expect(similarity('이 얘기를 어디 가서 하면', '이 얘기를 어디 가서 하면요')).toBeGreaterThan(0.8)
  })

  it('다른 말은 낮게 나온다', () => {
    expect(similarity('오늘 날씨가 좋네요', '자막을 만들어 봅시다')).toBeLessThan(0.3)
  })

  it('빈 값은 0', () => {
    expect(similarity('', '무언가')).toBe(0)
  })
})

describe('자를 후보 고르기', () => {
  const cues = [
    cue(0, 2000, '안녕하세요 쿠키입니다.'),
    cue(2100, 2600, '어 그러니까'),
    cue(4000, 6000, '오늘은 자막 이야기를 하려고 합니다.'),
    cue(6100, 8200, '오늘은 자막 이야기를 해보려고 합니다.'),
    cue(8300, 10000, '아 잠깐만요 다시 할게요.'),
    cue(12000, 14000, '천천히 설명드리겠습니다.'),
  ]

  it('무음·군더더기·말끊김·중복을 각각 이유와 함께 찾는다', () => {
    const found = findCutCandidates(cues)
    const reasons = found.map((item) => item.reason)
    expect(reasons).toContain('silence')
    expect(reasons).toContain('filler')
    expect(reasons).toContain('stumble')
    expect(reasons).toContain('duplicate')
  })

  it('중복은 앞 문장을 자르고 뒤를 남긴다 — 다시 말한 쪽이 보통 낫다', () => {
    const duplicate = findCutCandidates(cues).find((item) => item.reason === 'duplicate')
    expect(duplicate?.startMs).toBe(4000)
    expect(duplicate?.text).toContain('하려고')
  })

  it('중복은 기본 체크하지 않는다 — 오판이 있을 수 있다', () => {
    const found = findCutCandidates(cues)
    expect(found.find((item) => item.reason === 'duplicate')?.suggested).toBe(false)
    expect(found.find((item) => item.reason === 'filler')?.suggested).toBe(true)
  })

  it('강도를 올리면 더 많이 제안한다', () => {
    const light = findCutCandidates(cues, { strength: 'light' })
    const strong = findCutCandidates(cues, { strength: 'strong' })
    expect(strong.length).toBeGreaterThanOrEqual(light.length)
  })

  it('시간순으로 정렬해서 준다', () => {
    const found = findCutCandidates(cues)
    const starts = found.map((item) => item.startMs)
    expect([...starts].sort((a, b) => a - b)).toEqual(starts)
  })
})

describe('자를 구간 계획', () => {
  it('겹치거나 붙은 구간을 하나로 합친다', () => {
    const plan = buildCutPlan(
      [
        { startMs: 1000, endMs: 2000, text: '', reason: 'silence', label: '', suggested: true },
        { startMs: 1800, endMs: 2600, text: '', reason: 'filler', label: '', suggested: true },
        { startMs: 5000, endMs: 5500, text: '', reason: 'silence', label: '', suggested: true },
      ],
      10000,
    )
    expect(plan.remove).toEqual([
      { startMs: 1000, endMs: 2600 },
      { startMs: 5000, endMs: 5500 },
    ])
    expect(plan.removedMs).toBe(2100)
    expect(plan.keptMs).toBe(7900)
  })

  it('남는 구간을 이어 붙일 순서로 돌려준다', () => {
    const plan = buildCutPlan(
      [{ startMs: 2000, endMs: 3000, text: '', reason: 'silence', label: '', suggested: true }],
      10000,
    )
    expect(keepRanges(plan, 10000)).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 3000, endMs: 10000 },
    ])
  })

  it('아무것도 안 자르면 통째로 남는다', () => {
    const plan = buildCutPlan([], 10000)
    expect(plan.removedMs).toBe(0)
    expect(keepRanges(plan, 10000)).toEqual([{ startMs: 0, endMs: 10000 }])
  })
})
