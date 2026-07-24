import { existsSync } from 'node:fs'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, extname, join, resolve } from 'node:path'
import { execa } from 'execa'
import { reformatSubtitles } from '../subtitles/reformat.js'
import { parseSrt, serializeSrt, type Cue } from '../subtitles/srt.js'

export type AutoCaptionProviderId = 'mock' | 'local-whisper'

export interface AutoCaptionToolStatus {
  id: 'ffmpeg' | 'ffprobe' | 'local-whisper' | 'python' | 'pip'
  label: string
  command: string
  available: boolean
  version?: string
  installHint: string
}

export interface GenerateAutoCaptionOptions {
  projectName?: string
  clipFile: string
  clipPath: string
  durationSec?: number
  provider?: AutoCaptionProviderId
  language?: string
  model?: string
  outputDir: string
  modelDir?: string
  minChars?: number
  maxChars?: number
  whisperBin?: string
}

export interface AutoCaptionReport {
  projectName?: string
  provider: AutoCaptionProviderId
  clip: {
    file: string
    path: string
    durationSec: number
  }
  language: string
  model?: string
  srtFile: string
  cueCount: number
  cues: Cue[]
  warnings: string[]
  tools: AutoCaptionToolStatus[]
  generatedAt: string
}

interface ToolSpec {
  id: AutoCaptionToolStatus['id']
  label: string
  command: string
  args: string[]
  installHint: string
}

const KOREAN_MOCK_LINES = [
  '첫 문장에서 시청자를 바로 붙잡습니다.',
  '핵심 장면만 남기고 말의 흐름을 정리합니다.',
  '자막 길이는 모바일 화면에서 읽기 쉽게 맞춥니다.',
  '마지막에는 행동 유도 문장을 자연스럽게 붙입니다.',
]

const ENGLISH_MOCK_LINES = [
  'Open with the strongest hook.',
  'Keep only the parts that move the story forward.',
  'Make every subtitle easy to read on mobile.',
  'Close with a clear next action.',
]

const tmpToolDir = 'C:\\tmp\\shorts-factory-ffmpeg\\bin'
const wingetLinkDir = join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links')
const codexWingetLinkDir = 'C:\\CodexHome\\AppData\\Local\\Microsoft\\WinGet\\Links'
const pythonScriptDirs = [
  'C:\\CodexHome\\AppData\\Roaming\\Python\\Python314\\Scripts',
  join(homedir(), 'AppData', 'Roaming', 'Python', 'Python314', 'Scripts'),
  'C:\\Python314\\Scripts',
]

function numberOption(value: number | undefined, fallback: number): number {
  return Number.isFinite(value) ? Number(value) : fallback
}

function cleanLanguage(value: string | undefined): string {
  const language = String(value ?? 'ko').trim()
  return language || 'ko'
}

function safeStem(file: string): string {
  const raw = basename(file, extname(file))
  const stem = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return stem || 'captions'
}

function executableName(name: string): string {
  return process.platform === 'win32' ? `${name}.exe` : name
}

function pathCandidates(name: string, envName: string): string[] {
  const candidates: string[] = []
  const envPath = process.env[envName]
  if (envPath) candidates.push(envPath)
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (entry) candidates.push(join(entry, executableName(name)))
  }
  candidates.push(join(tmpToolDir, executableName(name)))
  candidates.push(join(wingetLinkDir, executableName(name)), join(codexWingetLinkDir, executableName(name)))
  for (const dir of pythonScriptDirs) candidates.push(join(dir, executableName(name)))
  return candidates
}

function findExecutable(name: string, envName: string): string | null {
  const found = pathCandidates(name, envName).find((candidate) => candidate && existsSync(candidate))
  return found ? resolve(found) : null
}

function toolEnvOverrides(): Record<string, string> {
  const ffmpeg = findExecutable('ffmpeg', 'FFMPEG_PATH')
  const ffprobe = findExecutable('ffprobe', 'FFPROBE_PATH')
  const whisper = findExecutable('whisper', 'WHISPER_BIN')
  const extraDirs = [ffmpeg ? dirname(ffmpeg) : '', ffprobe ? dirname(ffprobe) : '', whisper ? dirname(whisper) : ''].filter(Boolean)
  const env: Record<string, string> = {}
  if (ffmpeg) env.FFMPEG_PATH = ffmpeg
  if (ffprobe) env.FFPROBE_PATH = ffprobe
  if (whisper) env.WHISPER_BIN = whisper
  if (extraDirs.length > 0) env.PATH = [...new Set(extraDirs), process.env.PATH ?? ''].filter(Boolean).join(delimiter)
  return env
}

function outputSrtPath(outputDir: string, clipFile: string): string {
  return join(outputDir, `${safeStem(clipFile)}.auto.srt`)
}

export function normalizeAutoCaptionProvider(value: unknown): AutoCaptionProviderId {
  return value === 'mock' ? 'mock' : 'local-whisper'
}

function toolSpecs(whisperBin?: string): ToolSpec[] {
  return [
    {
      id: 'ffmpeg',
      label: 'FFmpeg',
      command: findExecutable('ffmpeg', 'FFMPEG_PATH') || process.env.FFMPEG_PATH || 'ffmpeg',
      args: ['-version'],
      installHint: 'winget install Gyan.FFmpeg 또는 FFMPEG_PATH 환경변수로 ffmpeg.exe 경로를 지정하세요.',
    },
    {
      id: 'ffprobe',
      label: 'FFprobe',
      command: findExecutable('ffprobe', 'FFPROBE_PATH') || process.env.FFPROBE_PATH || 'ffprobe',
      args: ['-version'],
      installHint: 'FFmpeg 설치 후 PATH를 새로고침하거나 FFPROBE_PATH 환경변수로 ffprobe.exe 경로를 지정하세요.',
    },
    {
      id: 'local-whisper',
      label: '로컬 Whisper',
      command: whisperBin || findExecutable('whisper', 'WHISPER_BIN') || process.env.WHISPER_BIN || 'whisper',
      args: ['--help'],
      installHint:
        'python -m pip install -U openai-whisper 실행 후 터미널/앱을 다시 열거나 WHISPER_BIN으로 whisper.exe 경로를 지정하세요.',
    },
    {
      id: 'python',
      label: 'Python',
      command: 'python',
      args: ['--version'],
      installHint: 'Python 3.10 이상을 설치하고 PATH에 추가하세요.',
    },
    {
      id: 'pip',
      label: 'pip',
      command: 'pip',
      args: ['--version'],
      installHint: 'Python 설치 옵션에서 pip를 포함하거나 python -m ensurepip를 실행하세요.',
    },
  ]
}

function firstLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

function tail(value: string | undefined, lines = 12): string {
  return String(value ?? '')
    .split(/\r?\n/)
    .slice(-lines)
    .join('\n')
}

async function checkTool(spec: ToolSpec): Promise<AutoCaptionToolStatus> {
  if (spec.id === 'local-whisper' && existsSync(spec.command)) {
    return {
      id: spec.id,
      label: spec.label,
      command: spec.command,
      available: true,
      version: 'whisper.exe 감지됨',
      installHint: spec.installHint,
    }
  }
  try {
    const result = await execa(spec.command, spec.args, { timeout: 6000, env: toolEnvOverrides() })
    return {
      id: spec.id,
      label: spec.label,
      command: spec.command,
      available: true,
      version: firstLine(`${result.stdout}\n${result.stderr}`),
      installHint: spec.installHint,
    }
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; shortMessage?: string }
    return {
      id: spec.id,
      label: spec.label,
      command: spec.command,
      available: false,
      version: firstLine(`${error.stdout ?? ''}\n${error.stderr ?? ''}\n${error.shortMessage ?? ''}`),
      installHint: spec.installHint,
    }
  }
}

export async function detectAutoCaptionTools(whisperBin?: string): Promise<AutoCaptionToolStatus[]> {
  return Promise.all(toolSpecs(whisperBin).map((spec) => checkTool(spec)))
}

function buildMockCues(durationSec: number, language: string): Cue[] {
  const durationMs = Math.max(3000, Math.round(durationSec * 1000))
  const lines = language.toLowerCase().startsWith('ko') ? KOREAN_MOCK_LINES : ENGLISH_MOCK_LINES
  const stepMs = Math.max(1200, Math.floor(durationMs / lines.length))
  const cues: Cue[] = []
  let startMs = 0
  for (let index = 0; index < lines.length; index += 1) {
    const isLast = index === lines.length - 1
    const endMs = isLast ? durationMs : Math.min(durationMs, startMs + stepMs)
    if (endMs - startMs < 500) break
    const text = lines[index]
    if (text) cues.push({ startMs, endMs, text })
    startMs = endMs
  }
  return cues
}

async function findWhisperSrt(outputDir: string, clipPath: string): Promise<string> {
  const expected = join(outputDir, `${basename(clipPath, extname(clipPath))}.srt`)
  try {
    await access(expected)
    return expected
  } catch {
    const files = await readdir(outputDir)
    const firstSrt = files.find((file) => file.toLowerCase().endsWith('.srt'))
    if (!firstSrt) throw new Error('Whisper 실행은 끝났지만 SRT 파일을 찾지 못했습니다.')
    return join(outputDir, firstSrt)
  }
}

async function writeFormattedSrt(rawCues: Cue[], srtFile: string, minChars: number, maxChars: number): Promise<Cue[]> {
  const cues = reformatSubtitles(rawCues, { minChars, maxChars })
  await writeFile(srtFile, serializeSrt(cues), 'utf8')
  return cues
}

async function runLocalWhisper(options: Required<Pick<GenerateAutoCaptionOptions, 'clipPath' | 'outputDir' | 'clipFile'>> &
  Pick<GenerateAutoCaptionOptions, 'language' | 'model' | 'modelDir' | 'minChars' | 'maxChars' | 'whisperBin'>): Promise<{
  cues: Cue[]
  srtFile: string
}> {
  const whisperBin = options.whisperBin || findExecutable('whisper', 'WHISPER_BIN') || process.env.WHISPER_BIN || 'whisper'
  const language = cleanLanguage(options.language)
  const args = [
    options.clipPath,
    '--task',
    'transcribe',
    '--output_format',
    'srt',
    '--output_dir',
    options.outputDir,
    '--model',
    options.model || 'base',
  ]
  if (options.modelDir) args.push('--model_dir', options.modelDir)
  if (language !== 'auto') args.push('--language', language)

  try {
    await execa(whisperBin, args, { timeout: 1000 * 60 * 30, env: toolEnvOverrides() })
  } catch (err) {
    const error = err as { stderr?: string; shortMessage?: string; code?: string }
    if (error.code === 'ENOENT') {
      throw new Error(
        '로컬 Whisper를 찾을 수 없습니다. 앱의 자동자막 상태에서 설치 안내를 확인한 뒤 WHISPER_BIN 또는 PATH를 설정하세요.',
      )
    }
    throw new Error(
      `로컬 Whisper 자동자막 실패: ${error.shortMessage ?? 'unknown error'}\n${tail(error.stderr)}`,
    )
  }

  const rawSrt = await readFile(await findWhisperSrt(options.outputDir, options.clipPath), 'utf8')
  const srtFile = outputSrtPath(options.outputDir, options.clipFile)
  const cues = await writeFormattedSrt(
    parseSrt(rawSrt),
    srtFile,
    numberOption(options.minChars, 8),
    numberOption(options.maxChars, 28),
  )
  return { cues, srtFile }
}

export async function generateAutoCaptions(options: GenerateAutoCaptionOptions): Promise<AutoCaptionReport> {
  const provider = normalizeAutoCaptionProvider(options.provider)
  const language = cleanLanguage(options.language)
  const durationSec = Math.max(1, numberOption(options.durationSec, 12))
  const minChars = numberOption(options.minChars, 8)
  const maxChars = numberOption(options.maxChars, 28)
  const warnings: string[] = []

  await access(options.clipPath)
  await mkdir(options.outputDir, { recursive: true })
  const tools = await detectAutoCaptionTools(options.whisperBin)

  let cues: Cue[]
  let srtFile = outputSrtPath(options.outputDir, options.clipFile)
  if (provider === 'mock') {
    warnings.push('테스트 자막 엔진으로 생성했습니다. 실제 음성 인식은 로컬 Whisper를 선택하세요.')
    cues = await writeFormattedSrt(buildMockCues(durationSec, language), srtFile, minChars, maxChars)
  } else {
    const result = await runLocalWhisper({
      clipFile: options.clipFile,
      clipPath: options.clipPath,
      outputDir: options.outputDir,
      language,
      model: options.model,
      modelDir: options.modelDir,
      minChars,
      maxChars,
      whisperBin: options.whisperBin,
    })
    cues = result.cues
    srtFile = result.srtFile
    if (cues.length === 0) warnings.push('생성된 자막 큐가 없습니다. 오디오 트랙이나 Whisper 언어 설정을 확인하세요.')
  }

  return {
    projectName: options.projectName,
    provider,
    clip: {
      file: options.clipFile,
      path: options.clipPath,
      durationSec,
    },
    language,
    model: provider === 'local-whisper' ? options.model || 'base' : undefined,
    srtFile,
    cueCount: cues.length,
    cues,
    warnings,
    tools,
    generatedAt: new Date().toISOString(),
  }
}
