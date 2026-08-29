/* global process, setTimeout */
import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { createInstaller, installSteps, venvPython } from './stt-engine.mjs'

function fakeProcess() {
  const child = new EventEmitter()
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  return child
}

const waitFor = async (check) => {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (check()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('상태가 바뀌지 않았습니다')
}

describe('설치 단계', () => {
  it('전용 venv → WhisperX → GPU용 torch 순서다', () => {
    const steps = installSteps('C:/repo')
    expect(steps.map((step) => step.id)).toEqual(['venv', 'whisperx', 'torch-cuda'])
    expect(steps[0].args).toContain('C:/repo/.venv-stt'.replace(/\//g, process.platform === 'win32' ? '\\' : '/'))
  })

  it('GPU용 torch는 CUDA 인덱스를 지정한다 — 기본 설치는 CPU 빌드다', () => {
    const torchStep = installSteps('C:/repo').find((step) => step.id === 'torch-cuda')
    expect(torchStep.args).toContain('--index-url')
    expect(torchStep.args.join(' ')).toContain('cu126')
  })

  it('GPU가 필요 없으면 torch 단계를 뺀다', () => {
    expect(installSteps('C:/repo', { cuda: false }).map((step) => step.id)).toEqual(['venv', 'whisperx'])
  })

  it('venv 파이썬 경로는 전용 폴더 안을 가리킨다 — TTS 환경과 섞지 않는다', () => {
    expect(venvPython('C:/repo')).toContain('.venv-stt')
    expect(venvPython('C:/repo')).not.toContain('.venv-tts')
  })
})

describe('설치 실행', () => {
  it('단계를 순서대로 돌리고 로그를 모은다', async () => {
    const children = []
    const spawnImpl = vi.fn(() => {
      const child = fakeProcess()
      children.push(child)
      return child
    })
    const installer = createInstaller({ workspaceRoot: 'C:/repo', spawnImpl })

    expect(await installer.start()).toEqual({ started: true })
    await waitFor(() => children.length === 1)
    children[0].stdout.emit('data', '가상환경 생성 중')
    children[0].emit('close', 0)

    await waitFor(() => children.length === 2)
    children[1].emit('close', 0)
    await waitFor(() => children.length === 3)
    children[2].emit('close', 0)

    await waitFor(() => installer.status().done)
    const status = installer.status()
    expect(status.running).toBe(false)
    expect(status.error).toBeNull()
    expect(status.log.join(' ')).toContain('설치가 끝났습니다')
  })

  it('실패하면 어느 단계에서 멈췄는지 알린다', async () => {
    const children = []
    const spawnImpl = vi.fn(() => {
      const child = fakeProcess()
      children.push(child)
      return child
    })
    const installer = createInstaller({ workspaceRoot: 'C:/repo', spawnImpl })
    await installer.start()
    await waitFor(() => children.length === 1)
    children[0].emit('close', 1)

    await waitFor(() => installer.status().error !== null)
    expect(installer.status().error).toContain('파이썬 전용 환경')
    expect(installer.status().running).toBe(false)
  })

  it('설치 중에 또 눌러도 하나만 돈다', async () => {
    const children = []
    const installer = createInstaller({
      workspaceRoot: 'C:/repo',
      spawnImpl: vi.fn(() => {
        const child = fakeProcess()
        children.push(child)
        return child
      }),
    })
    await installer.start()
    await waitFor(() => children.length === 1)
    expect(await installer.start()).toMatchObject({ started: false })
    children[0].emit('close', 1)
  })
})
