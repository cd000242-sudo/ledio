export type QualityLevel = 'pass' | 'review' | 'block'

export interface QualityReviewInput {
  hookClear: boolean
  captionReadable: boolean
  disclosurePresent: boolean
  sourceRiskClear: boolean
  platformFit: boolean
  packageComplete: boolean
}

export interface QualityReviewResult {
  level: QualityLevel
  blockingReasons: string[]
  reviewReasons: string[]
}

export function reviewUploadQuality(input: QualityReviewInput): QualityReviewResult {
  const blockingReasons: string[] = []
  const reviewReasons: string[] = []

  if (!input.disclosurePresent) blockingReasons.push('제휴/광고 고지가 없습니다.')
  if (!input.sourceRiskClear) blockingReasons.push('편집 소스의 권리 상태가 불명확합니다.')
  if (!input.packageComplete) blockingReasons.push('업로드 패키지 산출물이 완성되지 않았습니다.')
  if (!input.hookClear) reviewReasons.push('훅이 즉시 이해되지 않을 수 있습니다.')
  if (!input.captionReadable) reviewReasons.push('자막이 모바일 화면에서 읽기 어려울 수 있습니다.')
  if (!input.platformFit) reviewReasons.push('플랫폼 권장 길이/비율을 다시 확인해야 합니다.')

  return {
    level: blockingReasons.length > 0 ? 'block' : reviewReasons.length > 0 ? 'review' : 'pass',
    blockingReasons,
    reviewReasons,
  }
}
