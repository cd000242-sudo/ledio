import { describe, expect, it } from 'vitest'
import { auditSubtitles, summarizeAudit } from './audit.js'
import type { Cue } from './srt.js'

const clean: Cue[] = [
  { startMs: 0, endMs: 2000, text: '안녕하세요 기묘한자동화 쿠키입니다 오랜만입니다' },
  { startMs: 2000, endMs: 5000, text: '오늘은 서울대 AI 대학원 이야기를 해보려고 합니다' },
]

describe('자막 검수', () => {
  it('문제 없는 자막은 통과한다', () => {
    const report = auditSubtitles(clean, { expectNoGaps: true })
    expect(report.ok).toBe(true)
    expect(summarizeAudit(report)).toBe('자막 2개 — 문제 없습니다.')
  })

  it('줄바꿈이 섞이면 잡아낸다 — 한 큐는 한 줄이어야 한다', () => {
    const report = auditSubtitles([{ startMs: 0, endMs: 2000, text: '첫 줄입니다 그리고\n둘째 줄입니다 이것도' }])
    expect(report.issues.some((issue) => issue.rule === 'multiline')).toBe(true)
  })

  it('겹치는 자막을 잡아낸다', () => {
    const report = auditSubtitles([
      { startMs: 0, endMs: 3000, text: '앞 자막입니다 충분히 긴 문장으로 씁니다' },
      { startMs: 2000, endMs: 5000, text: '뒤 자막입니다 충분히 긴 문장으로 씁니다' },
    ])
    expect(report.issues.some((issue) => issue.rule === 'overlap')).toBe(true)
  })

  it('공백메움본에서만 빈 구간을 문제 삼는다', () => {
    const gapped: Cue[] = [
      { startMs: 0, endMs: 2000, text: '앞 자막입니다 충분히 긴 문장으로 씁니다' },
      { startMs: 2600, endMs: 5000, text: '뒤 자막입니다 충분히 긴 문장으로 씁니다' },
    ]
    expect(auditSubtitles(gapped).issues.some((issue) => issue.rule === 'gap')).toBe(false)
    const strict = auditSubtitles(gapped, { expectNoGaps: true })
    expect(strict.issues.find((issue) => issue.rule === 'gap')?.message).toContain('600ms')
  })

  it('너무 짧거나 긴 자막을 알려준다', () => {
    const report = auditSubtitles([
      { startMs: 0, endMs: 1000, text: '짧음' },
      { startMs: 1000, endMs: 2000, text: '가'.repeat(50) },
    ])
    const lengths = report.issues.filter((issue) => issue.rule === 'length')
    expect(lengths).toHaveLength(2)
    expect(lengths[0].message).toContain('짧습니다')
    expect(lengths[1].message).toContain('넘습니다')
  })

  it('시간이 거꾸로거나 빈 자막이면 잡는다', () => {
    const report = auditSubtitles([
      { startMs: 5000, endMs: 4000, text: '끝이 시작보다 빠른 자막입니다 길게 씁니다' },
      { startMs: 6000, endMs: 7000, text: '   ' },
    ])
    expect(report.issues.some((issue) => issue.rule === 'order')).toBe(true)
    expect(report.issues.some((issue) => issue.rule === 'empty')).toBe(true)
  })

  it('요약은 항목별 개수와 예시를 함께 보여준다', () => {
    const report = auditSubtitles([{ startMs: 0, endMs: 1000, text: '짧음' }])
    const summary = summarizeAudit(report)
    expect(summary).toContain('길이 1건')
    expect(summary).toContain('1번:')
  })
})
