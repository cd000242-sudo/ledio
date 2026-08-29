/* global URL */
import { test, expect } from '@playwright/test'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createShortsFactoryServer } from '../scripts/local-server.mjs'

/**
 * 수동편집 안전망 — app.js를 쪼개는 동안 동작이 그대로인지 지키는 테스트.
 * 화면 구조와 도구가 살아 있는지만 본다(실제 렌더는 다루지 않는다).
 */

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

const openManual = async (page) => {
  await page.goto(baseUrl)
  await page.getByRole('button', { name: '수동편집하기' }).click()
  await expect(page.locator('#automationDeck')).toBeVisible()
}

/** 편집 도구 카드는 접힌 채로 뜬다 — 펼쳐야 내용이 보인다. */
const openCard = async (page, cardId) => {
  const card = page.locator(`[data-card="${cardId}"]`)
  if (!(await card.evaluate((node) => node.hasAttribute('open')))) await card.locator('summary').click()
  return card
}

test('수동편집: 미리보기·타임라인·편집 도구가 모두 뜬다', async ({ page }) => {
  await openManual(page)

  // 4분할 레이아웃이 켜진다
  await expect(page.locator('body')).toHaveAttribute('data-mode', 'manual')
  await expect(page.locator('.preview-deck')).toBeVisible()
  await expect(page.locator('#timelineDeck')).toBeVisible()

  // 편집 도구 카드가 전부 있다
  const deck = page.locator('#automationDeck')
  for (const name of ['무음 자동컷', '자동 자막', '텍스트 컷 편집', '자동 음성', '속도 조절']) {
    await expect(deck.getByText(name, { exact: true })).toBeVisible()
  }

  // 무음컷 버튼들이 실제로 있다(카드를 펼치면 보인다)
  await openCard(page, 'silence')
  await expect(page.locator('#autoAutocutBtn')).toBeVisible()
  await expect(page.locator('#autoAnalyzeBtn')).toBeVisible()
  await expect(page.locator('#autoApplyBtn')).toBeVisible()
})

test('수동편집: 타임라인 조작 버튼과 미리보기 컨트롤이 있다', async ({ page }) => {
  await openManual(page)

  // 타임라인 툴바
  for (const label of ['되돌리기', '추가', '분할', '앞 자르기', '뒤 자르기']) {
    await expect(page.locator('#timelineDeck').getByText(label, { exact: false }).first()).toBeVisible()
  }

  // 미리보기 재생 컨트롤
  await expect(page.locator('#previewPlayBtn')).toBeVisible()
  await expect(page.locator('#previewPlayheadField')).toBeVisible()
  await expect(page.locator('#previewRatioField')).toBeVisible()
})

test('수동편집: 하위 탭을 오가도 화면이 유지된다', async ({ page }) => {
  await openManual(page)
  const deck = page.locator('#automationDeck')
  await expect(deck).toBeVisible()

  await page.getByRole('button', { name: '환경설정' }).click()
  await expect(page.locator('#automationDeck')).toBeHidden()

  await page.getByRole('button', { name: '수동편집하기' }).click()
  await expect(page.locator('#automationDeck')).toBeVisible()
  await openCard(page, 'silence')
  await expect(page.locator('#autoAutocutBtn')).toBeVisible()
})

test('수동편집: 무음 기준·최소 길이 설정이 선택 가능하다', async ({ page }) => {
  await openManual(page)
  await openCard(page, 'silence')
  await expect(page.locator('#autoSilenceNoiseField')).toBeVisible()
  await expect(page.locator('#autoSilenceMinField')).toBeVisible()
  await expect(page.locator('#autoSilencePaddingField')).toBeVisible()
})
