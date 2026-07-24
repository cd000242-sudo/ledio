import type { Project, Source } from '../config/schema.js'

export type SourceRiskLevel = 'safe' | 'caution' | 'risk'

export interface SourceRiskItem {
  title: string
  url?: string
  file?: string
  rights: Source['rights']
  usage: Source['usage']
  level: SourceRiskLevel
  reason: string
  notes?: string
}

export interface SourceRiskReport {
  projectName: string
  summary: Record<SourceRiskLevel, number>
  items: SourceRiskItem[]
}

const SAFE_EDIT_RIGHTS = new Set<Source['rights']>([
  'owned',
  'licensed',
  'official_brand',
  'creative_commons',
  'ai_generated',
])

export function assessSourceRisk(source: Source): Pick<SourceRiskItem, 'level' | 'reason'> {
  if (source.usage === 'reference') {
    if (source.rights === 'unknown' || source.rights === 'permission_pending') {
      return {
        level: 'caution',
        reason: '참고 분석용이지만 권리 상태가 확정되지 않았습니다.',
      }
    }
    return {
      level: 'safe',
      reason: '참고 분석용으로 분류되어 실제 편집 소스에 직접 포함되지 않습니다.',
    }
  }

  if (SAFE_EDIT_RIGHTS.has(source.rights)) {
    return {
      level: 'safe',
      reason: '편집에 사용할 수 있는 권리 상태로 표시되어 있습니다.',
    }
  }

  if (source.rights === 'reference_only') {
    return {
      level: 'risk',
      reason: '참고 전용 소스를 실제 편집 소스로 사용하도록 설정했습니다.',
    }
  }

  return {
    level: 'caution',
    reason: '편집에 넣기 전 권리 확인 또는 사용 허가 기록이 필요합니다.',
  }
}

export function buildSourceRiskReport(project: Project): SourceRiskReport {
  const items = project.sources.map((source) => {
    const risk = assessSourceRisk(source)
    return {
      title: source.title,
      url: source.url,
      file: source.file,
      rights: source.rights,
      usage: source.usage,
      level: risk.level,
      reason: risk.reason,
      notes: source.notes,
    }
  })

  const summary: Record<SourceRiskLevel, number> = { safe: 0, caution: 0, risk: 0 }
  for (const item of items) {
    summary[item.level] += 1
  }

  return {
    projectName: project.projectName,
    summary,
    items,
  }
}
