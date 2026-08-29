/* global URL, document, localStorage */
import { test, expect } from '@playwright/test'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createShortsFactoryServer } from '../scripts/local-server.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))

let server
let baseUrl

test.beforeAll(async () => {
  server = createShortsFactoryServer({ workspaceRoot: repoRoot, appRoot: join(repoRoot, 'app'), port: 0 })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

test.afterAll(async () => {
  if (server) await new Promise((resolveClose) => server.close(resolveClose))
})

test('비서 패널: 열기 → 상태 확인 → 예시 채우기', async ({ page }) => {
  await page.goto(baseUrl)
  const panel = page.locator('.assistant-panel')
  await expect(panel).toBeHidden()

  await page.getByRole('button', { name: /비서/ }).click()
  await expect(panel).toBeVisible()

  // 첫 화면 안내와 예시 버튼이 뜬다
  await expect(panel.getByText('앱을 대신 조작하는 비서입니다.')).toBeVisible()
  const example = panel.getByRole('button', { name: '프로젝트 목록 보여줘' })
  await example.click()
  await expect(panel.locator('.assistant-input')).toHaveValue('프로젝트 목록 보여줘')

  // CLI 상태를 실제로 물어봐서 배지에 반영한다(설치/로그인/준비됨 중 하나)
  await expect(panel.locator('.assistant-status')).toHaveText(/준비됨|설치 필요|로그인 필요|연결 실패/)

  await panel.getByRole('button', { name: '닫기' }).click()
  await expect(panel).toBeHidden()
})

test('비서 패널: 도구 카드와 승인 카드를 그린다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: /비서/ }).click()

  // 서버 이벤트를 직접 흘려 넣어 렌더링만 검증한다(실제 CLI 호출은 비용·시간 때문에 제외).
  await page.evaluate(async () => {
    const module = await import('./assistant.js')
    const assistant = module.createAssistantPanel()
    document.body.append(assistant.panel)
    assistant.open()
    assistant.panel.dataset.testPanel = 'true'
    assistant.handleEvent({ type: 'tool', id: 't1', name: 'list_projects', input: {} })
    assistant.handleEvent({ type: 'tool_end', id: 't1', ok: true, summary: '' })
    assistant.handleEvent({ type: 'tool', id: 't2', name: 'render', input: { projectPath: 'projects/demo' } })
    assistant.handleEvent({ type: 'tool_end', id: 't2', ok: false, summary: '실패: ffmpeg 없음' })
    assistant.handleEvent({ type: 'approval', id: 'ap-1', tool: 'render', input: { projectPath: 'projects/demo' } })
  })

  const panel = page.locator('.assistant-panel[data-test-panel="true"]')
  await expect(panel.locator('.assistant-tool').first()).toContainText('프로젝트 목록 읽기')
  await expect(panel.locator('.assistant-tool.is-ok')).toHaveCount(1)
  await expect(panel.locator('.assistant-tool.is-failed')).toContainText('ffmpeg 없음')

  const approval = panel.locator('.assistant-approval')
  await expect(approval).toContainText('영상 렌더 실행할까요?')
  await expect(approval).toContainText('projectPath: projects/demo')

  // 취소를 누르면 서버에 거절이 전달되고 카드가 잠긴다
  const [request] = await Promise.all([
    page.waitForRequest((req) => req.url().includes('/api/assistant/approve')),
    approval.getByRole('button', { name: '취소' }).click(),
  ])
  expect(JSON.parse(request.postData() ?? '{}')).toMatchObject({ id: 'ap-1', approved: false })
  await expect(approval).toContainText('취소함')
})

test('비서 패널: 대화 보관과 비용 표시', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: /비서/ }).click()

  await page.evaluate(async () => {
    const module = await import('./assistant.js')
    const first = module.createAssistantPanel()
    document.body.append(first.panel)
    first.open()
    // 한 턴이 끝난 상황을 재현한다(사용자 말 + 에이전트 답 + 완료 이벤트)
    first.handleEvent({ type: 'session', sessionId: 's-42' })
    first.panel.querySelector('.assistant-log').dataset.ready = '1'
    first.send('__저장확인__').catch(() => {})
  })
  // 네트워크 응답을 기다리지 않고, 저장된 사용자 메시지만 확인한다
  await page.waitForFunction(() => (localStorage.getItem('shorts-assistant-log-v1') ?? '').includes('__저장확인__'))

  // 새로 연 패널은 지난 대화를 복원한다
  await page.reload()
  await page.getByRole('button', { name: /비서/ }).click()
  const panel = page.locator('.assistant-panel')
  await expect(panel.getByText('__저장확인__')).toBeVisible()
  await expect(panel.getByText('지난 대화입니다.')).toBeVisible()

  // 완료 이벤트의 비용이 배지에 뜬다
  await page.evaluate(async () => {
    const module = await import('./assistant.js')
    const panel = module.createAssistantPanel()
    document.body.append(panel.panel)
    panel.panel.dataset.costPanel = 'true'
    panel.open()
    panel.handleEvent({ type: 'done', sessionId: 's-42', durationMs: 12000, costUsd: 0.0274, isError: false })
  })
  await expect(page.locator('.assistant-panel[data-cost-panel="true"] .assistant-status')).toHaveText('완료 · 12초 · $0.027')
})
