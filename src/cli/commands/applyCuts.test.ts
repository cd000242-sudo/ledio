import { describe, expect, it } from 'vitest'
import { buildConcatArgs, buildConcatList, buildSegmentArgs } from './applyCuts.js'

describe('구간 잘라내기 인자', () => {
  it('-ss를 -i 뒤에 둬서 정확히 자른다', () => {
    const args = buildSegmentArgs('C:/영상/a.mp4', { startMs: 4200, endMs: 11800 }, 'C:/out/part.mp4')
    expect(args.indexOf('-ss')).toBeGreaterThan(args.indexOf('-i'))
    expect(args[args.indexOf('-ss') + 1]).toBe('4.200')
    expect(args[args.indexOf('-t') + 1]).toBe('7.600')
  })

  it('자른 자리에서 소리를 짧게 여닫는다 — 그냥 붙이면 뚝 끊겨 들린다', () => {
    const args = buildSegmentArgs('C:/영상/a.mp4', { startMs: 0, endMs: 10000 }, 'C:/out/part.mp4')
    const filter = args[args.indexOf('-af') + 1]
    expect(filter).toContain('afade=t=in:st=0.000:d=0.060')
    expect(filter).toContain('afade=t=out:st=9.940:d=0.060')
  })

  it('여닫는 시각은 **원본 영상 기준**이다 — 조각 기준으로 적으면 뒤 조각이 통째로 무음이 된다', () => {
    const args = buildSegmentArgs('C:/영상/a.mp4', { startMs: 8000, endMs: 11000 }, 'C:/out/part.mp4')
    const filter = args[args.indexOf('-af') + 1]
    expect(filter).toContain('afade=t=in:st=8.000:d=0.060')
    expect(filter).toContain('afade=t=out:st=10.940:d=0.060')
  })

  it('여닫기를 끄면 소리 필터를 넣지 않는다', () => {
    const args = buildSegmentArgs('C:/영상/a.mp4', { startMs: 0, endMs: 10000 }, 'C:/out/part.mp4', { fadeMs: 0 })
    expect(args).not.toContain('-af')
  })

  it('구간보다 긴 여닫기는 구간에 맞춰 줄인다 — 짧은 조각이 통째로 페이드되면 안 된다', () => {
    const args = buildSegmentArgs('C:/영상/a.mp4', { startMs: 0, endMs: 200 }, 'C:/out/part.mp4', { fadeMs: 300 })
    const filter = args[args.indexOf('-af') + 1]
    expect(filter).toContain('d=0.050')
  })

  it('이어 붙이기는 재인코딩하지 않는다', () => {
    const args = buildConcatArgs('C:/out/concat.txt', 'C:/out/final.mp4')
    expect(args[args.indexOf('-c') + 1]).toBe('copy')
    expect(args).toContain('concat')
  })
})

describe('concat 목록', () => {
  it('경로를 슬래시로 통일하고 작은따옴표를 이스케이프한다', () => {
    const list = buildConcatList(['C:\\out\\a.mp4', "C:/out/b's.mp4"])
    expect(list).toContain("file 'C:/out/a.mp4'")
    expect(list).toContain("b'\\''s.mp4")
  })
})
