/* global process */
/**
 * 롱폼 자막 엔진(WhisperX) 설치 도우미.
 *
 * 이 엔진은 파이썬 환경 + torch까지 5GB가 넘어 설치본에 담을 수 없다.
 * 그래서 앱에서 버튼 한 번으로 깔 수 있게 한다: 전용 venv 생성 → whisperx → CUDA용 torch.
 * TTS venv(.venv-tts)와 섞지 않는다 — torch 버전이 충돌하면 낭독이 깨진다.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export const VENV_DIR = '.venv-stt'

/** 설치 단계 — 순서대로 실행한다. 각 단계는 오래 걸리므로 로그를 흘려보낸다. */
export function installSteps(workspaceRoot, { cuda = true } = {}) {
  const python = venvPython(workspaceRoot)
  const steps = [
    {
      id: 'venv',
      label: '파이썬 전용 환경 만들기',
      command: 'py',
      args: ['-3.13', '-m', 'venv', join(workspaceRoot, VENV_DIR)],
    },
    {
      id: 'whisperx',
      label: 'WhisperX 설치 (몇 분 걸립니다)',
      command: python,
      args: ['-m', 'pip', 'install', '--upgrade', 'whisperx'],
    },
    {
      // 자막 지우기가 쓰는 영상 처리 라이브러리.
      id: 'opencv',
      label: '영상 처리 라이브러리 설치',
      command: python,
      args: ['-m', 'pip', 'install', '--upgrade', 'opencv-python-headless'],
    },
  ]
  if (cuda) {
    steps.push({
      id: 'torch-cuda',
      label: 'GPU용 torch 설치 (용량이 큽니다)',
      command: python,
      // pip 기본 설치는 CPU 빌드라 GPU를 못 쓴다 — CUDA 인덱스를 지정해 다시 받는다.
      args: [
        '-m',
        'pip',
        'install',
        '--upgrade',
        '--force-reinstall',
        'torch==2.8.0',
        'torchaudio==2.8.0',
        '--index-url',
        'https://download.pytorch.org/whl/cu126',
      ],
    })
  }
  return steps
}

export function venvPython(workspaceRoot) {
  return process.platform === 'win32'
    ? join(workspaceRoot, VENV_DIR, 'Scripts', 'python.exe')
    : join(workspaceRoot, VENV_DIR, 'bin', 'python')
}

export function isEngineInstalled(workspaceRoot) {
  return existsSync(venvPython(workspaceRoot))
}

/**
 * 설치 진행 상태 — 앱이 폴링해서 보여준다.
 * 한 번에 하나만 돈다(두 번 눌러도 하나만).
 */
export function createInstaller({ workspaceRoot, spawnImpl = spawn }) {
  const state = { running: false, step: null, log: [], error: null, done: false }

  const push = (line) => {
    const text = String(line).trimEnd()
    if (!text) return
    state.log.push(text)
    if (state.log.length > 200) state.log.shift()
  }

  async function runStep(step) {
    state.step = step.label
    push(`▶ ${step.label}`)
    return new Promise((resolve, reject) => {
      const child = spawnImpl(step.command, step.args, { windowsHide: true, shell: false })
      child.stdout?.on('data', (chunk) => push(String(chunk)))
      child.stderr?.on('data', (chunk) => push(String(chunk)))
      child.on('error', (error) => reject(new Error(`${step.label} 실패: ${error.message}`)))
      child.on('close', (code) => {
        if (code === 0) resolve()
        else reject(new Error(`${step.label} 실패(코드 ${code}). 로그를 확인하세요.`))
      })
    })
  }

  async function start(options = {}) {
    if (state.running) return { started: false, reason: '이미 설치가 진행 중입니다.' }
    state.running = true
    state.done = false
    state.error = null
    state.log = []

    ;(async () => {
      try {
        for (const step of installSteps(workspaceRoot, options)) await runStep(step)
        push('✔ 설치가 끝났습니다. 롱폼 자막을 바로 쓸 수 있습니다.')
        state.done = true
      } catch (error) {
        state.error = String(error?.message ?? error)
        push(`✖ ${state.error}`)
      } finally {
        state.running = false
        state.step = null
      }
    })()

    return { started: true }
  }

  const status = () => ({
    installed: isEngineInstalled(workspaceRoot),
    running: state.running,
    step: state.step,
    done: state.done,
    error: state.error,
    log: state.log.slice(-40),
  })

  return { start, status }
}
