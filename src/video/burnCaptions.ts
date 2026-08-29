/**
 * 완성 영상에 자막 넣기.
 *
 * 두 가지 방식을 지원한다.
 * - `burn`: 화면에 태워 넣는다(libass). 쇼츠·릴스처럼 플레이어가 자막을 안 켜주는 곳에 필요하다. 재인코딩이라 느리다.
 * - `mux`: 자막 트랙으로 넣는다. 재인코딩이 없어 몇 초면 끝나고 화질 손실도 없다. 대신 시청자가 자막을 켜야 보인다.
 */

export type BurnMode = 'burn' | 'mux'

export interface BurnStyle {
  /** 글꼴 이름. 한글은 맑은 고딕이 어디에나 있다. */
  fontName?: string
  /** 글자 크기(ASS 기준). */
  fontSize?: number
  /** 아래에서 띄울 여백(px). */
  marginV?: number
  /** 테두리 두께 — 밝은 배경에서도 읽히게. */
  outline?: number
  /** 글자 색(#RRGGBB). */
  color?: string
  /** 테두리 색(#RRGGBB). */
  outlineColor?: string
  /** 굵게. */
  bold?: boolean
  /** 반투명 박스를 깔아 가독성을 올린다(요즘 정보성 영상에서 흔한 형태). */
  box?: boolean
  /** 세로 위치 — 하단·중앙·상단. */
  position?: 'bottom' | 'middle' | 'top'
}

/** 요즘 많이 쓰는 자막 모양 프리셋. 사용자가 고른 뒤 세부 값만 손보면 된다. */
export const STYLE_PRESETS: Record<string, BurnStyle> = {
  // 유튜브 롱폼에서 가장 무난한 흰 글씨 + 검은 테두리
  basic: { color: '#FFFFFF', outlineColor: '#000000', outline: 2, bold: false, fontSize: 18 },
  // 쇼츠·릴스용 굵은 흰 글씨 + 두꺼운 테두리
  bold: { color: '#FFFFFF', outlineColor: '#000000', outline: 4, bold: true, fontSize: 20 },
  // 핵심 강조용 노란 글씨
  highlight: { color: '#FFE14D', outlineColor: '#000000', outline: 3, bold: true, fontSize: 20 },
  // 정보성 영상에서 흔한 반투명 박스
  box: { color: '#FFFFFF', outlineColor: '#000000', outline: 0, bold: false, fontSize: 18, box: true },
  // 예능 자막 느낌의 청록 강조
  pop: { color: '#7CF6E8', outlineColor: '#101418', outline: 4, bold: true, fontSize: 20 },
}

/** #RRGGBB → ASS 색(&HBBGGRR&). ASS는 순서가 뒤집혀 있다. */
export function toAssColor(hex: string | undefined, fallback: string): string {
  const value = String(hex ?? '').trim().replace('#', '')
  const source = /^[0-9a-fA-F]{6}$/.test(value) ? value : fallback.replace('#', '')
  const red = source.slice(0, 2)
  const green = source.slice(2, 4)
  const blue = source.slice(4, 6)
  return `&H00${blue}${green}${red}`.toUpperCase()
}

/** 세로 위치 → ASS Alignment(하단 2 · 중앙 5 · 상단 8, 모두 가운데 정렬). */
function alignmentOf(position: BurnStyle['position']): number {
  if (position === 'top') return 8
  if (position === 'middle') return 5
  return 2
}

export interface BurnOptions {
  videoPath: string
  srtPath: string
  outPath: string
  mode?: BurnMode
  style?: BurnStyle
  /** 하드 자막 인코딩 품질(낮을수록 고화질·큰 용량). */
  crf?: number
}

/**
 * libass의 filter 문법에서 경로를 감싼다.
 * 윈도우 드라이브 문자의 콜론(`C:`)을 이스케이프하지 않으면 필터 파서가 옵션 구분자로 읽어 실패한다.
 */
export function escapeFilterPath(path: string): string {
  return path
    .split('\\')
    .join('/')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
}

/** libass force_style 문자열 — 자막 모양을 한 줄로 지정한다. */
export function buildForceStyle(style: BurnStyle = {}): string {
  const preset = STYLE_PRESETS.basic ?? {}
  const merged: BurnStyle = { ...preset, ...style }
  const parts = [
    `FontName=${merged.fontName ?? 'Malgun Gothic'}`,
    `FontSize=${merged.fontSize ?? 18}`,
    `PrimaryColour=${toAssColor(merged.color, '#FFFFFF')}`,
    `OutlineColour=${toAssColor(merged.outlineColor, '#000000')}`,
    `BackColour=${toAssColor(merged.outlineColor, '#000000')}`,
    `Bold=${merged.bold ? 1 : 0}`,
    `Outline=${merged.outline ?? 2}`,
    `MarginV=${merged.marginV ?? 40}`,
    // BorderStyle 3 = 글자 뒤에 박스를 깐다. 1 = 테두리만.
    `BorderStyle=${merged.box ? 3 : 1}`,
    'Shadow=0',
    `Alignment=${alignmentOf(merged.position)}`,
  ]
  return parts.join(',')
}

/** 프리셋 이름 + 사용자가 손본 값 → 최종 스타일. */
export function resolveStyle(presetName: string | undefined, overrides: BurnStyle = {}): BurnStyle {
  const preset = STYLE_PRESETS[String(presetName ?? 'basic')] ?? STYLE_PRESETS.basic ?? {}
  return { ...preset, ...overrides }
}

export function buildBurnArgs(options: BurnOptions): string[] {
  const mode: BurnMode = options.mode ?? 'burn'
  if (mode === 'mux') {
    // 재인코딩 없이 자막 트랙만 얹는다 — mp4는 mov_text가 표준이다.
    return [
      '-y',
      '-i',
      options.videoPath,
      '-i',
      options.srtPath,
      '-c',
      'copy',
      '-c:s',
      'mov_text',
      '-metadata:s:s:0',
      'language=kor',
      options.outPath,
    ]
  }
  const filter = `subtitles='${escapeFilterPath(options.srtPath)}':force_style='${buildForceStyle(options.style)}'`
  return [
    '-y',
    '-i',
    options.videoPath,
    '-vf',
    filter,
    '-c:a',
    'copy',
    '-c:v',
    'libx264',
    '-preset',
    'medium',
    '-crf',
    String(options.crf ?? 20),
    options.outPath,
  ]
}

/** 결과 파일 이름 — 원본 옆에 두고 덮어쓰지 않는다. */
export function burnedOutputName(videoPath: string, mode: BurnMode = 'burn'): string {
  const dot = videoPath.lastIndexOf('.')
  const stem = dot > 0 ? videoPath.slice(0, dot) : videoPath
  const ext = dot > 0 ? videoPath.slice(dot) : '.mp4'
  return `${stem}_자막${mode === 'mux' ? '트랙' : ''}${ext}`
}
