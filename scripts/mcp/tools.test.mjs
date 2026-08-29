import { describe, expect, it, vi } from 'vitest'
import { createTools } from './tools.mjs'

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

const toolByName = (tools, name) => tools.find((tool) => tool.name === name)

describe('도구 카탈로그', () => {
  it('모든 도구가 이름·설명·risk 태그를 갖는다', () => {
    const tools = createTools({ api: fakeApi() })
    expect(tools.length).toBeGreaterThan(10)
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-z_]+$/)
      expect(tool.description.length).toBeGreaterThan(10)
      expect(['read', 'write', 'run']).toContain(tool.risk)
    }
    expect(new Set(tools.map((t) => t.name)).size).toBe(tools.length)
  })

  it('되돌릴 수 없는 작업은 read로 태깅되지 않는다', () => {
    const tools = createTools({ api: fakeApi() })
    for (const name of ['render', 'write_project', 'narrate', 'cancel_job']) {
      expect(toolByName(tools, name).risk).not.toBe('read')
    }
  })
})

describe('경로 감옥', () => {
  it('워크스페이스 밖 경로는 서버까지 가지 않고 막힌다', async () => {
    const api = fakeApi()
    const tools = createTools({ api })
    await expect(toolByName(tools, 'read_project').run({ projectPath: 'C:/Windows' })).rejects.toThrow('절대 경로')
    await expect(toolByName(tools, 'render').run({ projectPath: 'projects/../../etc' })).rejects.toThrow('상위 폴더')
    expect(api.calls).toHaveLength(0)
  })

  it('쿠팡 캡처 경로도 각각 검사한다', async () => {
    const api = fakeApi()
    const tools = createTools({ api })
    await expect(
      toolByName(tools, 'analyze_coupang').run({
        projectName: 'a',
        images: ['images/ok.png', '../../secret.png'],
        method: 'api-claude',
      }),
    ).rejects.toThrow('상위 폴더')
    expect(api.calls).toHaveLength(0)
  })
})

describe('REST 매핑', () => {
  it('read_project는 정규화된 경로로 GET한다', async () => {
    const api = fakeApi({ '/api/project/read': { ok: true, yaml: 'projectName: a' } })
    const tools = createTools({ api })
    const result = await toolByName(tools, 'read_project').run({ projectPath: './projects/a' })
    expect(api.calls[0]).toEqual({ method: 'GET', path: '/api/project/read', params: { projectPath: 'projects/a' } })
    expect(result.text).toBe('projectName: a')
  })

  it('generate_script는 기본 엔진과 API 키를 채워 보낸다', async () => {
    const api = fakeApi({ '/api/script/generate': { ok: true, script: '대본입니다' } })
    const tools = createTools({ api, defaults: { method: 'api-claude', apiKey: 'sk-test' } })
    const tool = toolByName(tools, 'generate_script')
    const parsed = { topic: '주방 선반', durationSec: 30, polish: true, method: 'api-claude' }
    const result = await tool.run(parsed)
    expect(api.calls[0].body).toMatchObject({ topic: '주방 선반', method: 'api-claude', apiKey: 'sk-test' })
    expect(result.text).toBe('대본입니다')
  })

  it('CLI 엔진일 때는 API 키를 넘기지 않는다', async () => {
    const api = fakeApi({ '/api/script/generate': { ok: true, script: 'x' } })
    const tools = createTools({ api, defaults: { method: 'agent-claude', apiKey: 'sk-test' } })
    await toolByName(tools, 'generate_script').run({ topic: 'a', durationSec: 30, polish: true, method: 'agent-claude' })
    expect(api.calls[0].body.apiKey).toBeUndefined()
  })

  it('job_status는 실패 로그 꼬리를 요약에 포함한다', async () => {
    const api = fakeApi({ '/api/jobs/j-1': { ok: true, status: 'error', stderrTail: 'ffmpeg 없음' } })
    const tools = createTools({ api })
    const result = await toolByName(tools, 'job_status').run({ jobId: 'j-1' })
    expect(result.text).toContain('error')
    expect(result.text).toContain('ffmpeg 없음')
  })

  it('빈 목록은 사람이 읽을 문장으로 돌려준다', async () => {
    const api = fakeApi({ '/api/projects': { ok: true, projects: [] }, '/api/jobs': { ok: true, jobs: [] } })
    const tools = createTools({ api })
    expect((await toolByName(tools, 'list_projects').run({})).text).toContain('아직 없습니다')
    expect((await toolByName(tools, 'list_jobs').run({})).text).toContain('작업이 없습니다')
  })
})
