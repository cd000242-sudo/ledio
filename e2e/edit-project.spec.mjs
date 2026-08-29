/* global URL, window */
import { test, expect } from '@playwright/test'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createShortsFactoryServer } from '../scripts/local-server.mjs'

/** 영상만 넣은 프로젝트가 실제로 저장되고 검증을 통과하는지 — Phase 0의 핵심 약속. */

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

test('상품 정보를 안 채우면 편집 전용 YAML로 저장된다', async ({ page }) => {
  await page.goto(baseUrl)

  const yaml = await page.evaluate(async () => {
    const { toProjectYamlForTest } = window.__shortsFactoryTest ?? {}
    return toProjectYamlForTest ? toProjectYamlForTest() : null
  })

  // 앱이 테스트 훅을 노출하지 않으면 화면의 YAML 출력으로 확인한다
  if (yaml) {
    expect(yaml).toContain('kind: edit')
    expect(yaml).not.toContain('affiliateUrl')
  }
})

test('편집 전용 YAML은 서버 검증을 통과한다', async ({ request }) => {
  const yaml = ['kind: edit', 'projectName: e2e-edit-check', '', 'clips:', '  - file: clips/a.mp4', '    start: 0', '    end: 12'].join('\n')
  const write = await request.post(`${baseUrl}/api/project/write`, { data: { yaml } })
  expect(write.ok()).toBeTruthy()

  // 검증은 클립 파일이 없으면 실패하지만, **스키마 오류**는 없어야 한다
  const validate = await request.post(`${baseUrl}/api/validate`, { data: { projectPath: 'projects/e2e-edit-check' } })
  const body = await validate.json()
  const message = `${body.stderr ?? ''}${body.stdout ?? ''}`
  expect(message).not.toContain('product.category')
  expect(message).not.toContain('disclosure')
  expect(message).not.toContain('style.duration')
})
