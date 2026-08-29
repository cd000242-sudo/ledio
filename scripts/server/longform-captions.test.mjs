import { describe, expect, it, vi } from 'vitest'
import { buildLongformOutputs, buildScriptFile, correctWithScript, outputPaths } from './longform-captions.mjs'
import { auditSubtitles, summarizeAudit } from '../../dist/subtitles/audit.js'
import { fillGaps } from '../../dist/subtitles/gaps.js'
import { reformatSubtitles } from '../../dist/subtitles/reformat.js'
import { parseSrt, serializeSrt } from '../../dist/subtitles/srt.js'
import * as correct from '../../dist/subtitles/correct.js'
import * as scriptModule from '../../dist/subtitles/script.js'

const subtitles = { reformatSubtitles, fillGaps, serializeSrt, auditSubtitles, summarizeAudit }

describe('결과 파일 경로', () => {
  it('원본 옆에 두고 이름은 노션 규칙을 따른다', () => {
    const paths = outputPaths('C:/영상/강의 1편.mp4')
    expect(paths.aligned.endsWith('강의 1편_정렬.srt')).toBe(true)
    expect(paths.filled.endsWith('강의 1편_정렬_공백메움.srt')).toBe(true)
    // 원본을 덮어쓰지 않는다
    expect(paths.aligned).not.toContain('.mp4')
  })
})

describe('대본 대조 보정', () => {
  const cues = Array.from({ length: 45 }, (_, index) => ({
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    text: `단어${index}`,
  }))

  it('배치별로 물어보고 시각은 원본을 지킨다', async () => {
    const askModel = vi.fn(async (prompt) => {
      const count = prompt.split('=== 고칠 자막 ===')[1].trim().split('\n').length
      return Array.from({ length: count }, (_, index) => `${index + 1}. 고침${index}`).join('\n')
    })
    const result = await correctWithScript(cues, '대본입니다', { askModel, correct })
    expect(askModel).toHaveBeenCalledTimes(2)
    expect(result.failedBatches).toBe(0)
    expect(result.cues[0].text).toBe('고침0')
    expect(result.cues.map((cue) => cue.startMs)).toEqual(cues.map((cue) => cue.startMs))
  })

  it('한 배치가 실패해도 나머지는 살리고 그 구간은 원본을 쓴다', async () => {
    let call = 0
    const askModel = vi.fn(async (prompt) => {
      call += 1
      if (call === 1) throw new Error('모델 호출 실패')
      const count = prompt.split('=== 고칠 자막 ===')[1].trim().split('\n').length
      return Array.from({ length: count }, (_, index) => `${index + 1}. 고침`).join('\n')
    })
    const result = await correctWithScript(cues, '대본', { askModel, correct })
    expect(result.failedBatches).toBe(1)
    expect(result.cues[0].text).toBe('단어0')
    expect(result.cues[40].text).toBe('고침')
  })

  it('진행 상황을 배치 단위로 알린다', async () => {
    const progress = []
    await correctWithScript(cues, '대본', { askModel: async () => '', correct }, (event) => progress.push(event))
    expect(progress).toEqual([
      { stage: 'correct', done: 0, total: 2 },
      { stage: 'correct', done: 1, total: 2 },
    ])
  })
})

describe('최종 산출물', () => {
  // 44자를 넘겨야 두 줄로 나뉜다 — 나뉘어야 자막 사이 공백이 생기고, 공백메움을 검증할 수 있다.
  const fine = [
    { startMs: 0, endMs: 600, text: '안녕하세요반갑습니다' },
    { startMs: 620, endMs: 1200, text: '기묘한자동화쿠키입니다' },
    { startMs: 1250, endMs: 1900, text: '오늘도찾아왔습니다' },
    { startMs: 3000, endMs: 3600, text: '오늘주제는자막입니다' },
    { startMs: 3650, endMs: 4300, text: '천천히설명드리겠습니다' },
    { startMs: 4350, endMs: 4900, text: '끝까지봐주세요' },
  ]

  it('파일 두 개를 쓰고 각각 검수한다', async () => {
    const written = new Map()
    const writeFile = vi.fn(async (path, content) => written.set(path, content))
    const result = await buildLongformOutputs(fine, 'C:/영상/lesson.mp4', { subtitles, writeFile })

    expect(writeFile).toHaveBeenCalledTimes(2)
    expect(written.has(result.files.aligned)).toBe(true)
    expect(written.has(result.files.filled)).toBe(true)
    expect(result.cueCount).toBeGreaterThan(0)

    // 정렬본에는 말 사이 공백이 남고, 공백메움본에는 없어야 한다
    expect(result.audit.filled.issues.some((issue) => issue.rule === 'gap')).toBe(false)
    expect(written.get(result.files.aligned)).toContain('-->')
  })

  it('공백메움본에는 자막 사이 빈 구간이 없고, 정렬본에는 남는다', async () => {
    const written = new Map()
    const result = await buildLongformOutputs(fine, 'C:/영상/lesson.mp4', {
      subtitles,
      writeFile: async (path, content) => written.set(path, content),
    })
    const alignedCues = parseSrt(written.get(result.files.aligned))
    const filledCues = parseSrt(written.get(result.files.filled))
    expect(alignedCues.length).toBeGreaterThan(1)
    // 시작 시각은 두 파일이 같아야 한다(공백메움은 끝만 늘린다)
    expect(filledCues.map((cue) => cue.startMs)).toEqual(alignedCues.map((cue) => cue.startMs))
    // 앞 자막의 끝이 다음 시작까지 늘어난다
    expect(filledCues[0].endMs).toBe(filledCues[1].startMs)
    expect(alignedCues[0].endMs).toBeLessThan(alignedCues[1].startMs)
  })
})

describe('음성으로 대본 만들기', () => {
  const cues = [
    { startMs: 0, endMs: 2000, text: '안녕하세요 쿠키입니다.' },
    { startMs: 2100, endMs: 4000, text: '오늘은 자막 이야기를 합니다.' },
    { startMs: 6000, endMs: 8000, text: '먼저 받아쓰기부터 보겠습니다.' },
  ]

  it('원본 옆에 대본 파일을 쓰고 문단을 나눈다', async () => {
    const written = new Map()
    const result = await buildScriptFile(cues, 'C:/영상/lesson.mp4', {
      script: scriptModule,
      writeFile: async (path, text) => written.set(path, text),
    })
    expect(result.path.endsWith('lesson_대본.txt')).toBe(true)
    expect(written.get(result.path)).toContain('\n\n')
    expect(result.polished).toBe(false)
  })

  it('다듬기를 켜면 모델을 부르고, 요약해버리면 원본을 지킨다', async () => {
    const written = new Map()
    const writeFile = async (path, text) => written.set(path, text)

    const good = await buildScriptFile(cues, 'C:/영상/a.mp4', {
      script: scriptModule,
      writeFile,
      // 실제 다듬기처럼 표기만 손본 결과(분량은 비슷하다)
      askModel: async () => '안녕하세요, 쿠키입니다. 오늘은 자막 이야기를 해보겠습니다.\n\n먼저 받아쓰기부터 보시죠.',
    }, { polish: true })
    expect(good.polished).toBe(true)

    const summarized = await buildScriptFile(cues, 'C:/영상/b.mp4', {
      script: scriptModule,
      writeFile,
      askModel: async () => '요약: 자막 이야기',
    }, { polish: true })
    expect(summarized.polished).toBe(false)
  })

  it('다듬기가 실패해도 받아쓴 대본은 저장한다', async () => {
    const written = new Map()
    const result = await buildScriptFile(cues, 'C:/영상/c.mp4', {
      script: scriptModule,
      writeFile: async (path, text) => written.set(path, text),
      askModel: async () => { throw new Error('모델 실패') },
    }, { polish: true })
    expect(written.has(result.path)).toBe(true)
    expect(result.polished).toBe(false)
  })
})
