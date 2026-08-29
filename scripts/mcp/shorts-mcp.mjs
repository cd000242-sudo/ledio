/* global process */
/**
 * 쇼츠팩토리 MCP 서버 — 클로드코드 CLI가 stdio로 붙어 앱 기능을 도구로 호출한다.
 * 앱이 띄운 로컬 서버 주소를 SHORTS_API_BASE로 받아 그쪽 /api/*를 부르는 얇은 껍데기다.
 *
 * 환경변수
 *   SHORTS_API_BASE   (필수) 예: http://127.0.0.1:52341
 *   SHORTS_METHOD     대본/비전 기본 엔진 (api-gpt | api-gemini | api-claude | agent-claude | agent-codex)
 *   SHORTS_API_KEY    위 엔진이 api-* 일 때 쓸 키 — 에이전트에게는 노출하지 않는다
 *   SHORTS_TOOL_TIMEOUT_MS  도구 1회 상한(기본 15분)
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { pathToFileURL } from 'node:url'
import { createApiClient } from './api-client.mjs'
import { createTools } from './tools.mjs'
import { createEditTools } from './tools-edit.mjs'

/** 도구 실패는 예외로 던지지 않고 isError 결과로 돌려준다 — 에이전트가 읽고 스스로 고치게. */
function errorResult(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: `실패: ${String(error?.message ?? error)}` }],
  }
}

/**
 * 승인 게이트 — 되돌릴 수 없는 도구는 앱에 먼저 물어본다.
 * 앱이 사용자에게 카드를 띄우고, 사용자가 누를 때까지 이 호출이 대기한다.
 */
async function ensureApproved(api, tool, args) {
  const decision = await api.post('/api/assistant/approval', { tool: tool.name, input: args ?? {} })
  if (decision.approved) return null
  // 문구가 모호하면 에이전트가 '권한 설정 오류'로 오해한다(실측) — 사용자의 결정임을 분명히 한다.
  return `사용자가 이 작업을 승인하지 않았습니다${decision.reason ? ` — ${decision.reason}` : ''} `+ '설정 문제가 아니라 사용자의 결정이다. 다시 하려면 사용자에게 이유를 묻고 확인을 받아라.'
}

export function registerTools(server, tools, { api = null, approvalEnabled = false } = {}) {
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.schema,
        annotations: {
          readOnlyHint: tool.risk === 'read',
          destructiveHint: tool.risk === 'run' || tool.name === 'write_project',
        },
      },
      async (args) => {
        try {
          if (tool.approval && approvalEnabled && api) {
            const refusal = await ensureApproved(api, tool, args)
            if (refusal) return { content: [{ type: 'text', text: refusal }] }
          }
          const { text, data } = await tool.run(args ?? {})
          return {
            content: [{ type: 'text', text: text || '완료' }],
            structuredContent: data && typeof data === 'object' ? { result: data } : undefined,
          }
        } catch (error) {
          return errorResult(error)
        }
      },
    )
  }
  return server
}

export function buildServer({ baseUrl, defaults, fetchImpl, timeoutMs, approvalEnabled = false }) {
  const api = createApiClient({ baseUrl, fetchImpl, timeoutMs })
  const server = new McpServer(
    { name: 'shortsfactory', version: '1.0.0' },
    {
      instructions:
        '쇼츠팩토리 스튜디오를 조작하는 도구 모음이다. 프로젝트 경로는 항상 projects/<이름> 형태의 상대 경로로 넘긴다. ' +
        '대본은 직접 쓰지 말고 generate_script를 쓴다(앱의 톤·길이 규칙이 프롬프트에 들어 있다). ' +
        '렌더·낭독처럼 시간이 걸리는 작업은 실행 전에 무엇을 할지 사용자에게 한 줄로 알린다.',
    },
  )
  const tools = [...createTools({ api, defaults }), ...createEditTools({ api })]
  return registerTools(server, tools, { api, approvalEnabled })
}

async function main() {
  const baseUrl = process.env.SHORTS_API_BASE
  if (!baseUrl) {
    process.stderr.write('SHORTS_API_BASE 환경변수가 필요합니다.\n')
    process.exit(1)
  }
  const server = buildServer({
    baseUrl,
    defaults: { method: process.env.SHORTS_METHOD, apiKey: process.env.SHORTS_API_KEY },
    timeoutMs: Number(process.env.SHORTS_TOOL_TIMEOUT_MS) || 900000,
    approvalEnabled: process.env.SHORTS_APPROVAL === '1',
  })
  await server.connect(new StdioServerTransport())
}

// stdio 서버는 직접 실행될 때만 뜬다(테스트에서는 buildServer만 쓴다).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`MCP 서버 시작 실패: ${String(error?.message ?? error)}\n`)
    process.exit(1)
  })
}
