import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    headless: true,
    actionTimeout: 15_000,
  },
})
