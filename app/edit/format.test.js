import { describe, expect, it } from 'vitest'
import {
  clean,
  formatTags,
  intValue,
  isValidUrl,
  numberValue,
  pad2,
  parseTags,
  safeFileName,
  trimLine,
  unique,
} from './format.js'

describe('문자열·숫자 다듬기', () => {
  it('clean은 앞뒤 공백을 없애고 빈 값을 빈 문자열로 만든다', () => {
    expect(clean('  안녕  ')).toBe('안녕')
    expect(clean(null)).toBe('')
    expect(clean(undefined)).toBe('')
  })

  it('numberValue는 숫자가 아니면 NaN을 준다', () => {
    expect(numberValue('12.5')).toBe(12.5)
    expect(Number.isNaN(numberValue('열두개'))).toBe(true)
  })

  it('intValue는 실패하면 넘긴 기본값으로 물러선다', () => {
    expect(intValue('7')).toBe(7)
    expect(intValue('abc', 3)).toBe(3)
    expect(intValue('', 1)).toBe(1)
  })

  it('unique는 순서를 지키며 중복만 없앤다', () => {
    expect(unique(['a', 'b', 'a', 'c', 'b'])).toEqual(['a', 'b', 'c'])
  })
})

describe('링크 검사', () => {
  it('http·https만 통과시킨다', () => {
    expect(isValidUrl('https://example.com/item')).toBe(true)
    expect(isValidUrl('http://example.com')).toBe(true)
    expect(isValidUrl('ftp://example.com')).toBe(false)
    expect(isValidUrl('그냥 텍스트')).toBe(false)
    expect(isValidUrl('')).toBe(false)
  })
})

describe('해시태그', () => {
  it('쉼표·공백 어느 쪽으로 적어도 읽는다', () => {
    expect(parseTags('쇼츠, 쿠팡  자동화')).toEqual(['쇼츠', '쿠팡', '자동화'])
    expect(parseTags(['#쇼츠', '쿠팡'])).toEqual(['쇼츠', '쿠팡'])
  })

  it('#은 한 번만 붙는다', () => {
    expect(formatTags('#쇼츠, 쿠팡')).toBe('#쇼츠 #쿠팡')
  })

  it('빈 값은 빈 결과', () => {
    expect(parseTags('')).toEqual([])
    expect(formatTags(null)).toBe('')
  })
})

describe('길이 자르기', () => {
  it('길면 말줄임표를 붙인다', () => {
    // 상한에서 한 칸을 말줄임표에 내준다: 6자 상한 → 5자 + …
    expect(trimLine('안녕하세요 반갑습니다', 6)).toBe('안녕하세요…')
    expect(trimLine('안녕하세요 반갑습니다', 8)).toBe('안녕하세요 반…')
  })

  it('짧으면 그대로 두고, 줄바꿈·연속 공백은 한 칸으로 정리한다', () => {
    expect(trimLine('짧은 글', 20)).toBe('짧은 글')
    expect(trimLine('여러   줄\n글자', 20)).toBe('여러 줄 글자')
  })
})

describe('파일명 안전하게 만들기', () => {
  it('윈도우에서 못 쓰는 문자를 바꾼다', () => {
    expect(safeFileName('영상<>:"/\\|?*.mp4')).toBe('영상-.mp4')
  })

  it('숨김파일이 되는 앞 점을 없애고, 비면 기본값을 쓴다', () => {
    expect(safeFileName('...비밀')).toBe('비밀')
    expect(safeFileName('')).toBe('media')
    expect(safeFileName('   ', 'clip')).toBe('clip')
  })

  it('아주 긴 이름은 잘라 준다', () => {
    expect(safeFileName('가'.repeat(300)).length).toBeLessThanOrEqual(120)
  })
})

describe('두 자리 맞추기', () => {
  it('시간 표시에 쓰는 0 채우기', () => {
    expect(pad2(3)).toBe('03')
    expect(pad2(12)).toBe('12')
  })
})
