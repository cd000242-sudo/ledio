import { execa } from 'execa'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TtsProvider, TtsRequest, TtsResult } from './provider.js'

export interface Qwen3Options {
  workspaceRoot: string
  /** 기본: <workspace>/.venv-tts/Scripts/python.exe (QWEN3_TTS_PYTHON로 재정의) */
  pythonPath?: string
  /** 기본: Qwen/Qwen3-TTS-12Hz-1.7B-Base (QWEN3_TTS_MODEL로 재정의) */
  model?: string
}

function resolvePython(opts: Qwen3Options): string {
  if (opts.pythonPath) return opts.pythonPath
  if (process.env.QWEN3_TTS_PYTHON) return process.env.QWEN3_TTS_PYTHON
  return join(opts.workspaceRoot, '.venv-tts', 'Scripts', 'python.exe')
}

const DAEMON_PORT = Number(process.env.QWEN3_TTS_PORT ?? 8756)

/** 상주 데몬이 살아 있으면 재사용하고, 없으면 백그라운드로 띄운다(모델 로드 19초를 첫 호출에만 지불). */
async function tryDaemonSynthesize(
  pythonPath: string,
  workspaceRoot: string,
  request: TtsRequest & { model: string },
): Promise<TtsResult | null> {
  const base = `http://127.0.0.1:${DAEMON_PORT}`
  const health = async () => {
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) })
      return res.ok
    } catch {
      return false
    }
  }

  if (!(await health())) {
    const daemonScript = join(workspaceRoot, 'scripts', 'qwen3_tts_daemon.py')
    if (!existsSync(daemonScript) || !existsSync(pythonPath)) return null
    // 콘솔 창이 뜨지 않는 pythonw로 데몬을 띄운다(python.exe는 detached 시 CMD 창이 보인다).
    const pythonw = pythonPath.replace(/python\.exe$/i, 'pythonw.exe')
    const daemonPython = existsSync(pythonw) ? pythonw : pythonPath
    const { spawn } = await import('node:child_process')
    spawn(daemonPython, [daemonScript, String(DAEMON_PORT)], {
      cwd: workspaceRoot,
      detached: true,
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    }).unref()
    // 모델 로드는 첫 /tts 요청에서 일어난다. 서버 소켓이 열릴 때까지만 기다린다.
    const startTs = Date.now()
    while (Date.now() - startTs < 30_000) {
      await new Promise((r) => setTimeout(r, 1000))
      if (await health()) break
    }
    if (!(await health())) return null
  }

  try {
    // 항목을 한 개씩 보낸다. 전체를 한 요청에 담으면 Node fetch의 응답 대기 한도(5분)에
    // 걸려 "fetch failed"로 끊긴다(실측: 16덩어리 낭독 실패의 원인).
    const allResults: TtsResult['results'] = []
    let device = ''
    for (let index = 0; index < request.items.length; index++) {
      const item = request.items[index] as TtsRequest['items'][number]
      if (request.items.length > 1) console.log(`  [tts] ${index + 1}/${request.items.length} 생성 중...`)
      // 한 덩어리 실패(타임아웃 등)로 전체 낭독을 버리지 않게 한 번 더 시도한다.
      // 타임아웃 10분: 데몬이 다른 작업을 처리 중이면 대기시간이 길어질 수 있다.
      let parsed: (TtsResult & { error?: string }) | null = null
      let lastError: Error | null = null
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const res = await fetch(`${base}/tts`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...request, items: [item] }),
            signal: AbortSignal.timeout(10 * 60 * 1000),
          })
          const body = (await res.json()) as TtsResult & { error?: string }
          if (!body.ok) throw new Error(body.error ?? 'TTS 생성 실패')
          parsed = body
          break
        } catch (err) {
          lastError = err as Error
          if (attempt === 1) console.warn(`  [tts] ${index + 1}번째 덩어리 실패, 재시도: ${lastError.message}`)
        }
      }
      if (!parsed) throw lastError ?? new Error('TTS 생성 실패')
      allResults.push(...parsed.results)
      device = parsed.device ?? device
      request.onProgress?.(index + 1, request.items.length)
    }
    return { ok: true, device, results: allResults }
  } catch (err) {
    // 데몬이 여전히 살아 있으면 폴백하지 않는다 — 원샷 폴백은 같은 GPU에 모델을
    // 하나 더 올려 VRAM을 고갈시키고 둘 다 기어가게 만든다(실측: 20분+ 멈춤).
    if (await health()) throw err
    console.warn(`[tts] 데몬이 죽어 원샷 모드로 폴백: ${(err as Error).message}`)
    return null
  }
}

/** 로컬 Qwen3-TTS(보이스 클로닝) 프로바이더. venv 파이썬 브리지를 호출한다. */
export function createQwen3Provider(opts: Qwen3Options): TtsProvider {
  const pythonPath = resolvePython(opts)
  const script = join(opts.workspaceRoot, 'scripts', 'qwen3_tts_infer.py')
  const model = opts.model ?? process.env.QWEN3_TTS_MODEL ?? 'Qwen/Qwen3-TTS-12Hz-1.7B-Base'

  return {
    name: 'qwen3',
    async synthesize(request: TtsRequest): Promise<TtsResult> {
      // 1차: 상주 데몬(모델 캐시) 경로
      const daemonResult = await tryDaemonSynthesize(pythonPath, opts.workspaceRoot, { model, ...request })
      if (daemonResult) return daemonResult
      // 2차: 기존 원샷 파이썬 브리지
      if (!existsSync(pythonPath)) {
        throw new Error(
          `TTS 파이썬 환경이 없습니다: ${pythonPath}\n` +
            '설치: py -3.13 -m venv .venv-tts 후 pip install torch qwen-tts soundfile',
        )
      }
      const workDir = await mkdtemp(join(tmpdir(), 'sf-tts-'))
      const jobFile = join(workDir, 'job.json')
      try {
        await writeFile(jobFile, JSON.stringify({ model, ...request }, null, 2), 'utf8')
        const { stdout } = await execa(pythonPath, [script, jobFile], {
          cwd: opts.workspaceRoot,
          timeout: 30 * 60 * 1000,
          // 한국어 Windows 콘솔(cp949)에서 이모지/한글 출력이 죽지 않게 UTF-8 강제
          env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
        })
        const lastLine = stdout.trim().split(/\r?\n/).at(-1) ?? '{}'
        const parsed = JSON.parse(lastLine) as TtsResult & { error?: string }
        if (!parsed.ok) throw new Error(parsed.error ?? 'TTS 생성 실패')
        return parsed
      } catch (err) {
        const e = err as { stderr?: string; message?: string }
        const tail = (e.stderr ?? '').split(/\r?\n/).slice(-8).join('\n')
        throw new Error(`Qwen3-TTS 실행 실패: ${e.message ?? ''}\n${tail}`)
      } finally {
        await rm(workDir, { recursive: true, force: true })
      }
    },
  }
}
