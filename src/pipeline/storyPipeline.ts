export type PipelineStage = 'images' | 'motion' | 'narrate' | 'clips' | 'render'

export interface StagePlanInput {
  force: boolean
  skipNarration: boolean
  /** 장면 영상화 사용 여부(none이면 false). motion 단계는 이미지 다음에 들어간다. */
  useMotion?: boolean
  /** motion 산출물(scene_XX.mp4)이 이미 있는지 */
  hasMotion?: boolean
  hasStoryboard: boolean
  hasNarrated: boolean
  hasProject: boolean
  hasVideo: boolean
}

/**
 * 실행할 파이프라인 단계를 결정한다(순수 함수).
 * - force: 전부 다시
 * - 산출물이 이미 있으면 해당 단계 스킵(중단 지점부터 재개)
 * - 앞 단계를 다시 돌리면 뒤 단계도 전부 다시 돌린다(stale 방지)
 */
export function planPipelineStages(input: StagePlanInput): PipelineStage[] {
  const stages: PipelineStage[] = []
  let invalidated = input.force

  if (invalidated || !input.hasStoryboard) {
    stages.push('images')
    invalidated = true
  }
  if (input.useMotion && (invalidated || !input.hasMotion)) {
    // 장면별 산출물(scene_XX.mp4) 단위 스킵/재개는 motion 단계 내부에서 처리한다.
    stages.push('motion')
    invalidated = true
  }
  if (!input.skipNarration && (invalidated || !input.hasNarrated)) {
    stages.push('narrate')
    invalidated = true
  }
  if (invalidated || !input.hasProject) {
    stages.push('clips')
    invalidated = true
  }
  if (invalidated || !input.hasVideo) {
    stages.push('render')
  }
  return stages
}
