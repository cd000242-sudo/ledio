import { describe, expect, it } from 'vitest'
import { buildSceneCaptionCues, splitCaptionChunks } from './sceneCues.js'

describe('splitCaptionChunks', () => {
  it('12자 이하 문장은 그대로 한 조각', () => {
    expect(splitCaptionChunks('좁은 주방 정리 끝', 12)).toEqual(['좁은 주방 정리 끝'])
  })

  it('어절 경계를 지키며 최대 글자수로 쪼갠다', () => {
    const chunks = splitCaptionChunks('좁은 주방이 순식간에 넓어지는 마법의 선반입니다', 12)
    for (const chunk of chunks) {
      expect([...chunk].length).toBeLessThanOrEqual(12)
    }
    expect(chunks.join(' ')).toBe('좁은 주방이 순식간에 넓어지는 마법의 선반입니다')
  })

  it('띄어쓰기 없는 긴 단어는 강제 분할한다', () => {
    const chunks = splitCaptionChunks('가나다라마바사아자차카타파하거너더러', 12)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect([...chunk].length).toBeLessThanOrEqual(12)
    }
  })

  it('문장부호에서 먼저 끊는다', () => {
    const chunks = splitCaptionChunks('진짜 편해요! 지금 확인하세요.', 12)
    expect(chunks).toEqual(['진짜 편해요!', '지금 확인하세요.'])
  })

  it('빈 입력은 빈 배열', () => {
    expect(splitCaptionChunks('', 12)).toEqual([])
    expect(splitCaptionChunks('   ', 12)).toEqual([])
  })
})

describe('buildSceneCaptionCues', () => {
  it('장면별 클립-로컬 cue를 만들고 마지막 cue는 장면 길이에 스냅된다', () => {
    const [cues] = buildSceneCaptionCues(
      [{ caption: '좁은 주방이 순식간에 넓어지는 마법의 선반', durationSec: 4.2 }],
      { maxChars: 12 },
    )
    expect(cues!.length).toBeGreaterThan(1)
    expect(cues![0]!.start).toBe(0)
    expect(cues!.at(-1)!.end).toBeCloseTo(4.2, 3)
    // cue들이 빈틈 없이 이어진다
    for (let i = 1; i < cues!.length; i++) {
      expect(cues![i]!.start).toBeCloseTo(cues![i - 1]!.end, 3)
    }
  })

  it('글자수가 많은 조각이 더 긴 시간을 받는다', () => {
    const [cues] = buildSceneCaptionCues(
      [{ caption: '와! 이 제품은 정말로 놀라운 수납력을 보여줍니다', durationSec: 6 }],
      { maxChars: 12 },
    )
    const short = cues!.find((cue) => cue.text === '와!')
    const longest = [...cues!].sort((a, b) => [...b.text].length - [...a.text].length)[0]
    if (short && longest && short !== longest) {
      expect(longest.end - longest.start).toBeGreaterThan(short.end - short.start)
    }
  })

  it('cue 최소 길이(minCueSec)가 보장된다', () => {
    const [cues] = buildSceneCaptionCues(
      [{ caption: '와! 지금 바로 확인해 보세요 놓치면 후회합니다', durationSec: 5 }],
      { maxChars: 12, minCueSec: 0.5 },
    )
    for (const cue of cues!) {
      expect(cue.end - cue.start).toBeGreaterThanOrEqual(0.5 - 1e-9)
    }
  })

  it('장면 길이가 짧으면 최소 길이를 비례 축소해도 전체 합은 장면 길이와 같다', () => {
    const [cues] = buildSceneCaptionCues(
      [{ caption: '하나 둘 셋 넷 다섯 여섯 일곱 여덟', durationSec: 1 }],
      { maxChars: 3, minCueSec: 0.5 },
    )
    expect(cues!.at(-1)!.end).toBeCloseTo(1, 3)
  })

  it('caption이 없으면 narration을 쓰고, 둘 다 없으면 빈 cue 배열', () => {
    const result = buildSceneCaptionCues(
      [
        { narration: '나레이션 문장입니다', durationSec: 3 },
        { durationSec: 2 },
      ],
      { maxChars: 12 },
    )
    expect(result[0]!.length).toBeGreaterThan(0)
    expect(result[1]).toEqual([])
  })
})
