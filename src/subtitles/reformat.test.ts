import { describe, it, expect } from 'vitest'
import { reformatSubtitles, splitSentence, wordGapThreshold } from './reformat.js'
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

describe('호흡에 맞춘 자막 나누기', () => {
  /** 단어 큐를 만든다 — gapMs는 앞 단어와의 사이. */
  const words = (items: { text: string; gapMs?: number }[]) => {
    const cues = []
    let clock = 0
    for (const item of items) {
      clock += item.gapMs ?? 100
      cues.push({ startMs: clock, endMs: clock + 400, text: item.text })
      clock += 400
    }
    return cues
  }

  it('한 자막에 두 문장을 담지 않는다', () => {
    const cues = reformatSubtitles(
      words([
        { text: '혼자' }, { text: '살' }, { text: '집이니까요.' },
        { text: '엄청' }, { text: '좋은' }, { text: '집을' }, { text: '바랐어요.' },
      ]),
      { minChars: 18, maxChars: 44 },
    )
    // 짧은 앞 문장이 뒤 문장과 한 줄에 섞이면 안 된다(길이가 남아도 마찬가지)
    for (const cue of cues) expect((cue.text.match(/[.!?]/g) ?? []).length).toBeLessThanOrEqual(1)
  })

  it('말이 길게 쉬는 자리를 끊는 자리로 우선한다', () => {
    const cues = reformatSubtitles(
      words([
        { text: '그래서' }, { text: '급하게' }, { text: '방을' }, { text: '구했고' },
        { text: '집세가', gapMs: 900 }, { text: '유난히' }, { text: '싸길래' }, { text: '계약했습니다.' },
      ]),
      { minChars: 10, maxChars: 30 },
    )
    expect(cues[0].text).toBe('그래서 급하게 방을 구했고')
  })

  it('길이 때문에 나눌 때 조각을 고르게 맞춘다 — 뒤에 한 단어만 남기지 않는다', () => {
    const sentence = words([
      { text: '그냥' }, { text: '삑' }, { text: '하는' }, { text: '소리만' },
      { text: '나도' }, { text: '심장이' }, { text: '먼저' }, { text: '내려앉아요.' },
    ])
    const pieces = splitSentence(sentence, 26, 5000)
    expect(pieces.length).toBe(2)
    const lengths = pieces.map((piece) => [...piece.text].length)
    // 21/6 처럼 한쪽이 토막나면 안 된다
    expect(Math.min(...lengths)).toBeGreaterThanOrEqual(9)
  })

  it('시각은 원본 큐에서 그대로 가져온다 — 싱크가 밀리면 안 된다', () => {
    const source = words([{ text: '첫' }, { text: '문장입니다.' }, { text: '둘째', gapMs: 800 }, { text: '문장입니다.' }])
    const cues = reformatSubtitles(source, { minChars: 5, maxChars: 20 })
    expect(cues[0].startMs).toBe(source[0].startMs)
    expect(cues.at(-1)?.endMs).toBe(source.at(-1)?.endMs)
  })

  it('쉼 기준은 화자의 분포에서 뽑고 최소값 아래로 내려가지 않는다', () => {
    const fast = words([{ text: 'a' }, { text: 'b' }, { text: 'c' }])
    expect(wordGapThreshold(fast, 0.8, 350)).toBe(350)
  })
})
