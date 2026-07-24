import { configDefaults, defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // e2e/는 Playwright 전용(test:e2e). vitest 단위 테스트에서 제외한다.
    exclude: [...configDefaults.exclude, 'e2e/**', 'release/**'],
  },
})
