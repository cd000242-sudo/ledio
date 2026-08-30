import { describe, expect, it, vi } from 'vitest'
import { buildEraseArgs, eraseSubtitles, erasePaths, estimateSeconds, parseDetectedBox } from './subtitle-erase.mjs'

describe('결과 경로', () => {
  it('원본 옆에 두고 미리보기는 따로 표시한다', () => {
    expect(erasePaths('C:/영상/a.mp4').out.endsWith('a_자막지움.mp4')).toBe(true)
    expect(erasePaths('C:/영상/a.mp4', true).out.endsWith('a_자막지움_미리보기.mp4')).toBe(true)
  })
})

describe('파이썬 인자', () => {
  const base = { scriptPath: 's.py', mediaPath: 'a.mp4', outPath: 'o.mp4', tempPath: 't.mp4' }

  it('영역은 기본 auto, 방식은 기본 배경복원', () => {
    const args = buildEraseArgs(base)
    expect(args[args.indexOf('--box') + 1]).toBe('auto')
    expect(args[args.indexOf('--mode') + 1]).toBe('background')
  })

  it('모르는 방식은 배경복원으로 물러선다', () => {
    expect(buildEraseArgs({ ...base, mode: '이상한값' })[buildEraseArgs(base).indexOf('--mode') + 1]).toBe('background')
  })

  it('지울 대상은 기본이 자막', () => {
    expect(buildEraseArgs(base)[buildEraseArgs(base).indexOf('--target') + 1]).toBe('subtitle')
  })

  it('워터마크·둘 다도 넘긴다 — 모르는 값은 자막으로 물러선다', () => {
    expect(buildEraseArgs({ ...base, target: 'watermark' })[buildEraseArgs(base).indexOf('--target') + 1]).toBe(
      'watermark',
    )
    expect(buildEraseArgs({ ...base, target: 'both' })[buildEraseArgs(base).indexOf('--target') + 1]).toBe('both')
    expect(buildEraseArgs({ ...base, target: '이상한값' })[buildEraseArgs(base).indexOf('--target') + 1]).toBe(
      'subtitle',
    )
  })

  it('직접 지정한 영역과 구간을 넘긴다', () => {
    const args = buildEraseArgs({ ...base, box: '10,20,30,40', startSec: 5, durationSec: 3 })
    expect(args[args.indexOf('--box') + 1]).toBe('10,20,30,40')
    expect(args[args.indexOf('--start') + 1]).toBe('5')
    expect(args[args.indexOf('--duration') + 1]).toBe('3')
  })
})

describe('지울 글자를 못 찾은 경우', () => {
  it('원본 그대로라고 알려 준다 — 실패가 아니다', async () => {
    const runPython = vi.fn(async () => ({ ok: true, stderr: 'note: 지울 글자를 찾지 못했습니다.' }))
    const result = await eraseSubtitles('C:/영상/a.mp4', { runPython, scriptPath: 's.py' }, { preview: false })
    expect(result.ok).toBe(true)
    expect(result.foundNothing).toBe(true)
  })
})

describe('자동 감지 결과 읽기', () => {
  it('파이썬이 알려준 영역을 파싱한다', () => {
    expect(parseDetectedBox('detected box=267,564,746,69\nframes=150')).toEqual({ x: 267, y: 564, w: 746, h: 69 })
    expect(parseDetectedBox('아무 말')).toBeNull()
  })
})

describe('예상 시간', () => {
  it('방식에 따라 다르게 어림잡는다', () => {
    expect(estimateSeconds(200, 'blur')).toBeLessThan(estimateSeconds(200, 'background'))
    expect(estimateSeconds(1)).toBeGreaterThanOrEqual(3)
  })
})

describe('실행', () => {
  it('미리보기는 기본 3초만 처리한다 — 전체는 오래 걸린다', async () => {
    const runPython = vi.fn(async () => ({ ok: true, stderr: 'detected box=1,2,3,4' }))
    const result = await eraseSubtitles('C:/영상/a.mp4', { runPython, scriptPath: 's.py' }, { preview: true })
    expect(result.ok).toBe(true)
    expect(result.preview).toBe(true)
    expect(result.detectedBox).toEqual({ x: 1, y: 2, w: 3, h: 4 })
    const args = runPython.mock.calls[0][0]
    expect(args[args.indexOf('--duration') + 1]).toBe('3')
  })

  it('전체 처리는 길이 제한 없이 돌린다', async () => {
    const runPython = vi.fn(async () => ({ ok: true, stderr: '' }))
    await eraseSubtitles('C:/영상/a.mp4', { runPython, scriptPath: 's.py' }, { preview: false })
    expect(runPython.mock.calls[0][0]).not.toContain('--duration')
  })

  it('실패하면 이유를 그대로 전한다', async () => {
    const runPython = vi.fn(async () => ({ ok: false, error: 'opencv 없음' }))
    const result = await eraseSubtitles('C:/영상/a.mp4', { runPython, scriptPath: 's.py' }, {})
    expect(result).toEqual({ ok: false, error: 'opencv 없음' })
  })
})
