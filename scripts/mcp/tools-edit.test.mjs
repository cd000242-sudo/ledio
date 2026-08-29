import { describe, expect, it, vi } from 'vitest'
import { createEditTools } from './tools-edit.mjs'

function fakeApi(responses = {}) {
  const calls = []
  const reply = (path) => responses[path] ?? { ok: true }
  return {
    calls,
    get: vi.fn(async (path, params) => {
      calls.push({ method: 'GET', path, params })
      return reply(path)
    }),
    post: vi.fn(async (path, body) => {
      calls.push({ method: 'POST', path, body })
      return reply(path)
    }),
  }
}

const byName = (tools, name) => tools.find((tool) => tool.name === name)

describe('편집·진단 도구', () => {
  it('이름·설명·risk를 갖추고 이름이 겹치지 않는다', () => {
    const tools = createEditTools({ api: fakeApi() })
    expect(tools.length).toBe(11)
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z_]+$/)
      expect(['read', 'write', 'run']).toContain(tool.risk)
      expect(tool.description.length).toBeGreaterThan(10)
    }
  })

  it('덮어쓰는 도구는 승인을 받는다', () => {
    const tools = createEditTools({ api: fakeApi() })
    expect(byName(tools, 'save_captions').approval).toBe(true)
    expect(byName(tools, 'source_remix').approval).toBe(true)
    // 원클릭 자막은 파일을 새로 만들고 몇 분을 태우므로 반드시 물어본다
    expect(byName(tools, 'longform_captions').approval).toBe(true)
    // 자르기·지우기는 되돌릴 수 없다 — 반드시 확인을 받는다
    expect(byName(tools, 'auto_edit_apply').approval).toBe(true)
    expect(byName(tools, 'erase_subtitles').approval).toBe(true)
    // 분석만 하는 것은 승인이 필요 없다
    expect(byName(tools, 'auto_edit_analyze').approval).toBeUndefined()
    expect(byName(tools, 'check_environment').approval).toBeUndefined()
  })

  it('check_environment는 빠진 도구를 집어준다', async () => {
    const api = fakeApi({
      '/api/health': { ok: true, workspaceRoot: 'C:/ledio' },
      '/api/captions/status': {
        ok: true,
        localWhisperReady: false,
        tools: [
          { id: 'ffmpeg', available: true },
          { id: 'local-whisper', available: false },
        ],
      },
    })
    const result = await byName(createEditTools({ api }), 'check_environment').run({})
    expect(result.text).toContain('빠진 도구: local-whisper')
    expect(result.text).toContain('로컬 Whisper 자막: 불가')
  })

  it('무음 분석 실패는 사유를 그대로 올린다', async () => {
    const api = fakeApi({ '/api/silence/analyze': { ok: false, error: 'ffmpeg를 찾을 수 없습니다' } })
    const result = await byName(createEditTools({ api }), 'analyze_silence').run({ projectPath: 'projects/a' })
    expect(result.text).toContain('무음 분석 실패')
    expect(result.text).toContain('ffmpeg를 찾을 수 없습니다')
  })

  it('선택 인자는 넘긴 것만 실어 보낸다', async () => {
    const api = fakeApi({ '/api/silence/analyze': { ok: true, report: { silences: [] } } })
    await byName(createEditTools({ api }), 'analyze_silence').run({ projectPath: 'projects/a', noiseDb: -35 })
    expect(api.calls[0].body).toEqual({ projectPath: 'projects/a', noiseDb: -35 })
  })

  it('경로 감옥은 여기서도 먼저 막는다', async () => {
    const api = fakeApi()
    const tools = createEditTools({ api })
    await expect(byName(tools, 'generate_captions').run({ projectPath: '../밖' })).rejects.toThrow('상위 폴더')
    await expect(
      byName(tools, 'source_remix').run({
        projectName: 'a',
        script: '대본',
        clips: ['clips/ok.mp4', 'C:/Windows/x.mp4'],
        voice: 'v1',
        ratio: '9:16',
      }),
    ).rejects.toThrow('절대 경로')
    expect(api.calls).toHaveLength(0)
  })

  it('자막 저장은 밀리초 큐 전체를 그대로 넘긴다', async () => {
    const api = fakeApi({ '/api/captions/save': { ok: true, cueCount: 2, srtFile: 'C:/ledio/projects/a/captions/main.srt' } })
    const cues = [
      { startMs: 0, endMs: 1200, text: '첫 줄' },
      { startMs: 1200, endMs: 2400, text: '둘째 줄' },
    ]
    const result = await byName(createEditTools({ api }), 'save_captions').run({
      projectPath: 'projects/a',
      srtFile: 'captions/main.srt',
      cues,
    })
    expect(api.calls[0].body.cues).toEqual(cues)
    expect(result.text).toContain('2줄을 저장')
  })
})

describe('영상 자막 원클릭 도구', () => {
  it('결과 파일 경로를 사람이 읽을 형태로 모아 준다', async () => {
    const api = fakeApi({
      '/api/longform-captions': {
        ok: true,
        cueCount: 205,
        files: { aligned: 'D:/a_정렬.srt', filled: 'D:/a_정렬_공백메움.srt' },
        scriptFile: { path: 'D:/a_대본.txt' },
        burned: { path: 'D:/a_자막.mp4', mode: 'burn' },
      },
    })
    const result = await byName(createEditTools({ api }), 'longform_captions').run({
      mediaPath: 'D:/a.mp4',
      burn: 'burn',
      makeScript: true,
      language: 'ko',
    })
    expect(result.text).toContain('205줄')
    expect(result.text).toContain('D:/a_대본.txt')
    expect(result.text).toContain('D:/a_자막.mp4')
    expect(api.calls[0].body.mediaPath).toBe('D:/a.mp4')
  })

  it('자막 넣기가 실패하면 그 사실도 보고한다', async () => {
    const api = fakeApi({
      '/api/longform-captions': {
        ok: true,
        cueCount: 10,
        files: { aligned: 'a.srt', filled: 'b.srt' },
        burned: { error: 'ffmpeg 없음' },
      },
    })
    const result = await byName(createEditTools({ api }), 'longform_captions').run({ mediaPath: 'D:/a.mp4' })
    expect(result.text).toContain('ffmpeg 없음')
  })
})
