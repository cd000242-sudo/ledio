/* global Response */
import { describe, expect, it, vi } from 'vitest'
import { createApiClient, safeProjectPath } from './api-client.mjs'

const jsonResponse = (payload, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })

describe('safeProjectPath', () => {
  it('상대 경로를 정규화한다', () => {
    expect(safeProjectPath('projects\\my-item')).toBe('projects/my-item')
    expect(safeProjectPath('./projects/a/project.yaml')).toBe('projects/a/project.yaml')
  })

  it('절대 경로와 상위 탈출을 막는다', () => {
    expect(() => safeProjectPath('C:/Windows/system32')).toThrow('절대 경로')
    expect(() => safeProjectPath('/etc/passwd')).toThrow('절대 경로')
    expect(() => safeProjectPath('projects/../../secrets')).toThrow('상위 폴더')
    expect(() => safeProjectPath('   ')).toThrow('projectPath')
  })
})

describe('createApiClient', () => {
  it('GET 쿼리를 붙이고 JSON을 돌려준다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, yaml: 'a: 1' }))
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4173/', fetchImpl })
    const result = await api.get('/api/project/read', { projectPath: 'projects/a' })
    expect(result.yaml).toBe('a: 1')
    expect(fetchImpl.mock.calls[0][0]).toBe('http://127.0.0.1:4173/api/project/read?projectPath=projects%2Fa')
  })

  it('POST 본문을 JSON으로 보낸다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const api = createApiClient({ baseUrl: 'http://127.0.0.1:4173', fetchImpl })
    await api.post('/api/render', { projectPath: 'projects/a' })
    const [, init] = fetchImpl.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ projectPath: 'projects/a' })
  })

  it('ok:false와 HTTP 오류를 서버 메시지로 던진다', async () => {
    const api = createApiClient({
      baseUrl: 'http://127.0.0.1:4173',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ ok: false, error: '주제를 입력하세요.' })),
    })
    await expect(api.post('/api/script/generate', {})).rejects.toThrow('주제를 입력하세요.')

    const api2 = createApiClient({
      baseUrl: 'http://127.0.0.1:4173',
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse({ error: '없는 잡' }, 404)),
    })
    await expect(api2.get('/api/jobs/x')).rejects.toThrow('없는 잡')
  })

  it('연결 실패는 한국어 안내로 감싼다', async () => {
    const api = createApiClient({
      baseUrl: 'http://127.0.0.1:4173',
      fetchImpl: vi.fn().mockRejectedValue(new Error('fetch failed')),
    })
    await expect(api.get('/api/health')).rejects.toThrow('앱 서버에 연결하지 못했습니다')
  })

  it('baseUrl이 없으면 즉시 실패', () => {
    expect(() => createApiClient({})).toThrow('baseUrl')
  })
})
