import { describe, expect, it } from 'vitest'
import { buildConcatArgs, buildConcatList, buildSegmentArgs } from './applyCuts.js'

describe('구간 잘라내기 인자', () => {
  it('-ss를 -i 뒤에 둬서 정확히 자른다', () => {
    const args = buildSegmentArgs('C:/영상/a.mp4', { startMs: 4200, endMs: 11800 }, 'C:/out/part.mp4')
    expect(args.indexOf('-ss')).toBeGreaterThan(args.indexOf('-i'))
    expect(args[args.indexOf('-ss') + 1]).toBe('4.200')
    expect(args[args.indexOf('-t') + 1]).toBe('7.600')
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
