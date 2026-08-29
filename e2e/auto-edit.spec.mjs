/* global URL, document */
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

test('자동 편집 탭: 파일 넣기 전에는 분석할 수 없다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '자동 편집' }).click()

  const tab = page.locator('.auto-tab')
  await expect(tab).toBeVisible()
  await expect(tab).toContainText('말 없는 구간·군더더기·같은 말 반복')
  await expect(tab.getByRole('button', { name: '자를 곳 찾기' })).toBeDisabled()
  await expect(tab.locator('.auto-strength option')).toHaveCount(3)
  await expect(tab.locator('.auto-strength')).toHaveValue('normal')
})

test('자동 편집 탭: 후보 목록과 체크 상태가 화면에 반영된다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '자동 편집' }).click()

  // 분석 결과가 있는 상태를 만들어 화면만 확인한다(실제 받아쓰기는 몇 분 걸린다)
  await page.evaluate(async () => {
    const module = await import('./auto-edit.js')
    const { state } = module.renderAutoEditTab(document.querySelector('#tabContent'), {})
    state.mediaPath = 'D:/영상/강의.mp4'
    state.mediaName = '강의.mp4'
    state.phase = 'review'
    state.analysis = {
      ok: true,
      totalMs: 200000,
      candidates: [
        { id: 'c-0', startMs: 8500, endMs: 9000, time: '00:08.5 – 00:09.0', seconds: 0.5, text: '', reason: 'silence', label: '무음 0.5초', suggested: true },
        { id: 'c-1', startMs: 21000, endMs: 24400, time: '00:21.0 – 00:24.4', seconds: 3.4, text: '이 얘기를 어디 가서 하면', reason: 'duplicate', label: '중복 · 뒤가 더 매끄러움', suggested: false },
      ],
    }
    state.checked = new Set(['c-0'])
    // 상태만 바꾸면 화면이 다시 그려지지 않는다 — 렌더를 한 번 더 부른다.
    module.renderAutoEditTab(document.querySelector('#tabContent'), {})
  })

  const tab = page.locator('.auto-tab')
  await expect(tab.locator('.auto-cut')).toHaveCount(2)
  // 무음은 기본 체크, 중복은 체크 안 됨(오판 가능성)
  await expect(tab.locator('.auto-cut').first().locator('input')).toBeChecked()
  await expect(tab.locator('.auto-cut').last().locator('input')).not.toBeChecked()
  await expect(tab.locator('.auto-summary')).toContainText('자를 후보 2곳')

  // 체크하면 단축 예정 시간이 늘어난다
  await tab.locator('.auto-cut').last().locator('input').check()
  await expect(tab.locator('.auto-summary')).toContainText('고른 것 2곳')
})
