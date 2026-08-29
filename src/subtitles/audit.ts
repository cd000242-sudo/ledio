import type { Cue } from './srt.js'

export interface AuditIssue {
  /** 검수 항목 id — UI가 항목별로 묶어 보여준다. */
  rule: 'order' | 'multiline' | 'overlap' | 'gap' | 'length' | 'empty'
  cueIndex: number
  message: string
}

export interface AuditReport {
  cueCount: number
  issues: AuditIssue[]
  ok: boolean
}

export interface AuditOptions {
  /** 이 길이보다 짧으면 경고(기본 18자). */
  minChars?: number
  /** 이 길이보다 길면 경고(기본 44자). */
  maxChars?: number
  /** 공백메움본 검수 — 자막 사이가 비어 있으면 경고한다. */
  expectNoGaps?: boolean
}

const charLength = (text: string): number => [...text].length

/**
 * 완성된 자막을 검수한다(노션 자막 자동화 규칙의 검수 항목).
 *
 * 1) 큐가 시간순인가 2) 한 큐에 줄바꿈이 없는가 3) 겹치는 구간이 없는가
 * 4) 공백메움본에 빈 구간이 없는가 5) 길이가 기준을 벗어나지 않는가 6) 빈 자막이 없는가
 *
 * 자동으로 고치지 않고 **보고만 한다** — 고칠지는 사람이 정한다.
 */
export function auditSubtitles(cues: Cue[], options: AuditOptions = {}): AuditReport {
  const minChars = options.minChars ?? 18
  const maxChars = options.maxChars ?? 44
  const issues: AuditIssue[] = []

  cues.forEach((cue, index) => {
    const text = cue.text ?? ''
    const previous = cues[index - 1]

    if (!text.trim()) {
      issues.push({ rule: 'empty', cueIndex: index, message: '빈 자막입니다.' })
    }
    if (/\r?\n/.test(text)) {
      issues.push({ rule: 'multiline', cueIndex: index, message: '한 큐에 줄바꿈이 있습니다. 새 큐로 나눠야 합니다.' })
    }
    if (cue.endMs <= cue.startMs) {
      issues.push({ rule: 'order', cueIndex: index, message: '끝 시간이 시작 시간보다 빠르거나 같습니다.' })
    }
    if (previous) {
      if (cue.startMs < previous.startMs) {
        issues.push({ rule: 'order', cueIndex: index, message: '앞 큐보다 시작이 빠릅니다(시간순이 아닙니다).' })
      }
      if (cue.startMs < previous.endMs) {
        issues.push({ rule: 'overlap', cueIndex: index, message: '앞 자막과 겹칩니다.' })
      } else if (options.expectNoGaps && cue.startMs > previous.endMs) {
        const gapMs = cue.startMs - previous.endMs
        issues.push({ rule: 'gap', cueIndex: index, message: `앞 자막과 ${gapMs}ms 비어 있습니다(공백메움본).` })
      }
    }

    const length = charLength(text.trim())
    if (length > 0 && length < minChars) {
      issues.push({ rule: 'length', cueIndex: index, message: `${length}자 — 기준(${minChars}자)보다 짧습니다.` })
    }
    if (length > maxChars) {
      issues.push({ rule: 'length', cueIndex: index, message: `${length}자 — 기준(${maxChars}자)을 넘습니다.` })
    }
  })

  return { cueCount: cues.length, issues, ok: issues.length === 0 }
}

/** 검수 결과를 사람이 읽을 한국어 요약으로 만든다(항목별 개수 + 앞부분 예시). */
export function summarizeAudit(report: AuditReport, sampleSize = 3): string {
  if (report.ok) return `자막 ${report.cueCount}개 — 문제 없습니다.`
  const labels: Record<AuditIssue['rule'], string> = {
    order: '시간 순서',
    multiline: '줄바꿈',
    overlap: '겹침',
    gap: '빈 구간',
    length: '길이',
    empty: '빈 자막',
  }
  const counts = new Map<AuditIssue['rule'], number>()
  for (const issue of report.issues) counts.set(issue.rule, (counts.get(issue.rule) ?? 0) + 1)
  const head = [...counts.entries()].map(([rule, count]) => `${labels[rule]} ${count}건`).join(', ')
  const samples = report.issues
    .slice(0, sampleSize)
    .map((issue) => `- ${issue.cueIndex + 1}번: ${issue.message}`)
  return [`자막 ${report.cueCount}개 — ${head}`, ...samples].join('\n')
}
