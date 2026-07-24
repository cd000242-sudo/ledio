import { describe, expect, it } from 'vitest'
import {
  buildFrameExtractArgs,
  buildProbeArgs,
  buildRemixPlan,
  parseProbeOutput,
} from './source-remix.mjs'

describe('probe helpers', () => {
  it('ffprobe 인자와 JSON 파싱', () => {
    expect(buildProbeArgs('a.mp4')).toContain('-show_streams')
    const info = parseProbeOutput(
      JSON.stringify({
        format: { duration: '12.5' },
        streams: [
          { codec_type: 'audio' },
          { codec_type: 'video', width: 1920, height: 1080 },
        ],
      }),
    )
    expect(info).toEqual({ durationSec: 12.5, width: 1920, height: 1080 })
  })

  it('영상 스트림이 없거나 깨진 JSON이면 null', () => {
    expect(parseProbeOutput(JSON.stringify({ streams: [{ codec_type: 'audio' }] }))).toBeNull()
    expect(parseProbeOutput('깨짐')).toBeNull()
  })
})

describe('buildFrameExtractArgs', () => {
  it('중간 지점 1프레임을 720px 캡으로 뽑는다', () => {
    const args = buildFrameExtractArgs('clips/a.mp4', 5.2, 'frames/frame_01.png')
    expect(args[args.indexOf('-ss') + 1]).toBe('5.2')
    expect(args).toContain('-frames:v')
    expect(args.join(' ')).toContain('min(720,iw)')
    expect(args.at(-1)).toBe('frames/frame_01.png')
  })
})

describe('buildRemixPlan', () => {
  it('plan.json 계약 형태로 조립한다', () => {
    const plan = buildRemixPlan({
      projectName: 'remix-1',
      title: '접이식 선반',
      sentences: ['하나.', '둘.'],
      sources: [{ file: 'clips/a.mp4', frame: 'frames/a.png', description: 'x', durationSec: 5, width: 1080, height: 1920, subtitleBand: null }],
      assignments: [0, 0],
      ratio: '세로',
      disclosure: '고지',
    })
    expect(plan.ratio).toBe('9:16')
    expect(plan.title).toBe('접이식 선반')
    expect(plan.disclosure).toBe('고지')
    expect(plan.assignments).toEqual([0, 0])
  })
})
