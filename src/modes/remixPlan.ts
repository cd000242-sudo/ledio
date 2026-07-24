import { z } from 'zod'

/**
 * 소스 짜집기(리믹스) 계획 — 서버(분석)가 만들고 CLI(source-remix)가 소비하는 계약.
 * 문장 배열과 assignments 길이는 반드시 같다(문장 1개 = 장면 1개 = 배정 1개).
 */

export const remixSourceSchema = z.object({
  /** 프로젝트 기준 상대경로 또는 절대경로 (clips/xxx.mp4) */
  file: z.string().min(1),
  /** 대표 프레임 png — 비전 분석 입력이자 세그먼트 실패 시 정지 이미지 폴백 */
  frame: z.string().min(1),
  description: z.string().default(''),
  durationSec: z.number().positive(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  /** 박힌 자막 영역(화면 높이 비율 0~1). 없으면 null — 블러 생략 */
  subtitleBand: z
    .object({ top: z.number().min(0).max(1), bottom: z.number().min(0).max(1) })
    .nullable()
    .default(null),
})

export const remixPlanSchema = z
  .object({
    projectName: z.string().min(1),
    title: z.string().min(1).optional(),
    sentences: z.array(z.string().min(1)).min(1),
    sources: z.array(remixSourceSchema).min(1),
    /** 문장 i → sources 인덱스 */
    assignments: z.array(z.number().int().min(0)),
    ratio: z.enum(['9:16', '16:9']).default('9:16'),
    disclosure: z.string().min(1).optional(),
  })
  .refine((plan) => plan.assignments.length === plan.sentences.length, {
    message: 'assignments 길이는 sentences와 같아야 합니다.',
  })
  .refine((plan) => plan.assignments.every((index) => index < plan.sources.length), {
    message: 'assignments가 sources 범위를 벗어났습니다.',
  })

export type RemixPlan = z.infer<typeof remixPlanSchema>
export type RemixSource = z.infer<typeof remixSourceSchema>

export interface RemixSegment {
  sourceIndex: number
  offsetSec: number
  cutSec: number
}

/** 남은 구간이 이보다 짧으면 소스 처음으로 되감는다(0.5초 미만 조각 방지). */
const MIN_REMAINDER_SEC = 0.5

/**
 * 문장별 소스 세그먼트를 계획한다.
 * 같은 소스가 여러 문장에 배정되면 커서를 순차 전진시켜 구간이 겹치지 않게 하고,
 * 소스 끝에 닿으면 처음으로 랩한다. cutSec이 장면 길이보다 짧으면
 * 렌더 단계의 `-stream_loop -1`이 부족분을 반복 재생으로 채운다.
 */
export function planRemixSegments(
  sources: Array<Pick<RemixSource, 'durationSec'>>,
  assignments: number[],
  sceneDurations: number[],
): RemixSegment[] {
  const cursors = sources.map(() => 0)
  return assignments.map((sourceIndex, sceneIndex) => {
    const source = sources[sourceIndex]
    const wanted = Math.max(0.1, sceneDurations[sceneIndex] ?? 3)
    if (!source) return { sourceIndex: 0, offsetSec: 0, cutSec: wanted }
    const total = Math.max(0.1, source.durationSec)
    let offset = cursors[sourceIndex] ?? 0
    if (total - offset < MIN_REMAINDER_SEC) offset = 0
    const cut = Math.min(wanted, total - offset)
    cursors[sourceIndex] = offset + cut
    return { sourceIndex, offsetSec: offset, cutSec: Number(cut.toFixed(3)) }
  })
}

function evenFloor(value: number): number {
  const floored = Math.floor(value)
  return floored % 2 === 0 ? floored : floored - 1
}

/**
 * 자막 영역만 블러하는 filter_complex 체인.
 * 밴드가 없거나 역전·과대(높이 40% 초과)면 null — 블러 생략.
 */
export function buildSubtitleBlurFilter(
  width: number,
  height: number,
  band: { top: number; bottom: number } | null,
): string | null {
  if (!band) return null
  const top = Math.min(1, Math.max(0, band.top))
  const bottom = Math.min(1, Math.max(0, band.bottom))
  if (bottom <= top || bottom - top > 0.4) return null
  const cropW = evenFloor(width)
  const cropY = evenFloor(height * top)
  const cropH = evenFloor(height * bottom - cropY)
  if (cropW <= 0 || cropH <= 0) return null
  // yuv420p 크로마 평면은 절반 크기 — 반경이 (밴드높이/2)/2 이상이면 ffmpeg가 거부한다.
  // 밴드 높이에 맞춰 반경을 줄인다(최대 20).
  const radius = Math.max(2, Math.min(20, Math.floor(cropH / 4) - 1))
  return (
    `[0:v]split=2[base][sub];` +
    `[sub]crop=${cropW}:${cropH}:0:${cropY},boxblur=luma_radius=${radius}:luma_power=2[blur];` +
    `[base][blur]overlay=0:${cropY}[out]`
  )
}

export interface SegmentCutInput {
  input: string
  offsetSec: number
  cutSec: number
  /** buildSubtitleBlurFilter 결과. null이면 블러 생략 */
  blurFilter: string | null
  outPath: string
}

/**
 * 소스 세그먼트 컷 ffmpeg 인자(순수 함수).
 * 원본 해상도를 유지한다 — 스케일/패딩은 렌더 단계(크롭-필)가 담당하므로 여기서 하면 레터박스가 생긴다.
 * 오디오는 렌더가 어차피 싣지 않지만 -an으로 중간 산출물에서도 제거한다.
 */
export function buildSegmentCutArgs(input: SegmentCutInput): string[] {
  const filterArgs = input.blurFilter
    ? ['-filter_complex', input.blurFilter, '-map', '[out]']
    : []
  return [
    '-y',
    '-ss',
    String(input.offsetSec),
    '-i',
    input.input,
    '-t',
    String(input.cutSec),
    ...filterArgs,
    '-an',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-movflags',
    '+faststart',
    input.outPath,
  ]
}
