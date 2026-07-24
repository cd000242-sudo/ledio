import { describe, expect, it } from 'vitest'
import {
  buildSegmentCutArgs,
  buildSubtitleBlurFilter,
  planRemixSegments,
  remixPlanSchema,
} from './remixPlan.js'

const sources = [
  { file: 'clips/a.mp4', frame: 'frames/a.png', description: '제품 사용 장면', durationSec: 10, width: 1080, height: 1920, subtitleBand: null },
  { file: 'clips/b.mp4', frame: 'frames/b.png', description: '요리 장면', durationSec: 4, width: 1920, height: 1080, subtitleBand: { top: 0.8, bottom: 0.95 } },
]

describe('remixPlanSchema', () => {
  it('필수 필드를 검증하고 기본값을 채운다', () => {
    const plan = remixPlanSchema.parse({
      projectName: 'remix-1',
      sentences: ['첫 문장입니다.', '둘째 문장입니다.'],
      sources,
      assignments: [0, 1],
    })
    expect(plan.ratio).toBe('9:16')
    expect(plan.sources[1]?.subtitleBand?.top).toBeCloseTo(0.8)
  })

  it('assignments 길이가 sentences와 다르면 거부한다', () => {
    expect(() =>
      remixPlanSchema.parse({
        projectName: 'remix-1',
        sentences: ['하나', '둘'],
        sources,
        assignments: [0],
      }),
    ).toThrow()
  })
})

describe('planRemixSegments', () => {
  it('같은 소스가 여러 문장에 배정되면 구간이 겹치지 않는다', () => {
    const segments = planRemixSegments(sources, [0, 0, 0], [3, 3, 3])
    expect(segments[0]).toMatchObject({ sourceIndex: 0, offsetSec: 0, cutSec: 3 })
    expect(segments[1]?.offsetSec).toBeCloseTo(3)
    expect(segments[2]?.offsetSec).toBeCloseTo(6)
  })

  it('소스가 부족하면 처음으로 랩된다', () => {
    // b(4초)에 3초 장면 2개 — 첫 세그먼트 후 남은 1초는 0.5초 이상이라 이어 쓰고, 그다음 랩
    const segments = planRemixSegments(sources, [1, 1, 1], [3, 3, 3])
    expect(segments[0]).toMatchObject({ sourceIndex: 1, offsetSec: 0, cutSec: 3 })
    expect(segments[1]?.offsetSec).toBeCloseTo(3)
    expect(segments[1]?.cutSec).toBeCloseTo(1)
    expect(segments[2]?.offsetSec).toBe(0)
    expect(segments[2]?.cutSec).toBeCloseTo(3)
  })

  it('장면 길이가 소스 전체보다 길면 소스 전체를 쓴다(부족분은 렌더 루프가 채움)', () => {
    const segments = planRemixSegments(sources, [1], [9])
    expect(segments[0]?.offsetSec).toBe(0)
    expect(segments[0]?.cutSec).toBeCloseTo(4)
  })
})

describe('buildSubtitleBlurFilter', () => {
  it('밴드 비율을 짝수 픽셀로 바꿔 crop/blur/overlay 체인을 만든다', () => {
    const filter = buildSubtitleBlurFilter(1920, 1080, { top: 0.8, bottom: 0.95 })
    expect(filter).toContain('split=2[base][sub]')
    expect(filter).toContain('boxblur=')
    // top: 1080*0.8 = 864(짝수), height: 1080*0.15 = 162 → 짝수 내림 162
    expect(filter).toContain('crop=1920:162:0:864')
    expect(filter).toContain('overlay=0:864[out]')
  })

  it('홀수 해상도도 짝수로 보정한다', () => {
    const filter = buildSubtitleBlurFilter(1919, 1079, { top: 0.5, bottom: 0.6 })
    const match = /crop=(\d+):(\d+):0:(\d+)/.exec(filter)
    expect(match).not.toBeNull()
    for (const value of match!.slice(1)) {
      expect(Number(value) % 2).toBe(0)
    }
  })

  it('밴드가 없거나 역전이면 null', () => {
    expect(buildSubtitleBlurFilter(1080, 1920, null)).toBeNull()
    expect(buildSubtitleBlurFilter(1080, 1920, { top: 0.9, bottom: 0.5 })).toBeNull()
  })

  it('좁은 밴드에서는 blur 반경을 크로마 한계(밴드높이/4 미만)에 맞춘다', () => {
    // 360p 가로 영상, 밴드 높이 62px → 반경은 14 이하(크로마 평면 31px의 절반 미만)
    const filter = buildSubtitleBlurFilter(640, 360, { top: 0.78, bottom: 0.95 })
    const match = /boxblur=luma_radius=(\d+)/.exec(filter ?? '')
    expect(match).not.toBeNull()
    expect(Number(match![1])).toBeLessThan(15)
    expect(Number(match![1])).toBeGreaterThanOrEqual(2)
  })
})

describe('buildSegmentCutArgs', () => {
  it('블러 없는 컷: 트림 + 오디오 제거만, 스케일/패딩 없음', () => {
    const args = buildSegmentCutArgs({
      input: 'clips/a.mp4',
      offsetSec: 3,
      cutSec: 2.5,
      blurFilter: null,
      outPath: 'motion/scene_01.mp4',
    })
    const joined = args.join(' ')
    expect(args).toContain('-ss')
    expect(args[args.indexOf('-ss') + 1]).toBe('3')
    expect(args[args.indexOf('-t') + 1]).toBe('2.5')
    expect(args).toContain('-an')
    expect(joined).not.toContain('scale=')
    expect(joined).not.toContain('pad=')
    expect(args.at(-1)).toBe('motion/scene_01.mp4')
  })

  it('블러가 있으면 filter_complex와 [out] 매핑을 쓴다', () => {
    const filter = buildSubtitleBlurFilter(1920, 1080, { top: 0.8, bottom: 0.95 })
    const args = buildSegmentCutArgs({
      input: 'clips/b.mp4',
      offsetSec: 0,
      cutSec: 3,
      blurFilter: filter,
      outPath: 'motion/scene_02.mp4',
    })
    expect(args).toContain('-filter_complex')
    expect(args).toContain('[out]')
    expect(args).toContain('-an')
  })
})
