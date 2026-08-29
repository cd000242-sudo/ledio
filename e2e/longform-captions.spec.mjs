/* global URL */
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

test('롱폼 자막 탭: 파일 넣기 전에는 실행이 잠겨 있다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '롱폼 자막' }).click()

  const tab = page.locator('.longform-tab')
  await expect(tab).toBeVisible()
  await expect(tab).toContainText('영상 하나만 넣으면 끝납니다')

  // 드롭존이 보이고, 파일을 고르기 전에는 실행할 수 없다
  await expect(tab.locator('.longform-drop')).toContainText('끌어다 놓으세요')
  await expect(tab.getByRole('button', { name: '자막 만들기' })).toBeDisabled()

  // 진행 단계는 실행 전에는 숨어 있다
  await expect(tab.locator('.longform-steps')).toBeHidden()

  // 완성 영상 옵션이 기본으로 '태워넣기'다 — 원클릭이 목적이다
  await expect(tab.locator('.longform-burn')).toHaveValue('burn')

  // 대본은 선택 사항이고, 정확도에 도움이 된다고 안내한다
  await expect(tab.locator('.longform-script')).toHaveAttribute('placeholder', /대본이 있으면 붙여넣으세요/)
})

test('롱폼 자막 탭: 세부 설정에 모델·엔진·길이 기준이 있다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '롱폼 자막' }).click()
  const tab = page.locator('.longform-tab')

  // 세부 설정은 접혀 있다 — 평소에는 파일만 넣으면 된다
  await expect(tab.locator('.longform-options')).toBeHidden()
  await tab.locator('.longform-advanced summary').click()
  await expect(tab.locator('.longform-options')).toBeVisible()

  await expect(tab.locator('.longform-model option')).toHaveCount(2)
  await expect(tab.locator('.longform-engine option')).toHaveCount(6)

  // 노션 규칙의 길이 기준이 기본값이다
  await expect(tab.locator('.longform-num').first()).toHaveValue('18')
  await expect(tab.locator('.longform-num').last()).toHaveValue('44')

  await tab.locator('.longform-engine').selectOption('api-claude')
  await expect(tab.locator('.longform-engine')).toHaveValue('api-claude')
})

test('롱폼 자막 탭: 대본이 없으면 음성으로 만들어 준다는 옵션이 켜져 있다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '롱폼 자막' }).click()
  const tab = page.locator('.longform-tab')

  const checks = tab.locator('.longform-check input')
  await expect(checks).toHaveCount(2)
  // 대본 만들기는 기본 켜짐, AI 다듬기는 기본 꺼짐(추가 비용이 드는 단계다)
  await expect(checks.first()).toBeChecked()
  await expect(checks.last()).not.toBeChecked()

  await expect(tab.locator('.longform-checks')).toContainText('음성으로 대본 파일도 만들기')
  await expect(tab.locator('.longform-script')).toHaveAttribute('placeholder', /대본을 만들어 드립니다/)
})
