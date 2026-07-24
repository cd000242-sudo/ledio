import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      'output/**',
      'release/**',
      'samples/**',
      'tmp/**',
      '.venv-tts/**',
      'voices/**',
      'projects/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // 파일 비대화 방지 가드 — 800줄을 넘으면 도메인 단위로 쪼갤 것.
      // (app.js/local-server.mjs/story-wizard.js는 분할 예정인 기존 부채 — docs/architecture.md 참고)
      'max-lines': ['warn', { max: 800, skipBlankLines: true, skipComments: true }],
    },
  },
)
