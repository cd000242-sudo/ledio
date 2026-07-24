import type { Transition } from '../config/schema.js'

export interface TransitionFadeOptions {
  transition: Transition
  /** 정규화 후 클립 길이(초). 페이드 아웃 시작 시점 계산에 쓴다. */
  outputDurationSec: number
  /** 첫 클립은 후킹을 위해 페이드 인 없이 시작한다. */
  fadeIn: boolean
  /** 마지막 클립은 끝까지 화면을 유지한다. */
  fadeOut: boolean
}

const FADE_DURATIONS: Record<Exclude<Transition, 'none'>, number> = {
  fade: 0.25,
  'slow-fade': 0.5,
}

/**
 * 클립 경계용 페이드 인/아웃 필터를 만든다.
 * 클립 길이는 그대로라 자막/타임라인 싱크가 흔들리지 않는다.
 */
export function transitionFadeFilters(opts: TransitionFadeOptions): { video: string[]; audio: string[] } {
  if (opts.transition === 'none' || (!opts.fadeIn && !opts.fadeOut)) return { video: [], audio: [] }

  const duration = Math.min(FADE_DURATIONS[opts.transition], Math.max(0.05, opts.outputDurationSec / 2))
  const fadeOutStart = Math.max(0, opts.outputDurationSec - duration).toFixed(3)
  const video: string[] = []
  const audio: string[] = []

  if (opts.fadeIn) {
    video.push(`fade=t=in:st=0:d=${duration}`)
    audio.push(`afade=t=in:st=0:d=${duration}`)
  }
  if (opts.fadeOut) {
    video.push(`fade=t=out:st=${fadeOutStart}:d=${duration}`)
    audio.push(`afade=t=out:st=${fadeOutStart}:d=${duration}`)
  }
  return { video, audio }
}
