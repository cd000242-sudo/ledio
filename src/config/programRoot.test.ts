import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROGRAM_ROOT, programScript } from './programRoot.js'

describe('함께 배포되는 파일 위치', () => {
  it('실행 위치와 무관하게 실제 스크립트를 가리킨다 — 설치본에서 이게 어긋나 받아쓰기가 죽었다', () => {
    expect(existsSync(programScript('whisperx_stt.py'))).toBe(true)
    expect(existsSync(programScript('subtitle_erase.py'))).toBe(true)
    expect(existsSync(programScript('dropshot-generator.mjs'))).toBe(true)
  })

  it('작업 폴더를 옮겨도 같은 곳을 가리킨다', () => {
    const before = programScript('whisperx_stt.py')
    const cwd = process.cwd()
    try {
      process.chdir(PROGRAM_ROOT === cwd ? '..' : cwd)
      expect(programScript('whisperx_stt.py')).toBe(before)
    } finally {
      process.chdir(cwd)
    }
  })
})
