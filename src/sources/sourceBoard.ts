import type { Source } from '../config/schema.js'
import { assessSourceRisk, type SourceRiskLevel } from '../package/sourceRisk.js'

export type SourcePreset =
  | 'owned_clip'
  | 'official_brand_asset'
  | 'product_page'
  | 'reference_short'
  | 'ai_generated_asset'

export interface CandidateClassification {
  preset: SourcePreset
  rights: Source['rights']
  usage: Source['usage']
  note: string
}

export interface SourceTrace {
  title: string
  locator: string
  rights: Source['rights']
  usage: Source['usage']
  level: SourceRiskLevel
  action: string
}

const SHORT_FORM_HOSTS = ['youtube.com', 'youtu.be', 'instagram.com', 'tiktok.com']
const MARKET_HOSTS = ['amazon.', 'coupang.', 'naver.com', 'smartstore.', 'aliexpress.']

export function presetSource(preset: SourcePreset, title: string, locator: string): Source {
  if (preset === 'owned_clip') {
    return { title, file: locator, rights: 'owned', usage: 'edit' }
  }
  if (preset === 'official_brand_asset') {
    return { title, url: locator, rights: 'official_brand', usage: 'edit' }
  }
  if (preset === 'product_page') {
    return {
      title,
      url: locator,
      rights: 'official_brand',
      usage: 'reference',
      notes: '상품 정보, 가격, 상세 컷 구성을 참고합니다. 영상 소스로 직접 편집하지 않습니다.',
    }
  }
  if (preset === 'ai_generated_asset') {
    return { title, file: locator, rights: 'ai_generated', usage: 'edit' }
  }
  return {
    title,
    url: locator,
    rights: 'reference_only',
    usage: 'reference',
    notes: '훅 구조와 장면 순서만 참고합니다. 원본 영상을 직접 편집 소스로 쓰지 않습니다.',
  }
}

export function classifyCandidateUrl(url: string): CandidateClassification {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    return {
      preset: 'reference_short',
      rights: 'unknown',
      usage: 'reference',
      note: 'URL 형식이 불명확해서 참고 후보로만 보관합니다.',
    }
  }

  if (SHORT_FORM_HOSTS.some((item) => host.includes(item))) {
    return {
      preset: 'reference_short',
      rights: 'reference_only',
      usage: 'reference',
      note: '쇼츠/릴스/틱톡 URL은 구조 분석용으로 분리합니다.',
    }
  }

  if (MARKET_HOSTS.some((item) => host.includes(item))) {
    return {
      preset: 'product_page',
      rights: 'official_brand',
      usage: 'reference',
      note: '상품 상세 페이지는 정보 확인과 구성 참고용으로 분리합니다.',
    }
  }

  return {
    preset: 'reference_short',
    rights: 'unknown',
    usage: 'reference',
    note: '권리 상태가 확실하지 않아 참고 후보로 보관합니다.',
  }
}

export function traceSource(source: Source): SourceTrace {
  const risk = assessSourceRisk(source)
  const locator = source.file ?? source.url ?? ''
  const action =
    risk.level === 'safe'
      ? '사용 가능'
      : risk.level === 'caution'
        ? '권리 확인 후 사용'
        : '편집 소스에서 제외'
  return {
    title: source.title,
    locator,
    rights: source.rights,
    usage: source.usage,
    level: risk.level,
    action,
  }
}
