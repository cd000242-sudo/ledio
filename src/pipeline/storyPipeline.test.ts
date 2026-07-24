import { describe, expect, it } from 'vitest'
import { planPipelineStages } from './storyPipeline.js'

const none = {
  force: false,
  skipNarration: false,
  hasStoryboard: false,
  hasNarrated: false,
  hasProject: false,
  hasVideo: false,
}

describe('planPipelineStages', () => {
  it('처음이면 전체 단계를 돌린다', () => {
    expect(planPipelineStages(none)).toEqual(['images', 'narrate', 'clips', 'render'])
  })

  it('이미지가 있으면 나레이션부터 재개한다', () => {
    expect(planPipelineStages({ ...none, hasStoryboard: true })).toEqual([
      'narrate',
      'clips',
      'render',
    ])
  })

  it('전부 있으면 아무것도 안 한다', () => {
    expect(
      planPipelineStages({
        ...none,
        hasStoryboard: true,
        hasNarrated: true,
        hasProject: true,
        hasVideo: true,
      }),
    ).toEqual([])
  })

  it('force면 산출물이 있어도 전부 다시 돌린다', () => {
    expect(
      planPipelineStages({
        ...none,
        force: true,
        hasStoryboard: true,
        hasNarrated: true,
        hasProject: true,
        hasVideo: true,
      }),
    ).toEqual(['images', 'narrate', 'clips', 'render'])
  })

  it('skipNarration이면 narrate를 건너뛴다', () => {
    expect(planPipelineStages({ ...none, skipNarration: true })).toEqual([
      'images',
      'clips',
      'render',
    ])
  })

  it('앞 단계를 다시 돌리면 뒤 단계도 다시 돌린다(stale 방지)', () => {
    // storyboard 없음 → images 재실행 → narrated/project/video 있어도 전부 재실행
    expect(
      planPipelineStages({
        ...none,
        hasNarrated: true,
        hasProject: true,
        hasVideo: true,
      }),
    ).toEqual(['images', 'narrate', 'clips', 'render'])
  })
})
