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
  await expect(tab.locator('.longform-options:not(.longform-style-grid)')).toBeHidden()
  await tab.locator('.longform-advanced:not(.longform-style-box) summary').click()
  await expect(tab.locator('.longform-options:not(.longform-style-grid)')).toBeVisible()

  await expect(tab.locator('.longform-model option')).toHaveCount(2)
  await expect(tab.locator('.longform-engine option')).toHaveCount(6)

  // 노션 규칙의 길이 기준이 기본값이다
  await expect(tab.locator('.longform-num:not(.longform-style-num)').first()).toHaveValue('18')
  await expect(tab.locator('.longform-num:not(.longform-style-num)').last()).toHaveValue('44')

  await tab.locator('.longform-engine').selectOption('api-claude')
  await expect(tab.locator('.longform-engine')).toHaveValue('api-claude')
})

test('롱폼 자막 탭: 대본이 없으면 음성으로 만들어 준다는 옵션이 켜져 있다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '롱폼 자막' }).click()
  const tab = page.locator('.longform-tab')

  const checkbox = (labelText) => tab.locator('.longform-check', { hasText: labelText }).locator('input')
  await expect(tab.locator('.longform-check input')).toHaveCount(3)
  // 대본 만들기와 오타 검수는 기본 켜짐, AI 다듬기는 기본 꺼짐(내용을 손대는 단계다)
  await expect(checkbox('음성으로 대본 파일도 만들기')).toBeChecked()
  await expect(checkbox('AI로 오타 검수')).toBeChecked()
  await expect(checkbox('AI로 대본 다듬기')).not.toBeChecked()

  await expect(tab.locator('.longform-checks')).toContainText('음성으로 대본 파일도 만들기')
  await expect(tab.locator('.longform-script')).toHaveAttribute('placeholder', /대본을 만들어 드립니다/)
})

test('롱폼 자막 탭: 다른 탭에 갔다 와도 입력이 남아 있다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '롱폼 자막' }).click()
  const tab = page.locator('.longform-tab')

  // 대본을 쓰고 옵션을 바꾼 뒤
  await tab.locator('.longform-script').fill('테스트 대본입니다. 탭을 옮겨도 남아야 합니다.')
  await tab.locator('.longform-burn').selectOption('mux')
  await tab.locator('.longform-advanced:not(.longform-style-box) summary').click()
  await tab.locator('.longform-num:not(.longform-style-num)').first().fill('20')

  // 다른 탭에 갔다가 돌아오면
  await page.getByRole('button', { name: '환경설정' }).click()
  await expect(page.locator('.longform-tab')).toHaveCount(0)
  await page.getByRole('button', { name: '롱폼 자막' }).click()

  // 쓰던 값이 그대로 있어야 한다 — 몇 분씩 걸리는 작업이라 날아가면 치명적이다
  await expect(page.locator('.longform-script')).toHaveValue('테스트 대본입니다. 탭을 옮겨도 남아야 합니다.')
  await expect(page.locator('.longform-burn')).toHaveValue('mux')
  await page.locator('.longform-advanced:not(.longform-style-box) summary').click()
  await expect(page.locator('.longform-num:not(.longform-style-num)').first()).toHaveValue('20')
})

test('롱폼 자막 탭: 작업 중에 탭을 옮겼다 와도 진행 상태가 이어진다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '롱폼 자막' }).click()

  // 실행 중인 상태를 만든다(서버 호출 없이 상태만 세팅)
  await page.evaluate(async () => {
    const module = await import('./longform-captions.js')
    const { state } = module.renderLongformCaptionsTab(document.querySelector('#tabContent'), {})
    state.mediaPath = 'D:/영상/강의.mp4'
    state.mediaName = '강의.mp4'
    state.busy = true
    state.activeStep = 'correct'
    state.status = '받아쓰는 중…'
  })

  await page.getByRole('button', { name: '환경설정' }).click()
  await page.getByRole('button', { name: '롱폼 자막' }).click()

  const tab = page.locator('.longform-tab')
  await expect(tab.locator('.longform-drop')).toContainText('강의.mp4')
  await expect(tab.locator('.longform-status')).toHaveText('받아쓰는 중…')
  await expect(tab.locator('.longform-step.is-active')).toHaveText('대본 대조 보정')
  await expect(tab.getByRole('button', { name: '만드는 중…' })).toBeDisabled()
})

test('롱폼 자막 탭: 오타 검수와 자막 모양을 고를 수 있다', async ({ page }) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '롱폼 자막' }).click()
  const tab = page.locator('.longform-tab')

  // 오타 검수는 기본으로 켜져 있다
  await expect(tab.locator('.longform-checks')).toContainText('AI로 오타 검수')

  // 용어 사전 사용법이 보인다
  await expect(tab.locator('.longform-glossary')).toHaveAttribute('placeholder', /틀린표기/)

  // 자막 모양은 접혀 있고, 펼치면 프리셋·색·두께가 있다
  await tab.locator('.longform-style-box summary').click()
  await expect(tab.locator('.longform-style option')).toHaveCount(5)
  await expect(tab.locator('.longform-color')).toHaveCount(2)

  // 프리셋을 바꾸면 색과 두께가 그 프리셋 값으로 바뀐다
  await tab.locator('.longform-style').selectOption('highlight')
  await page.locator('.longform-style-box summary').click()
  await expect(page.locator('.longform-color').first()).toHaveValue('#ffe14d')
})
