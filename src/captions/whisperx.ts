import { execa } from 'execa'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path'
import type { Cue } from '../subtitles/srt.js'

/**
 * WhisperX 강제정렬 STT — 롱폼 자막용 "가능한 가장 작은 단위" 타임스탬프를 만든다.
 *
 * 단어 단위 시각을 그대로 큐로 뽑고, 문장 길이로 합치는 일은 reformat이 맡는다.
 * (AI에게 타임스탬프를 만들게 하면 싱크가 밀린다 — 시각은 항상 정렬 결과에서만 온다.)
 *
 * TTS venv(.venv-tts)와 섞으면 torch가 충돌해 낭독이 깨지므로 STT 전용 venv를 쓴다.
 */

export interface WhisperxOptions {
  mediaPath: string
  outputDir: string
  model?: string
  language?: string
  computeType?: string
  device?: string
  alignDevice?: string
  batchSize?: number
  /** 대본 앞부분 — STT에 힌트로 준다(고유명사·숫자 정확도). */
  initialPrompt?: string
  pythonBin?: string
  scriptPath?: string
}

/** faster-whisper의 initial_prompt는 길면 잘린다 — 앞부분만 힌트로 준다. */
export const INITIAL_PROMPT_LIMIT = 400

export function buildInitialPrompt(script?: string): string {
  return String(script ?? '').replace(/\s+/g, ' ').trim().slice(0, INITIAL_PROMPT_LIMIT)
}

/** STT 전용 venv의 파이썬을 찾는다. 없으면 환경변수·시스템 파이썬 순서로 물러선다. */
export function findWhisperxPython(workspaceRoot: string = process.cwd()): string | null {
  const candidates = [
    process.env.SF_WHISPERX_PYTHON,
    join(workspaceRoot, '.venv-stt', 'Scripts', 'python.exe'),
    join(workspaceRoot, '.venv-stt', 'bin', 'python'),
  ].filter(Boolean) as string[]
  for (const candidate of candidates) {
    if (existsSync(candidate)) return resolve(candidate)
  }
  return null
}

/**
 * GPU가 없으면 float16을 쓸 수 없다(ctranslate2가 거부한다).
 * CPU에서는 int8로 물러선다 — 느리지만 동작은 한다.
 */
export function resolveCompute(hasCuda: boolean, requested?: string): { device: string; computeType: string } {
  if (requested) return { device: hasCuda ? 'cuda' : 'cpu', computeType: requested }
  return hasCuda ? { device: 'cuda', computeType: 'float16' } : { device: 'cpu', computeType: 'int8' }
}

/** STT venv에서 CUDA를 쓸 수 있는지 확인한다(설치가 CPU 빌드일 수 있다). */
export async function detectCuda(python: string): Promise<boolean> {
  try {
    const { stdout } = await execa(python, ['-c', 'import torch;print(torch.cuda.is_available())'], { timeout: 60000 })
    return stdout.trim().toLowerCase() === 'true'
  } catch {
    return false
  }
}

/**
 * ctranslate2는 cuDNN·cuBLAS DLL을 직접 찾는데, venv 안 torch가 들고 있는 것을 못 본다.
 * 그래서 torch/lib을 PATH 앞에 붙여준다 — 안 붙이면 GPU 실행이 0xC0000409로 즉사한다(실측).
 */
export function torchLibDir(pythonPath: string): string {
  // <venv>/Scripts/python.exe → <venv>/Lib/site-packages/torch/lib
  const venvRoot = dirname(dirname(pythonPath))
  return process.platform === 'win32'
    ? join(venvRoot, 'Lib', 'site-packages', 'torch', 'lib')
    : join(venvRoot, 'lib', 'site-packages', 'torch', 'lib')
}

/**
 * STT에 넣을 음성을 뽑는다(16kHz 모노 wav).
 * 영상 컨테이너를 그대로 물리면 Windows에서 프로세스가 즉사하는 경우가 있다(실측).
 * 미리 뽑아두면 그 문제도 없고, 전사·정렬 두 단계가 같은 파일을 재사용해 디코딩도 한 번만 한다.
 */
export function buildAudioExtractArgs(mediaPath: string, outPath: string): string[] {
  return ['-y', '-i', mediaPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', outPath]
}

export interface PhaseArgOptions extends WhisperxOptions {
  scriptPath: string
  segmentsJson: string
  outJson: string
}

/** 1단계 — 전사(ctranslate2, GPU). */
export function buildTranscribeArgs(options: PhaseArgOptions): string[] {
  const args = [
    options.scriptPath,
    'transcribe',
    options.mediaPath,
    '--out',
    options.segmentsJson,
    '--model',
    options.model ?? 'large-v3',
    '--language',
    (options.language ?? 'ko').trim() || 'ko',
    '--device',
    options.device ?? 'cuda',
    '--compute-type',
    options.computeType ?? 'float16',
    '--batch-size',
    String(options.batchSize ?? 16),
  ]
  const prompt = buildInitialPrompt(options.initialPrompt)
  if (prompt) args.push('--initial-prompt', prompt)
  return args
}

/** 2단계 — 정렬(torch, GPU). 전사 프로세스가 끝난 뒤 별도 프로세스로 띄운다. */
export function buildAlignArgs(options: PhaseArgOptions): string[] {
  return [
    options.scriptPath,
    'align',
    options.mediaPath,
    '--segments',
    options.segmentsJson,
    '--out',
    options.outJson,
    '--language',
    (options.language ?? 'ko').trim() || 'ko',
    '--device',
    options.alignDevice ?? options.device ?? 'cuda',
  ]
}

interface WhisperxWord {
  word?: string
  start?: number
  end?: number
}

interface WhisperxSegment {
  start?: number
  end?: number
  text?: string
  words?: WhisperxWord[]
}

const toMs = (seconds: unknown): number => Math.max(0, Math.round(Number(seconds ?? 0) * 1000))

/**
 * WhisperX JSON을 큐로 바꾼다.
 * 단어 시각이 있으면 단어 단위로(가장 세밀), 없으면 문장 단위로 물러선다.
 */
export function parseWhisperxJson(raw: string): Cue[] {
  let data: { segments?: WhisperxSegment[] }
  try {
    data = JSON.parse(raw) as { segments?: WhisperxSegment[] }
  } catch {
    throw new Error('WhisperX 결과(JSON)를 해석하지 못했습니다.')
  }
  const segments = Array.isArray(data.segments) ? data.segments : []
  const cues: Cue[] = []

  for (const segment of segments) {
    const words = Array.isArray(segment.words) ? segment.words : []
    const timedWords = words.filter((word) => word.start !== undefined && word.end !== undefined)
    if (timedWords.length > 0) {
      for (const word of timedWords) {
        const text = String(word.word ?? '').trim()
        if (!text) continue
        cues.push({ startMs: toMs(word.start), endMs: toMs(word.end), text })
      }
      continue
    }
    const text = String(segment.text ?? '').trim()
    if (!text) continue
    cues.push({ startMs: toMs(segment.start), endMs: toMs(segment.end), text })
  }

  // 정렬이 어긋난 단어가 섞이면 이후 합치기가 꼬이므로 시간순으로 세운다.
  return cues.sort((left, right) => left.startMs - right.startMs)
}


export interface WhisperxProgress {
  phase: 'transcribe' | 'align'
  message: string
}

export async function runWhisperx(
  options: WhisperxOptions,
  onProgress: (progress: WhisperxProgress) => void = () => {},
): Promise<Cue[]> {
  const python = options.pythonBin ?? findWhisperxPython()
  if (!python) {
    throw new Error(
      'WhisperX를 찾을 수 없습니다. 저장소 폴더에서 `py -3.13 -m venv .venv-stt` 후 `.venv-stt/Scripts/python -m pip install whisperx`를 실행하세요.',
    )
  }
  const scriptPath = options.scriptPath ?? join(process.cwd(), 'scripts', 'whisperx_stt.py')
  const stem = basename(options.mediaPath, extname(options.mediaPath))
  const segmentsJson = join(options.outputDir, stem + '.segments.json')
  const outJson = join(options.outputDir, stem + '.aligned.json')
  const audioPath = join(options.outputDir, stem + '.16k.wav')
  const { device, computeType } = resolveCompute(await detectCuda(python), options.computeType)

  onProgress({ phase: 'transcribe', message: '음성을 뽑는 중' })
  try {
    await execa('ffmpeg', buildAudioExtractArgs(options.mediaPath, audioPath), { timeout: 1000 * 60 * 30 })
  } catch (err) {
    const error = err as { shortMessage?: string }
    throw new Error('음성 추출 실패(ffmpeg): ' + (error.shortMessage ?? '알 수 없는 오류'))
  }

  const phaseOptions: PhaseArgOptions = {
    ...options,
    mediaPath: audioPath,
    scriptPath,
    segmentsJson,
    outJson,
    device,
    computeType,
  }
  const runOptions = {
    timeout: 1000 * 60 * 60,
    // ctranslate2가 cuDNN DLL을 찾게 torch/lib을 앞에 붙인다(없으면 GPU 실행이 즉사한다).
    env: { PATH: torchLibDir(python) + delimiter + (process.env.PATH ?? '') },
  }

  const run = async (phase: 'transcribe' | 'align', args: string[]) => {
    try {
      await execa(python, args, runOptions)
    } catch (err) {
      const error = err as { stderr?: string; shortMessage?: string }
      const detail = String(error.stderr ?? '').trim().split('\n').slice(-4).join('\n')
      const label = phase === 'transcribe' ? '받아쓰기' : '정렬'
      throw new Error('WhisperX ' + label + ' 실패: ' + (error.shortMessage ?? '알 수 없는 오류') + '\n' + detail)
    }
  }

  onProgress({ phase: 'transcribe', message: '음성을 받아쓰는 중' })
  await run('transcribe', buildTranscribeArgs(phaseOptions))

  // 전사 프로세스가 완전히 끝난 뒤에 정렬을 띄운다 — 같이 올리면 GPU에서 충돌한다.
  onProgress({ phase: 'align', message: '단어 단위로 시간을 맞추는 중' })
  try {
    await run('align', buildAlignArgs(phaseOptions))
  } catch (error) {
    // TTS 데몬 등이 VRAM을 잡고 있으면 GPU 정렬이 죽는다(실측). 느려도 CPU로 끝내는 편이 낫다.
    if ((phaseOptions.alignDevice ?? device) === 'cpu') throw error
    onProgress({ phase: 'align', message: 'GPU가 모자라 CPU로 시간을 맞추는 중(조금 더 걸립니다)' })
    await run('align', buildAlignArgs({ ...phaseOptions, alignDevice: 'cpu' }))
  }

  return parseWhisperxJson(await readFile(outJson, 'utf8'))
}
