import type { CaptionStyle } from '../config/schema.js'
import type { CaptionKind } from '../captions/timeline.js'

interface StyleSpec {
  fontcolor: string
  boxAlpha?: number
  borderw?: number
  bordercolor?: string
}

const SPECS: Record<CaptionStyle, StyleSpec> = {
  basic: { fontcolor: 'white', boxAlpha: 0.58 },
  'bold-yellow': { fontcolor: '0xFFD400', boxAlpha: 0.72 },
  'clean-white': { fontcolor: 'white', borderw: 4, bordercolor: 'black' },
  'strong-box': { fontcolor: 'white', boxAlpha: 0.85 },
}

export type CaptionPosition = 'top' | 'center' | 'bottom'

/** 자막 위치 → drawtext y 좌표식. 렌더 변형과 스토리 클립 렌더가 공유한다. */
export function captionYExpression(position: CaptionPosition, height: number): string {
  if (position === 'top') return `h-${Math.round(height * 0.88)}`
  if (position === 'center') return '(h-text_h)/2'
  return `h-${Math.round(height * 0.3)}`
}

/**
 * 자막 스타일 프리셋을 drawtext 필터 파라미터 목록으로 바꾼다.
 * 공시(disclosure) 자막은 법적 고지라서 스타일과 무관하게 차분한 기본형을 유지한다.
 */
export function captionDrawtextParams(style: CaptionStyle, kind: CaptionKind): string[] {
  const spec = kind === 'disclosure' ? SPECS.basic : SPECS[style]
  const boxAlpha = kind === 'disclosure' ? 0.48 : spec.boxAlpha
  const params = [`fontcolor=${spec.fontcolor}`]
  if (boxAlpha !== undefined) {
    params.push('box=1', `boxcolor=black@${boxAlpha.toFixed(2)}`, 'boxborderw=18')
  }
  if (spec.borderw !== undefined) {
    params.push(`borderw=${spec.borderw}`, `bordercolor=${spec.bordercolor ?? 'black'}`)
  }
  return params
}
