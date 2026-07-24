/* global URL */
import { test, expect } from '@playwright/test'
import { rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createShortsFactoryServer } from '../scripts/local-server.mjs'

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)))
const projectName = `e2e-wiz-${Date.now().toString(36)}`

let server
let baseUrl

test.beforeAll(async () => {
  server = createShortsFactoryServer({
    workspaceRoot: repoRoot,
    appRoot: join(repoRoot, 'app'),
    port: 0,
  })
  await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
  baseUrl = `http://127.0.0.1:${server.address().port}`
})

test.afterAll(async () => {
  if (server) await new Promise((resolveClose) => server.close(resolveClose))
  await rm(join(repoRoot, 'projects', projectName), { recursive: true, force: true })
})

test('원클릭 위저드: 템플릿 → 대본 → 생성 → 완성 영상', async ({ page }) => {
  await page.goto(baseUrl)

  // 탭 진입
  await page.getByRole('button', { name: '원클릭 제작' }).click()

  // 대본 형식 드롭다운에 템플릿 5종(+자유 형식) 로드 확인 후 반전형 선택 → 대본 채워짐
  await expect(page.locator('#wizTemplateSelect option')).toHaveCount(6)
  await page.fill('#wizTopic', '한밤의 택배')
  await page.selectOption('#wizTemplateSelect', { label: '반전형' })
  const script = await page.inputValue('#wizScript')
  expect(script).toContain('한밤의 택배')

  // 설정: 프로젝트 이름, 나레이션 없이(E2E는 GPU TTS 생략), mock 이미지
  await page.fill('#wizProjectName', projectName)
  await page.selectOption('#wizVoiceSelect', '')
  await page.selectOption('#wizImageProvider', 'mock')

  // 실행 → 작업 카드(진행바) 노출 → 완성 → 결과 보기 → 완성 영상
  await page.getByRole('button', { name: /영상 만들기/ }).click()
  await expect(page.locator('.job-card')).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('.job-card.job-done')).toBeVisible({ timeout: 220_000 })
  await expect(page.locator('.job-card .soft-badge')).toContainText('완성')
  await page.getByRole('button', { name: '결과 보기' }).click()
  await expect(page.locator('video.wiz-result')).toBeVisible()
})

test('API 키 없이 GPT 이미지 선택하면 사전 경고가 뜬다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '원클릭 제작' }).click()
  await expect(page.locator('#wizTemplateSelect option')).toHaveCount(6)
  await page.fill('#wizScript', '테스트 문장입니다.')
  await page.selectOption('#wizImageProvider', 'gpt')
  await page.getByRole('button', { name: /영상 만들기/ }).click()
  await expect(page.locator('.wiz-status')).toContainText('API 키', { timeout: 10_000 })
})
