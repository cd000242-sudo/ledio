import { describe, expect, it } from 'vitest'
import {
  budgetArgs,
  classifyLimitError,
  describeAgentFailure,
  DEFAULT_BUDGET_USD,
  resolveBudgetUsd,
} from './usage-limit.mjs'

describe('예산 상한 인자', () => {
  it('상한이 있으면 print 모드 플래그를 만든다', () => {
    expect(budgetArgs(1)).toEqual(['--max-budget-usd', '1'])
    expect(budgetArgs(2.5)).toEqual(['--max-budget-usd', '2.5'])
  })

  it('상한이 없거나 이상하면 인자를 넣지 않는다', () => {
    expect(budgetArgs(null)).toEqual([])
    expect(budgetArgs(0)).toEqual([])
    expect(budgetArgs(-1)).toEqual([])
    expect(budgetArgs(Number.NaN)).toEqual([])
  })
})

describe('환경변수 상한', () => {
  it('빈 값이면 기본값을 쓴다', () => {
    expect(resolveBudgetUsd('', DEFAULT_BUDGET_USD.call)).toBe(DEFAULT_BUDGET_USD.call)
    expect(resolveBudgetUsd(undefined, 5)).toBe(5)
  })

  it('숫자면 그 값으로 덮어쓴다', () => {
    expect(resolveBudgetUsd('3', 1)).toBe(3)
    expect(resolveBudgetUsd(' 0.5 ', 1)).toBe(0.5)
  })

  it('0이나 off면 상한 없음', () => {
    expect(resolveBudgetUsd('0', 1)).toBe(null)
    expect(resolveBudgetUsd('off', 1)).toBe(null)
  })

  it('오타는 조용히 기본값으로 — 앱이 멈추는 쪽이 더 나쁘다', () => {
    expect(resolveBudgetUsd('한도없음', 1)).toBe(1)
    expect(resolveBudgetUsd('-2', 1)).toBe(1)
  })
})

describe('한도 오류 분류', () => {
  it('5시간·주간 한도는 기다리는 것 말고 방법이 없다', () => {
    const session = classifyLimitError("You've hit your session limit. Resets 3pm.")
    expect(session.kind).toBe('session')
    expect(session.switchable).toBe(false)
    // 리셋 시각은 파싱하지 않고 원문으로 흘려보낸다
    expect(session.detail).toContain('Resets 3pm')

    expect(classifyLimitError("You've hit your weekly limit").kind).toBe('weekly')
  })

  it('모델별 한도는 모델을 바꾸면 계속 쓸 수 있다', () => {
    for (const name of ['Opus', 'Sonnet', 'Haiku']) {
      const limit = classifyLimitError(`You've hit your ${name} limit`)
      expect(limit.kind).toBe('model')
      expect(limit.switchable).toBe(true)
    }
  })

  it('앱이 건 예산 상한도 구분한다', () => {
    expect(classifyLimitError('Budget limit reached').kind).toBe('budget')
  })

  it('한도와 무관한 오류는 건드리지 않는다', () => {
    expect(classifyLimitError('ENOENT: no such file')).toBe(null)
    expect(classifyLimitError('')).toBe(null)
    expect(classifyLimitError(null)).toBe(null)
  })
})

describe('실패 문구', () => {
  it('한도 오류는 사용자 말로 바꾼다', () => {
    const message = describeAgentFailure("You've hit your weekly limit", '에이전트 오류(1)')
    expect(message).toContain('주간 사용 한도')
    expect(message).toContain('원문:')
  })

  it('한도가 아니면 원래 문구를 그대로 쓴다', () => {
    expect(describeAgentFailure('ENOENT', '에이전트 오류(1): ENOENT')).toBe('에이전트 오류(1): ENOENT')
  })
})
