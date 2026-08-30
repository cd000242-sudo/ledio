/* global process, setTimeout */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import {
  ALLOWED_TOOLS,
  DENIED_TOOLS,
  buildClaudeArgs,
  buildMcpConfig,
  SYSTEM_PROMPT,
  buildInputLine,
  createAssistantRuntime,
  displayToolName,
  parseStreamLine,
  sanitizeEnv,
} from './assistant-runtime.mjs'

describe('환경 정리', () => {
  it('중첩 세션 변수와 ELECTRON_RUN_AS_NODE를 지운다', () => {
    const env = sanitizeEnv({
      PATH: '/usr/bin',
      CLAUDECODE: '1',
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      CLAUDE_CODE_SSE_PORT: '1234',
      ELECTRON_RUN_AS_NODE: '1',
    })
    expect(env.PATH).toBe('/usr/bin')
    expect(env.CLAUDECODE).toBeUndefined()
    expect(env.CLAUDE_CODE_ENTRYPOINT).toBeUndefined()
    expect(env.CLAUDE_CODE_SSE_PORT).toBeUndefined()
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined()
    expect(env.MCP_TOOL_TIMEOUT).toBe('900000')
  })
})

describe('MCP 설정', () => {
  it('앱 주소와 키를 MCP 서버 환경에만 넣는다', () => {
    const config = buildMcpConfig({
      apiBase: 'http://127.0.0.1:5000',
      serverScript: 'C:/app/scripts/mcp/shorts-mcp.mjs',
      method: 'api-claude',
      apiKey: 'sk-secret',
    })
    const server = config.mcpServers.shortsfactory
    expect(server.args).toEqual(['C:/app/scripts/mcp/shorts-mcp.mjs'])
    expect(server.env.SHORTS_API_BASE).toBe('http://127.0.0.1:5000')
    expect(server.env.SHORTS_API_KEY).toBe('sk-secret')
    // 개발(node)에서는 이 변수를 넣지 않는다. Electron 안에서만 '1'로 넣어 MCP를 node 모드로 띄운다.
    expect(server.env.ELECTRON_RUN_AS_NODE).toBe(process.versions.electron ? '1' : undefined)
    expect(server.env.SHORTS_APPROVAL).toBe('1')
  })

  it('키가 없으면 키 항목 자체를 넣지 않는다', () => {
    const config = buildMcpConfig({ apiBase: 'http://x', serverScript: 's.mjs' })
    expect(config.mcpServers.shortsfactory.env.SHORTS_API_KEY).toBeUndefined()
  })
})

describe('CLI 인자', () => {
  it('허용 도구만 열고 위험 도구는 닫는다', () => {
    const args = buildClaudeArgs({ mcpConfigPath: '/tmp/mcp.json' })
    expect(args).toContain('--strict-mcp-config')
    expect(args.join(' ')).toContain('mcp__shortsfactory__*')
    for (const denied of DENIED_TOOLS) expect(args).toContain(denied)
    for (const allowed of ALLOWED_TOOLS) expect(args).toContain(allowed)
    expect(args).not.toContain('--dangerously-skip-permissions')
    expect(args).not.toContain('--resume')
  })

  it('세션 이어가기와 모델 지정을 붙인다', () => {
    const args = buildClaudeArgs({ mcpConfigPath: '/tmp/mcp.json', resumeSessionId: 'abc', model: 'haiku' })
    expect(args).toContain('--resume')
    expect(args[args.indexOf('--resume') + 1]).toBe('abc')
    expect(args[args.indexOf('--model') + 1]).toBe('haiku')
  })

  it('대화 1세션 비용 상한을 건다 — 도구가 꼬여도 구독 한도를 다 태우지 않게', () => {
    const args = buildClaudeArgs({ mcpConfigPath: '/tmp/mcp.json', budgetUsd: 5 })
    expect(args[args.indexOf('--max-budget-usd') + 1]).toBe('5')
  })

  it('상한을 끄면 플래그를 넣지 않는다', () => {
    const args = buildClaudeArgs({ mcpConfigPath: '/tmp/mcp.json', budgetUsd: null })
    expect(args).not.toContain('--max-budget-usd')
  })
})

describe('시스템 프롬프트', () => {
  it('검증·제약 규칙을 담는다 — 이게 빠지면 에이전트가 실패를 완료로 보고한다', () => {
    expect(SYSTEM_PROMPT).toContain('완료라고 하지 마라')
    expect(SYSTEM_PROMPT).toContain('validate_project')
    expect(SYSTEM_PROMPT).toContain('지우지 않는다')
    expect(SYSTEM_PROMPT).toContain('결론부터')
  })
})

describe('입력 인코딩', () => {
  it('한글 메시지를 순수 ASCII 한 줄로 바꾼다', () => {
    // 어떤 로캘에서도 파이프가 안 깨지도록 순수 ASCII만 내보낸다.
    const line = buildInputLine('쇼츠 만들어줘')
    expect(Array.from(line).every((char) => char.charCodeAt(0) < 128)).toBe(true)
    expect(line.endsWith(String.fromCharCode(10))).toBe(true)
    const parsed = JSON.parse(line)
    expect(parsed.type).toBe('user')
    expect(parsed.message.content[0].text).toBe('쇼츠 만들어줘')
  })

  it('따옴표·줄바꿈이 섞여도 JSON 한 줄을 유지한다', () => {
    const line = buildInputLine('"큰따옴표"와 줄바꿈\n두번째 줄')
    expect(line.trim().split(String.fromCharCode(10))).toHaveLength(1)
    expect(JSON.parse(line).message.content[0].text).toContain('두번째 줄')
  })
})

describe('스트림 파서', () => {
  it('init에서 세션 id를 뽑는다', () => {
    const events = parseStreamLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1' }))
    expect(events).toEqual([{ type: 'session', sessionId: 's-1' }])
  })

  it('텍스트와 생각 델타를 구분한다', () => {
    const text = parseStreamLine(
      JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '안녕' } } }),
    )
    expect(text).toEqual([{ type: 'text', delta: '안녕' }])
    const thinking = parseStreamLine(
      JSON.stringify({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '음' } },
      }),
    )
    expect(thinking[0].type).toBe('thinking')
  })

  it('도구 호출은 MCP 접두사를 떼고 알린다', () => {
    const events = parseStreamLine(
      JSON.stringify({
        type: 'assistant',
        message: {
          content: [
            { type: 'text', text: '확인할게요' },
            { type: 'tool_use', id: 't-1', name: 'mcp__shortsfactory__render', input: { projectPath: 'projects/a' } },
          ],
        },
      }),
    )
    expect(events).toEqual([{ type: 'tool', id: 't-1', name: 'render', input: { projectPath: 'projects/a' } }])
  })

  it('도구 결과의 성공·실패와 요약을 넘긴다', () => {
    const [event] = parseStreamLine(
      JSON.stringify({
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't-1', is_error: true, content: [{ type: 'text', text: '실패: 상위 폴더' }] },
          ],
        },
      }),
    )
    expect(event).toMatchObject({ type: 'tool_end', id: 't-1', ok: false })
    expect(event.summary).toContain('상위 폴더')
  })

  it('result에서 세션·비용·소요를 뽑는다', () => {
    const [event] = parseStreamLine(
      JSON.stringify({
        type: 'result',
        session_id: 's-1',
        result: '끝',
        total_cost_usd: 0.07,
        duration_ms: 6900,
        is_error: false,
      }),
    )
    expect(event).toEqual({
      type: 'done',
      sessionId: 's-1',
      isError: false,
      result: '끝',
      limit: null,
      costUsd: 0.07,
      durationMs: 6900,
    })
  })

  it('한도로 끝난 result는 어느 한도인지 붙여 보낸다', () => {
    const [event] = parseStreamLine(
      JSON.stringify({
        type: 'result',
        session_id: 's-2',
        result: "You've hit your Opus limit",
        is_error: true,
      }),
    )
    // 모델별 한도는 모델만 바꾸면 계속 쓸 수 있다 — UI가 그 안내를 띄우는 근거
    expect(event.limit).toMatchObject({ kind: 'model', switchable: true })
  })

  it('깨진 줄·관심 없는 이벤트는 조용히 버린다', () => {
    expect(parseStreamLine('그냥 로그 한 줄')).toEqual([])
    expect(parseStreamLine('{깨진 JSON')).toEqual([])
    expect(parseStreamLine(JSON.stringify({ type: 'system', subtype: 'status' }))).toEqual([])
  })

  it('도구 이름 표시는 접두사만 뗀다', () => {
    expect(displayToolName('mcp__shortsfactory__job_status')).toBe('job_status')
    expect(displayToolName('WebSearch')).toBe('WebSearch')
  })
})

/** 가짜 claude 프로세스 — stdout에 stream-json 줄을 흘리고 종료한다. */
function fakeChild() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.stdin = { end: vi.fn() }
  child.pid = 4242
  child.killed = false
  return child
}

/** 런타임이 stdout 리스너를 붙일 때까지 기다린다 — 고정 대기는 부하가 걸리면 흔들린다. */
async function waitForAttach(child) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (child.stdout.listenerCount('data') > 0) return
    await new Promise((r) => setTimeout(r, 5))
  }
  throw new Error('런타임이 스트림을 붙이지 않았습니다')
}

describe('대화 런타임', () => {
  const options = (spawnImpl) => ({
    apiBase: 'http://127.0.0.1:5000',
    serverScript: 'C:/app/scripts/mcp/shorts-mcp.mjs',
    claudeBinary: 'C:/bin/claude.exe',
    spawnImpl,
  })

  it('스트림을 이벤트로 흘리고 정상 종료한다', async () => {
    const child = fakeChild()
    const runtime = createAssistantRuntime(options(vi.fn().mockReturnValue(child)))
    const events = []
    const done = runtime.chat({ message: '프로젝트 목록 보여줘', onEvent: (event) => events.push(event) })

    await waitForAttach(child)
    // 한 청크에 여러 줄이 붙어 오고, 마지막 줄이 잘려 오는 상황을 재현한다.
    child.stdout.emit(
      'data',
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-9' }) +
        '\n' +
        JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '네' } } }) +
        '\n' +
        '{"type":"result","session_id":"s-9","result":"끝"',
    )
    child.stdout.emit('data', ',"total_cost_usd":0.01,"duration_ms":1200}\n')
    child.emit('close', 0)

    const result = await done
    expect(result.ok).toBe(true)
    expect(events.map((event) => event.type)).toEqual(['session', 'text', 'done'])
    expect(events[2]).toMatchObject({ sessionId: 's-9', costUsd: 0.01 })
    expect(child.stdin.end).toHaveBeenCalledWith(buildInputLine('프로젝트 목록 보여줘'), 'ascii')
  })

  it('CLI가 0이 아닌 코드로 죽으면 stderr 꼬리를 알린다', async () => {
    const child = fakeChild()
    const runtime = createAssistantRuntime(options(vi.fn().mockReturnValue(child)))
    const events = []
    const done = runtime.chat({ message: '안녕', onEvent: (event) => events.push(event) })
    await waitForAttach(child)
    child.stderr.emit('data', '로그인이 필요합니다')
    child.emit('close', 1)
    const result = await done
    expect(result.ok).toBe(false)
    expect(events.at(-1)).toMatchObject({ type: 'error' })
    expect(events.at(-1).message).toContain('로그인이 필요합니다')
  })

  it('대화 중에는 새 대화를 받지 않고, 끝나면 다시 받는다', async () => {
    const child = fakeChild()
    const runtime = createAssistantRuntime(options(vi.fn().mockReturnValue(child)))
    const done = runtime.chat({ message: '첫 대화', onEvent: () => {} })
    await waitForAttach(child)
    expect(runtime.busy).toBe(true)
    await expect(runtime.chat({ message: '두 번째', onEvent: () => {} })).rejects.toThrow('진행 중')
    child.emit('close', 0)
    await done
    expect(runtime.busy).toBe(false)
  })

  it('CLI가 없으면 설치 안내를 던진다', async () => {
    const runtime = createAssistantRuntime({ ...options(vi.fn()), claudeBinary: null })
    await expect(runtime.chat({ message: '안녕', onEvent: () => {} })).rejects.toThrow('npm install -g')
  })

  it('빈 메시지는 보내지 않는다', async () => {
    const spawnImpl = vi.fn()
    const runtime = createAssistantRuntime(options(spawnImpl))
    await expect(runtime.chat({ message: '   ', onEvent: () => {} })).rejects.toThrow('비어 있습니다')
    expect(spawnImpl).not.toHaveBeenCalled()
  })
})
