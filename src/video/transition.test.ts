import { describe, expect, it } from 'vitest'
import { transitionFadeFilters } from './transition.js'

describe('transitionFadeFilters', () => {
  it('none이면 필터를 만들지 않는다', () => {
    const result = transitionFadeFilters({ transition: 'none', outputDurationSec: 5, fadeIn: true, fadeOut: true })
    expect(result.video).toEqual([])
    expect(result.audio).toEqual([])
  })

  it('fade는 0.25초 페이드 인/아웃을 만든다', () => {
    const result = transitionFadeFilters({ transition: 'fade', outputDurationSec: 5, fadeIn: true, fadeOut: true })
    expect(result.video).toEqual(['fade=t=in:st=0:d=0.25', 'fade=t=out:st=4.750:d=0.25'])
    expect(result.audio).toEqual(['afade=t=in:st=0:d=0.25', 'afade=t=out:st=4.750:d=0.25'])
  })

  it('slow-fade는 0.5초 페이드를 만든다', () => {
    const result = transitionFadeFilters({ transition: 'slow-fade', outputDurationSec: 6, fadeIn: false, fadeOut: true })
    expect(result.video).toEqual(['fade=t=out:st=5.500:d=0.5'])
    expect(result.audio).toEqual(['afade=t=out:st=5.500:d=0.5'])
  })

  it('첫 클립(fadeIn=false)과 마지막 클립(fadeOut=false)에는 해당 페이드를 넣지 않는다', () => {
    const result = transitionFadeFilters({ transition: 'fade', outputDurationSec: 5, fadeIn: false, fadeOut: false })
    expect(result.video).toEqual([])
    expect(result.audio).toEqual([])
  })

  it('짧은 클립에서는 페이드 길이를 클립의 절반까지로 줄인다', () => {
    const result = transitionFadeFilters({ transition: 'slow-fade', outputDurationSec: 0.6, fadeIn: true, fadeOut: true })
    expect(result.video).toEqual(['fade=t=in:st=0:d=0.3', 'fade=t=out:st=0.300:d=0.3'])
  })
})
