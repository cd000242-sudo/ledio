import { describe, it, expect } from 'vitest'
import { reformatSubtitles } from './reformat.js'
import type { Cue } from './srt.js'

/** 단어 단위의 세밀한 큐를 만든다(각 200ms). */
function wordCues(words: string[]): Cue[] {
  return words.map((text, i) => ({ startMs: i * 200, endMs: (i + 1) * 200, text }))
}

describe('reformatSubtitles', () => {
  it('짧은 단어들을 한 큐로 합친다', () => {
    const out = reformatSubtitles(wordCues(['좁은', '주방', '쓰는', '사람']), { maxChars: 44 })
    expect(out).toHaveLength(1)
    expect(out[0]?.text).toBe('좁은 주방 쓰는 사람')
  })

  it('어떤 큐도 줄바꿈을 포함하지 않는다', () => {
    const out = reformatSubtitles(wordCues(['가나다', '라마바', '사아자', '차카타', '파하가']))
    for (const c of out) expect(c.text).not.toContain('\n')
  })

  it('maxChars 하드 상한을 넘지 않는다', () => {
    const words = Array.from({ length: 20 }, () => '단어') // 각 2자
    const out = reformatSubtitles(wordCues(words), { maxChars: 10 })
    for (const c of out) expect([...c.text].length).toBeLessThanOrEqual(10)
    expect(out.length).toBeGreaterThan(1)
  })

  it('시작/끝 시간을 원본에서 가져와 싱크를 유지한다', () => {
    const out = reformatSubtitles(wordCues(['하나', '둘', '셋', '넷']), { maxChars: 44 })
    expect(out[0]?.startMs).toBe(0) // 첫 단어 시작
    expect(out[0]?.endMs).toBe(800) // 넷째 단어 끝(4*200)
  })

  it('문장 끝(.)에서 의미 단위로 끊는다', () => {
    const cues: Cue[] = [
      { startMs: 0, endMs: 200, text: '안녕하세요 반갑습니다.' },
      { startMs: 200, endMs: 400, text: '오늘은 자막 자동화를 합니다' },
    ]
    const out = reformatSubtitles(cues, { minChars: 5, maxChars: 44 })
    expect(out).toHaveLength(2)
    expect(out[0]?.text).toBe('안녕하세요 반갑습니다.')
  })

  it('빈 큐는 건너뛴다', () => {
    const out = reformatSubtitles(wordCues(['', '주방', '']), { maxChars: 44 })
    expect(out[0]?.text).toBe('주방')
  })
})
