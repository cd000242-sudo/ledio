/**
 * 편집 전용 프로젝트 — 영상만 있으면 열린다.
 *
 * 원래 project.yaml은 쇼핑쇼츠용이라 상품명·가격대·제휴URL·고지문구까지 전부 요구했다.
 * 그래서 "영상 하나 자르고 싶을 뿐"인 사람이 편집 기능을 아예 못 열었다(실측으로 확인한 문제).
 *
 * 해결은 스키마를 쪼개는 대신 **기본값을 채워 넣는 것**으로 한다.
 * 이렇게 하면 렌더·스토리보드 등 뒷단 코드는 한 줄도 바뀌지 않는다.
 */

export type ProjectKind = 'edit' | 'shopping' | 'story'

/** 편집 전용 프로젝트에 채워 넣을 기본값. 쇼핑 관련 항목은 "해당 없음"으로 둔다. */
export const EDIT_DEFAULTS = {
  product: {
    name: '편집 프로젝트',
    category: '일반',
    priceRange: '0-0',
    affiliateUrl: 'https://example.com',
    painPoint: '해당 없음',
    benefit: '해당 없음',
  },
  disclosure: {
    type: 'none',
    // 편집만 하는 영상에는 제휴 고지가 필요 없다. 렌더가 빈 값을 싫어해 한 칸만 채운다.
    text: '-',
  },
  style: {
    duration: 60,
    ratio: '16:9',
    resolution: '1920x1080',
    tone: '기본',
    captionPosition: 'bottom',
    captionStyle: 'basic',
    transition: 'none',
    bgmVolume: 0.18,
  },
  variants: { count: 1 },
} as const

/** 프로젝트 종류 — 명시가 없으면 상품 정보 유무로 판단한다(기존 파일 호환). */
export function projectKind(raw: unknown): ProjectKind {
  if (!raw || typeof raw !== 'object') return 'shopping'
  const doc = raw as Record<string, unknown>
  const kind = String(doc.kind ?? '')
  if (kind === 'edit' || kind === 'shopping' || kind === 'story') return kind
  // kind가 없던 시절 파일: 상품 정보가 있으면 쇼핑, 없으면 편집으로 본다.
  return doc.product ? 'shopping' : 'edit'
}

/** 화면 비율에서 해상도를 유추한다 — 세로 영상에 가로 해상도를 넣으면 렌더가 어긋난다. */
export function resolutionFor(ratio: string): string {
  if (ratio === '9:16') return '1080x1920'
  if (ratio === '1:1') return '1080x1080'
  return '1920x1080'
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * 편집 프로젝트면 빠진 항목을 기본값으로 채운다.
 * 사용자가 적어 넣은 값은 절대 덮어쓰지 않는다.
 */
export function withEditDefaults(raw: unknown): unknown {
  if (!isObject(raw)) return raw
  if (projectKind(raw) !== 'edit') return raw

  const style = isObject(raw.style) ? raw.style : {}
  const ratio = String(style.ratio ?? EDIT_DEFAULTS.style.ratio)
  const clips = Array.isArray(raw.clips) ? raw.clips : []

  return {
    ...raw,
    kind: 'edit',
    product: { ...EDIT_DEFAULTS.product, ...(isObject(raw.product) ? raw.product : {}) },
    disclosure: { ...EDIT_DEFAULTS.disclosure, ...(isObject(raw.disclosure) ? raw.disclosure : {}) },
    style: {
      ...EDIT_DEFAULTS.style,
      ...style,
      ratio,
      resolution: String(style.resolution ?? resolutionFor(ratio)),
      // 길이를 안 적었으면 클립 길이 합으로 채운다.
      duration: Number(style.duration ?? totalClipSeconds(clips)) || EDIT_DEFAULTS.style.duration,
    },
    variants: isObject(raw.variants) ? { ...EDIT_DEFAULTS.variants, ...raw.variants } : { ...EDIT_DEFAULTS.variants },
    // 편집 클립은 역할이 필요 없다 — 없으면 첫 클립만 hook, 나머지는 use로 채운다.
    clips: clips.map((clip, index) => {
      if (!isObject(clip)) return clip
      return { ...clip, role: clip.role ?? (index === 0 ? 'hook' : 'use') }
    }),
  }
}

function totalClipSeconds(clips: unknown[]): number {
  let total = 0
  for (const clip of clips) {
    if (!isObject(clip)) continue
    const start = Number(clip.start ?? 0)
    const end = Number(clip.end ?? 0)
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) total += end - start
  }
  return Math.round(total) || 0
}

/** 새 편집 프로젝트의 최소 문서 — 앱이 영상 파일만 받고 만들 때 쓴다. */
export function newEditProject(projectName: string, clipFiles: string[], durationsSec: number[] = []): object {
  return {
    kind: 'edit',
    projectName,
    clips: clipFiles.map((file, index) => ({
      file,
      start: 0,
      end: durationsSec[index] && durationsSec[index] > 0 ? durationsSec[index] : 60,
    })),
  }
}
