/* global process, setTimeout, clearTimeout */
/**
 * 앱 조종 비서 런타임 — 클로드코드 CLI를 띄우고 stream-json 출력을 앱 이벤트로 옮긴다.
 * 도구는 MCP(scripts/mcp/shorts-mcp.mjs)로만 준다. 여기서는 프로세스와 스트림만 다룬다.
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** 이 도구들만 허용한다 — 나머지(Bash·Edit·Read 등)는 아래 DENIED로 막는다. */
export const ALLOWED_TOOLS = ['mcp__shortsfactory__*', 'WebSearch', 'WebFetch', 'ToolSearch']
export const DENIED_TOOLS = ['Bash', 'Edit', 'Write', 'NotebookEdit', 'Task', 'PowerShell', 'Skill']

/** UI에 보여줄 도구 이름 — MCP 접두사를 떼어 읽기 쉽게. */
export function displayToolName(name) {
  return String(name ?? '').replace(/^mcp__shortsfactory__/, '')
}

/**
 * 자식 프로세스 환경 정리.
 * - CLAUDECODE/CLAUDE_CODE_*: 앱을 클로드코드 안에서 켰을 때 상속되는 세션 변수(중첩 실행 방지)
 * - ELECTRON_RUN_AS_NODE: 켜져 있으면 Electron·node 자식이 GUI 없이 엉뚱하게 돈다(실측 사고)
 */
export function sanitizeEnv(sourceEnv, { toolTimeoutMs = 900000 } = {}) {
  const env = { ...sourceEnv }
  for (const key of Object.keys(env)) {
    if (key === 'CLAUDECODE' || key === 'ELECTRON_RUN_AS_NODE' || key.startsWith('CLAUDE_CODE_')) {
      delete env[key]
    }
  }
  return { ...env, MCP_TIMEOUT: String(toolTimeoutMs), MCP_TOOL_TIMEOUT: String(toolTimeoutMs) }
}

/** MCP 설정 — 앱 서버 주소와 기본 엔진·키를 MCP 서버에만 넘긴다(에이전트는 못 본다). */
export function buildMcpConfig({ apiBase, serverScript, method, apiKey, toolTimeoutMs = 900000 }) {
  return {
    mcpServers: {
      shortsfactory: {
        command: process.execPath,
        args: [serverScript],
        env: {
          SHORTS_API_BASE: apiBase,
          ...(method ? { SHORTS_METHOD: method } : {}),
          ...(apiKey ? { SHORTS_API_KEY: apiKey } : {}),
          SHORTS_TOOL_TIMEOUT_MS: String(toolTimeoutMs),
          SHORTS_APPROVAL: '1',
          ELECTRON_RUN_AS_NODE: '',
        },
      },
    },
  }
}

export const SYSTEM_PROMPT = [
  // 역할
  '너는 "쇼츠팩토리 스튜디오" 앱 안에서 도는 비서다. 사용자는 쇼핑 쇼츠를 만드는 1인 크리에이터이고, 터미널이 아니라 앱 화면으로 너와 대화한다.',
  // 작업 방식
  '앱 조작은 반드시 shortsfactory MCP 도구로만 한다. 파일을 직접 읽거나 명령어를 실행하려 하지 마라(막혀 있다).',
  '프로젝트 경로는 항상 projects/<이름> 형태의 상대 경로로 넘긴다.',
  '대본은 직접 쓰지 말고 generate_script를 써라 — 앱의 톤·길이 규칙이 그 프롬프트에 들어 있다.',
  '렌더 전에는 validate_project로 먼저 검사한다. 검증이 실패하면 렌더하지 말고 원인을 먼저 알린다.',
  // 제약
  '기존 프로젝트를 덮어쓰기 전에 read_project로 현재 내용을 읽고, 사용자가 요청하지 않은 부분은 그대로 둔다.',
  'API 키·비밀번호 값은 화면에 출력하지 않는다. 사용자가 지우라고 하지 않은 파일·설정은 지우지 않는다.',
  '몇 분 걸리는 작업(렌더·낭독)은 시작 직전에 무엇을 할지 한 줄로 알린다.',
  // 검증 — 이게 핵심이다
  '도구가 성공을 돌려줘도 결과물을 실제로 확인하기 전에는 완료라고 하지 마라. 렌더 후에는 결과 파일 경로를, 대본 생성 후에는 생성된 대본을 확인하고 보고한다.',
  '하나라도 실패했으면 완료로 보고하지 말고, 실패한 단계와 원인, 다음 조치를 알린다.',
  // 출력 형식
  '답변은 한국어로, 결론부터 한 줄. 그 다음 필요하면 [한 일 / 결과물 위치 / 남은 문제 / 다음 할 일] 순으로 짧게 덧붙인다.',
  '전문 용어는 풀어서 쓴다. 사용자는 개발자가 아니다.',
].join(' ')

/**
 * 사용자 메시지를 CLI stdin에 넣을 한 줄로 만든다.
 * stream-json 입력 형식 + 비ASCII 전부 유니코드 이스케이프 → 파이프·로캘 인코딩과 무관해진다.
 * (평문 stdin도 실측상 동작하지만, 프로그램 연동용 공식 입력 형식이 이쪽이고 다중 턴 확장도 여기서 이어진다.)
 */
export function buildInputLine(text) {
  const payload = { type: 'user', message: { role: 'user', content: [{ type: 'text', text: String(text) }] } }
  const escaped = Array.from(JSON.stringify(payload))
    .map((char) => {
      const code = char.charCodeAt(0)
      return code > 127 ? '\\u' + code.toString(16).padStart(4, '0') : char
    })
    .join('')
  return escaped + '\n'
}

export function buildClaudeArgs({ mcpConfigPath, resumeSessionId = null, model = null }) {
  const args = [
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--include-partial-messages',
    '--verbose',
    '--mcp-config',
    mcpConfigPath,
    '--strict-mcp-config',
    '--permission-mode',
    'dontAsk',
    '--allowedTools',
    ...ALLOWED_TOOLS,
    '--disallowedTools',
    ...DENIED_TOOLS,
    '--append-system-prompt',
    SYSTEM_PROMPT,
  ]
  if (model) args.push('--model', model)
  if (resumeSessionId) args.push('--resume', resumeSessionId)
  return args
}

/** stream-json 한 줄 → UI 이벤트 0~N개. 형식은 claude 2.1 실측 기준. */
export function parseStreamLine(line) {
  const raw = String(line ?? '').trim()
  if (!raw.startsWith('{')) return []
  let data
  try {
    data = JSON.parse(raw)
  } catch {
    return []
  }

  if (data.type === 'system' && data.subtype === 'init') {
    return [{ type: 'session', sessionId: data.session_id }]
  }

  if (data.type === 'stream_event') {
    const event = data.event ?? {}
    if (event.type === 'content_block_delta') {
      const delta = event.delta ?? {}
      if (delta.type === 'text_delta' && delta.text) return [{ type: 'text', delta: delta.text }]
      if (delta.type === 'thinking_delta' && delta.thinking) return [{ type: 'thinking', delta: delta.thinking }]
    }
    return []
  }

  if (data.type === 'assistant') {
    const blocks = data.message?.content ?? []
    return blocks
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        type: 'tool',
        id: block.id,
        name: displayToolName(block.name),
        input: block.input ?? {},
      }))
  }

  if (data.type === 'user') {
    const blocks = data.message?.content ?? []
    return blocks
      .filter((block) => block.type === 'tool_result')
      .map((block) => ({
        type: 'tool_end',
        id: block.tool_use_id,
        ok: block.is_error !== true,
        summary: summarizeToolResult(block.content),
      }))
  }

  if (data.type === 'result') {
    return [
      {
        type: 'done',
        sessionId: data.session_id,
        isError: Boolean(data.is_error),
        result: data.result ?? '',
        costUsd: data.total_cost_usd ?? 0,
        durationMs: data.duration_ms ?? 0,
      },
    ]
  }

  return []
}

/** 도구 결과는 길 수 있으니 UI에는 앞부분만 보낸다. */
function summarizeToolResult(content) {
  if (typeof content === 'string') return content.slice(0, 300)
  if (!Array.isArray(content)) return ''
  const text = content
    .filter((part) => part?.type === 'text')
    .map((part) => part.text)
    .join('\n')
  return text.slice(0, 300)
}

/**
 * 대화 런타임 — 한 번에 한 대화만 돌린다(앱은 1인용이고, 동시 실행은 구독 한도만 태운다).
 */
export function createAssistantRuntime({
  apiBase,
  serverScript,
  claudeBinary,
  defaults = {},
  toolTimeoutMs = 900000,
  turnTimeoutMs = 900000,
  spawnImpl = spawn,
}) {
  let current = null

  async function chat({ message, sessionId = null, model = null, onEvent }) {
    if (current) throw new Error('이미 대화가 진행 중입니다. 먼저 중단하세요.')
    if (!claudeBinary) throw new Error('Claude Code CLI를 찾을 수 없습니다. 설치: npm install -g @anthropic-ai/claude-code')
    const text = String(message ?? '').trim()
    if (!text) throw new Error('보낼 메시지가 비어 있습니다.')

    const configDir = await mkdtemp(join(tmpdir(), 'shorts-mcp-'))
    const mcpConfigPath = join(configDir, 'mcp.json')
    await writeFile(
      mcpConfigPath,
      JSON.stringify(buildMcpConfig({ apiBase, serverScript, ...defaults, toolTimeoutMs }), null, 2),
      'utf8',
    )

    const args = buildClaudeArgs({ mcpConfigPath, resumeSessionId: sessionId, model })
    const isCmdShim = /\.(cmd|bat)$/i.test(claudeBinary)
    const child = isCmdShim
      ? spawnImpl('cmd', ['/c', claudeBinary, ...args], spawnOptions())
      : spawnImpl(claudeBinary, args, spawnOptions())

    current = { child, configDir }
    child.stdin.end(buildInputLine(text), 'ascii')

    return await new Promise((resolveChat) => {
      let buffer = ''
      let stderr = ''
      let finished = false
      const timer = setTimeout(() => {
        onEvent({ type: 'error', message: '응답 시간이 너무 깁니다(15분). 대화를 중단했습니다.' })
        killTree(child)
      }, turnTimeoutMs)

      const finish = async (payload) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        current = null
        await rm(configDir, { recursive: true, force: true }).catch(() => {})
        resolveChat(payload)
      }

      child.stdout.on('data', (chunk) => {
        buffer += String(chunk)
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          for (const event of parseStreamLine(line)) onEvent(event)
        }
      })
      child.stderr.on('data', (chunk) => {
        stderr += String(chunk)
      })
      child.on('error', (error) => {
        onEvent({ type: 'error', message: `에이전트 실행 실패: ${error.message}` })
        finish({ ok: false })
      })
      child.on('close', (code) => {
        for (const event of parseStreamLine(buffer)) onEvent(event)
        if (code !== 0) {
          const tail = stderr.trim().split('\n').slice(-3).join(' ').slice(0, 300)
          onEvent({ type: 'error', message: `에이전트 종료(${code}): ${tail || '출력 없음'}` })
        }
        finish({ ok: code === 0 })
      })
    })
  }

  function cancel() {
    if (!current) return false
    killTree(current.child)
    return true
  }

  return { chat, cancel, get busy() { return current !== null } }
}

function spawnOptions() {
  return {
    windowsHide: true,
    shell: false,
    env: sanitizeEnv(process.env),
    cwd: tmpdir(), // 프로젝트 폴더 컨텍스트(CLAUDE.md 등)를 읽지 않게 중립 위치에서 실행
    stdio: ['pipe', 'pipe', 'pipe'],
  }
}

/** 손자(MCP 서버·크로미움)까지 정리한다 — 부모만 죽이면 좀비가 남는다. */
function killTree(child) {
  if (!child || child.killed) return
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' })
    return
  }
  child.kill('SIGTERM')
}
