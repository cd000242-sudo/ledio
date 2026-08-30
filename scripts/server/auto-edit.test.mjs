import { describe, expect, it, vi } from 'vitest'
import {
  analyzeForAutoEdit,
  applySelectedCuts,
  autoEditPaths,
  describeCandidates,
  formatClock,
  readAutoEditProgress,
} from './auto-edit.mjs'
import * as autoCut from '../../dist/edit/autoCut.js'
import { reformatSubtitles } from '../../dist/subtitles/reformat.js'

const subtitles = { reformatSubtitles }

describe('결과 경로', () => {
  it('원본 옆에 편집본을 만든다', () => {
    const paths = autoEditPaths('C:/영상/강의.mp4')
    expect(paths.edited.endsWith('강의_편집.mp4')).toBe(true)
    expect(paths.keepJson).toContain('.cuts-강의.json')
  })
})

describe('시간 표기', () => {
  it('분:초.1 형식으로 보여준다', () => {
    expect(formatClock(0)).toBe('00:00.0')
    expect(formatClock(8543)).toBe('00:08.5')
    expect(formatClock(125300)).toBe('02:05.3')
  })
})

describe('후보 다듬기', () => {
  it('화면에 필요한 정보(시간·길이·이유)를 붙인다', () => {
    const described = describeCandidates([
      { startMs: 8540, endMs: 8960, text: '', reason: 'silence', label: '무음 0.4초', suggested: true },
    ])
    expect(described[0]).toMatchObject({ id: 'c-0', seconds: 0.4, reason: 'silence', suggested: true })
    expect(described[0].time).toBe('00:08.5 – 00:09.0')
  })
})

describe('분석 단계', () => {
  const words = [
    { startMs: 0, endMs: 900, text: '안녕하세요' },
    { startMs: 950, endMs: 2000, text: '쿠키입니다.' },
    { startMs: 2100, endMs: 2600, text: '어 그러니까' },
    { startMs: 5000, endMs: 7000, text: '오늘은 자막 이야기를 하려고 합니다.' },
  ]

  it('받아쓰기 → 문장 묶기 → 후보 고르기까지 한 번에 한다', async () => {
    const result = await analyzeForAutoEdit('C:/영상/a.mp4', {
      transcribe: async () => words,
      subtitles,
      autoCut,
    })
    expect(result.ok).toBe(true)
    expect(result.wordCount).toBe(4)
    expect(result.candidates.length).toBeGreaterThan(0)
    expect(result.totalMs).toBe(7000)
  })

  it('받아쓴 게 없으면 이유를 알려준다', async () => {
    const result = await analyzeForAutoEdit('C:/영상/a.mp4', { transcribe: async () => [], subtitles, autoCut })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('음성이 있는 영상인지')
  })
})

describe('컷 적용', () => {
  const selected = [{ startMs: 2000, endMs: 3000, text: '', reason: 'silence', label: '', suggested: true }]

  it('남길 구간을 파일로 넘기고 CLI를 부른다', async () => {
    const writes = new Map()
    const runCommand = vi.fn(async () => ({ ok: true, outPath: 'C:/영상/a_편집.mp4' }))
    const result = await applySelectedCuts('C:/영상/a.mp4', selected, 10000, {
      autoCut,
      writeFile: async (path, text) => writes.set(path, text),
      runCommand,
    })

    expect(result.ok).toBe(true)
    expect(result.removedMs).toBe(1000)
    expect(result.pieces).toBe(2)
    const keep = JSON.parse([...writes.values()][0])
    expect(keep).toEqual([
      { startMs: 0, endMs: 2000 },
      { startMs: 3000, endMs: 10000 },
    ])
    expect(runCommand.mock.calls[0][0]).toContain('apply-cuts')
  })

  it('아무것도 안 골랐으면 실행하지 않는다', async () => {
    const runCommand = vi.fn()
    const result = await applySelectedCuts('C:/영상/a.mp4', [], 10000, { autoCut, writeFile: vi.fn(), runCommand })
    expect(result.ok).toBe(false)
    expect(runCommand).not.toHaveBeenCalled()
  })

  it('전부 잘라 남는 게 없으면 막는다', async () => {
    const result = await applySelectedCuts(
      'C:/영상/a.mp4',
      [{ startMs: 0, endMs: 10000, text: '', reason: 'silence', label: '', suggested: true }],
      10000,
      { autoCut, writeFile: vi.fn(), runCommand: vi.fn() },
    )
    expect(result.ok).toBe(false)
    expect(result.error).toContain('남는 영상이 없습니다')
  })
})


describe('다시 찍은 부분', () => {
  it('남길 쪽(뒤 테이크)까지 화면에 넘긴다 — 앞뒤를 나란히 보여줘야 한다', () => {
    const [shaped] = describeCandidates([
      {
        startMs: 0,
        endMs: 4000,
        text: '앞 테이크',
        reason: 'retake',
        label: '다시 찍음',
        suggested: true,
        keep: { startMs: 5100, endMs: 9000, text: '뒤 테이크' },
      },
    ])
    expect(shaped.reason).toBe('retake')
    expect(shaped.keep).toEqual({ startMs: 5100, endMs: 9000, text: '뒤 테이크' })
    expect(shaped.keepTime).toBe('00:05.1 – 00:09.0')
  })

  it('다시 찍은 게 아니면 남길 쪽이 없다', () => {
    const [shaped] = describeCandidates([
      { startMs: 0, endMs: 1000, text: '', reason: 'silence', label: '무음', suggested: true },
    ])
    expect(shaped.keep).toBeUndefined()
  })
})


describe('진행 상황 읽기', () => {
  it('파이썬이 적어 둔 퍼센트를 그대로 돌려준다', async () => {
    const readFile = async () => JSON.stringify({ stage: 'transcribe', percent: 42.5 })
    const progress = await readAutoEditProgress('C:/영상/a.mp4', { readFile })
    expect(progress).toEqual({ ok: true, stage: 'transcribe', percent: 42.5 })
  })

  it('아직 파일이 없으면 준비 중으로 알린다 — 실패가 아니다', async () => {
    const readFile = async () => {
      throw Object.assign(new Error('없음'), { code: 'ENOENT' })
    }
    expect(await readAutoEditProgress('C:/영상/a.mp4', { readFile })).toEqual({ ok: true, stage: 'starting', percent: 0 })
  })

  it('반쯤 쓰인 파일을 읽어도 터지지 않는다', async () => {
    const readFile = async () => '{"stage":'
    expect(await readAutoEditProgress('C:/영상/a.mp4', { readFile })).toEqual({ ok: true, stage: 'starting', percent: 0 })
  })

  it('퍼센트는 0~100 밖으로 나가지 않는다', async () => {
    const readFile = async () => JSON.stringify({ stage: 'align', percent: 140 })
    expect((await readAutoEditProgress('C:/영상/a.mp4', { readFile })).percent).toBe(100)
  })
})
