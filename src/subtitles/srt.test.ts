import { describe, it, expect } from 'vitest'
import { parseSrt, serializeSrt, parseTimestamp, formatTimestamp, type Cue } from './srt.js'

describe('timestamp', () => {
  it('파싱한다', () => {
    expect(parseTimestamp('00:00:02,500')).toBe(2500)
    expect(parseTimestamp('01:02:03,004')).toBe(3_723_004)
  })

  it('포맷한다', () => {
    expect(formatTimestamp(2500)).toBe('00:00:02,500')
    expect(formatTimestamp(3_723_004)).toBe('01:02:03,004')
  })

  it('파싱-포맷 왕복', () => {
    expect(formatTimestamp(parseTimestamp('00:10:33,123'))).toBe('00:10:33,123')
  })

  it('점 구분자도 허용', () => {
    expect(parseTimestamp('00:00:01.250')).toBe(1250)
  })
})

describe('parseSrt / serializeSrt', () => {
  const srt = `1
00:00:00,000 --> 00:00:02,500
안녕하세요 김요한

2
00:00:02,500 --> 00:00:05,000
자동화입니다`

  it('큐를 파싱한다', () => {
    const cues = parseSrt(srt)
    expect(cues).toHaveLength(2)
    expect(cues[0]).toEqual<Cue>({ startMs: 0, endMs: 2500, text: '안녕하세요 김요한' })
    expect(cues[1]?.text).toBe('자동화입니다')
  })

  it('인덱스 줄이 없어도 파싱한다', () => {
    const cues = parseSrt('00:00:00,000 --> 00:00:01,000\n테스트')
    expect(cues).toHaveLength(1)
    expect(cues[0]?.text).toBe('테스트')
  })

  it('직렬화 후 다시 파싱하면 동일하다', () => {
    const cues = parseSrt(srt)
    expect(parseSrt(serializeSrt(cues))).toEqual(cues)
  })

  it('여러 줄 텍스트는 한 줄로 합친다', () => {
    const cues = parseSrt('1\n00:00:00,000 --> 00:00:01,000\n첫줄\n둘째줄')
    expect(cues[0]?.text).toBe('첫줄 둘째줄')
  })
})
