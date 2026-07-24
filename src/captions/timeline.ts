import type { Project } from '../config/schema.js'

export type CaptionKind = 'hook' | 'body' | 'cta' | 'disclosure'

export interface CaptionSegment {
  kind: CaptionKind
  text: string
  start: number
  end: number
  position: Project['style']['captionPosition']
}

function clean(value: string | undefined): string {
  return String(value ?? '').trim()
}

function clipDuration(project: Pick<Project, 'clips'>): number {
  return project.clips.reduce((sum, clip) => sum + Math.max(0, clip.end - clip.start), 0)
}

function pushSegment(
  segments: CaptionSegment[],
  segment: CaptionSegment,
  minDuration = 0.25,
): void {
  if (!segment.text || segment.end - segment.start < minDuration) return
  segments.push(segment)
}

export function buildCaptionTimeline(project: Project, hookText: string): CaptionSegment[] {
  const totalDuration = clipDuration(project)
  const position = project.style.captionPosition

  // 스토리 모드: 장면 클립에 이미 자막이 구워져 있으므로
  // 상품형 훅/본문/CTA 오버레이는 겹침(이중 자막)이 된다. 공시 문구만 얹는다.
  if (project.style.tone === 'story') {
    const disclosureDuration = Math.min(3.5, Math.max(1.5, totalDuration * 0.16))
    const segments: CaptionSegment[] = []
    pushSegment(segments, {
      kind: 'disclosure',
      text: clean(project.disclosure.text),
      start: Math.max(0, totalDuration - disclosureDuration),
      end: totalDuration,
      position,
    })
    return segments
  }

  const firstClip = project.clips[0]
  const hookDuration = firstClip ? Math.min(firstClip.end - firstClip.start, totalDuration) : 0
  const disclosureDuration = Math.min(3.5, Math.max(1.5, totalDuration * 0.16))
  const disclosureStart = Math.max(hookDuration, totalDuration - disclosureDuration)
  const contentEnd = Math.max(hookDuration, disclosureStart)
  const bodyEnd = hookDuration + (contentEnd - hookDuration) * 0.58
  const segments: CaptionSegment[] = []

  pushSegment(segments, {
    kind: 'hook',
    text: clean(hookText),
    start: 0,
    end: Math.max(0, hookDuration),
    position,
  })
  pushSegment(segments, {
    kind: 'body',
    text: clean(project.product.benefit),
    start: hookDuration,
    end: bodyEnd,
    position,
  })
  pushSegment(segments, {
    kind: 'cta',
    text: clean(project.publish.cta) || '자세한 정보는 링크에서 확인하세요.',
    start: bodyEnd,
    end: contentEnd,
    position,
  })
  pushSegment(segments, {
    kind: 'disclosure',
    text: clean(project.disclosure.text),
    start: disclosureStart,
    end: totalDuration,
    position,
  })

  return segments
}

export function timelineDuration(project: Pick<Project, 'clips'>): number {
  return clipDuration(project)
}
