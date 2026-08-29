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
  /** 글자 크기(1080 높이 기준). */
  fontSize?: number
  /** 아래에서 띄울 여백(px). */
  marginV?: number
  /** 테두리 두께 — 밝은 배경에서도 읽히게. */
  outline?: number
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
  const parts = [
    `FontName=${style.fontName ?? 'Malgun Gothic'}`,
    `FontSize=${style.fontSize ?? 18}`,
    `Outline=${style.outline ?? 2}`,
    `MarginV=${style.marginV ?? 40}`,
    'BorderStyle=1',
    'Shadow=0',
    'Alignment=2',
  ]
  return parts.join(',')
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
