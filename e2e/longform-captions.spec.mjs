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

test('롱폼 자막 탭: 입력 전에는 실행 버튼이 잠겨 있다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '롱폼 자막' }).click()

  const tab = page.locator('.longform-tab')
  await expect(tab).toBeVisible()
  await expect(tab).toContainText('컷 편집이 끝난 영상이나 음성')

  // 파일을 고르기 전에는 실행할 수 없다
  await expect(tab.getByRole('button', { name: '자막 만들기' })).toBeDisabled()
  await expect(tab.locator('.longform-path')).toHaveText('선택된 파일 없음')

  // 대본은 선택 사항이라는 안내가 보인다
  await expect(tab.locator('.longform-script')).toHaveAttribute('placeholder', /비워두셔도/)

  // 노션 규칙의 길이 기준이 기본값으로 들어가 있다
  const numbers = tab.locator('.longform-num')
  await expect(numbers.first()).toHaveValue('18')
  await expect(numbers.last()).toHaveValue('44')
})

test('롱폼 자막 탭: 보정 엔진을 고를 수 있다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '롱폼 자막' }).click()
  const engine = page.locator('.longform-engine')
  await expect(engine.locator('option')).toHaveCount(6)
  await engine.selectOption('api-claude')
  await expect(engine).toHaveValue('api-claude')
})
