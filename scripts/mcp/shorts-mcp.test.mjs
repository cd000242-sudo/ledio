/* global Response */
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { describe, expect, it, vi } from 'vitest'
import { buildServer } from './shorts-mcp.mjs'

const jsonResponse = (payload) =>
  new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })

async function connect(fetchImpl, approvalEnabled = false) {
  const server = buildServer({ baseUrl: 'http://127.0.0.1:4173', fetchImpl, defaults: {}, approvalEnabled })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  const client = new Client({ name: 'test', version: '1.0.0' })
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)])
  return client
}

describe('MCP 서버 배선', () => {
  it('도구 목록을 스키마와 함께 노출한다', async () => {
    const client = await connect(vi.fn().mockResolvedValue(jsonResponse({ ok: true })))
    const { tools } = await client.listTools()
    const names = tools.map((tool) => tool.name)
    expect(names).toContain('generate_script')
    expect(names).toContain('render')
    const readProject = tools.find((tool) => tool.name === 'read_project')
    expect(readProject.inputSchema.properties.projectPath).toBeTruthy()
    expect(tools.find((tool) => tool.name === 'list_projects').annotations.readOnlyHint).toBe(true)
  })

  it('도구를 호출하면 앱 API를 부르고 텍스트를 돌려준다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true, yaml: 'projectName: demo' }))
    const client = await connect(fetchImpl)
    const result = await client.callTool({ name: 'read_project', arguments: { projectPath: 'projects/demo' } })
    expect(result.content[0].text).toBe('projectName: demo')
    expect(fetchImpl.mock.calls[0][0]).toContain('/api/project/read?projectPath=projects%2Fdemo')
  })

  it('도구 실패는 예외가 아니라 isError 결과로 돌아온다', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    const client = await connect(fetchImpl)
    const result = await client.callTool({ name: 'render', arguments: { projectPath: '../밖' } })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toContain('상위 폴더')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('스키마에 맞지 않는 인자는 프로토콜 단에서 거부한다', async () => {
    const client = await connect(vi.fn().mockResolvedValue(jsonResponse({ ok: true })))
    const result = await client.callTool({ name: 'job_status', arguments: {} })
    expect(result.isError).toBe(true)
  })
})

describe('승인 게이트', () => {
  /** 승인 요청과 실제 작업을 구분해 답하는 가짜 앱 서버. */
  const appServer = (approved) =>
    vi.fn(async (url) =>
      String(url).includes('/api/assistant/approval')
        ? jsonResponse({ ok: true, approved, reason: approved ? null : '사용자가 취소했습니다.' })
        : jsonResponse({ ok: true, stdout: '렌더 완료' }),
    )

  it('승인하면 도구가 실행된다', async () => {
    const fetchImpl = appServer(true)
    const client = await connect(fetchImpl, true)
    const result = await client.callTool({ name: 'render', arguments: { projectPath: 'projects/demo' } })
    expect(result.isError).toBeFalsy()
    const called = fetchImpl.mock.calls.map(([url]) => String(url))
    expect(called.some((url) => url.includes('/api/assistant/approval'))).toBe(true)
    expect(called.some((url) => url.includes('/api/render'))).toBe(true)
  })

  it('거절하면 실제 작업은 호출조차 하지 않는다', async () => {
    const fetchImpl = appServer(false)
    const client = await connect(fetchImpl, true)
    const result = await client.callTool({ name: 'render', arguments: { projectPath: 'projects/demo' } })
    expect(result.content[0].text).toContain('승인하지 않았습니다')
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).some((url) => url.includes('/api/render'))).toBe(false)
  })

  it('읽기 도구는 승인을 묻지 않는다', async () => {
    const fetchImpl = appServer(true)
    const client = await connect(fetchImpl, true)
    await client.callTool({ name: 'list_projects', arguments: {} })
    expect(fetchImpl.mock.calls.map(([url]) => String(url)).some((url) => url.includes('/approval'))).toBe(false)
  })
})
