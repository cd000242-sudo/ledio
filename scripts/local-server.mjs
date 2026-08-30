/* global AbortSignal, Buffer, URL, fetch, process, setTimeout, clearTimeout */
import { createReadStream, existsSync } from 'node:fs'
import { createAssistantRuntime } from './server/assistant-runtime.mjs'
import { createInstaller, isEngineInstalled } from './server/stt-engine.mjs'
import { analyzeForAutoEdit, applySelectedCuts, readAutoEditProgress } from './server/auto-edit.mjs'
import { bucketPeaks, buildPeaksArgs } from './server/peaks.mjs'
import { eraseSubtitles } from './server/subtitle-erase.mjs'
import {
  buildBurnSrt,
  proofreadCues,
  buildLongformOutputs,
  buildScriptFile,
  correctWithScript,
  tidyOutputs,
} from './server/longform-captions.mjs'
import {
  COHERENCE_RULES,
  coupangViralPrompt,
  coupangVisionPrompt,
  deliveryPrompt,
  judgePrompt,
  parseCoupangProductInfo,
  parseDeliveryResponse,
  parseRemixMatch,
  parseShotResponse,
  parseSourceClipInfo,
  remixMatchPrompt,
  scriptPrompt,
  seriesArcPrompt,
  shotPrompt,
  sourceClipVisionPrompt,
  splitScenesForShots,
  splitSentencesForDelivery,
} from './server/script-prompts.mjs'
import {
  NARRATION_STYLES,
  buildPresetDeliveryPlan,
  resolveNarrationStyle,
} from './server/narration-styles.mjs'
import { buildProductNarrationText } from './server/product-narration.mjs'
import {
  captureMimeType,
  claudeVisionContent,
  geminiVisionParts,
  openaiVisionContent,
} from './server/coupang-shorts.mjs'
import {
  buildFrameExtractArgs,
  buildProbeArgs,
  buildRemixPlan,
  parseProbeOutput,
} from './server/source-remix.mjs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { delimiter, dirname, extname, isAbsolute, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

/** 파이썬 스크립트를 부를 때 쓰는 프로미스 버전 execFile. */
const execFileAsync = promisify(execFile)
import YAML from 'yaml'

const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.mp4', 'video/mp4'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.m4a', 'audio/mp4'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
])

const tmpToolDir = 'C:\\tmp\\shorts-factory-ffmpeg\\bin'
const wingetLinkDir = join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links')
const codexWingetLinkDir = 'C:\\CodexHome\\AppData\\Local\\Microsoft\\WinGet\\Links'
const pythonScriptDirs = [
  'C:\\CodexHome\\AppData\\Roaming\\Python\\Python314\\Scripts',
  join(homedir(), 'AppData', 'Roaming', 'Python', 'Python314', 'Scripts'),
  'C:\\Python314\\Scripts',
]

/**
 * 앱과 함께 배포되는 파일(scripts, dist, app)이 있는 곳 — 이 모듈의 위치에서 구한다.
 * 인자로 받은 작업 폴더로 찾으면 안 된다. 설치본에서는 그 둘이 다른 자리에 있다.
 */
const PROGRAM_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')


function safeStartsWith(childPath, parentPath) {
  const child = resolve(childPath).toLowerCase()
  const parent = resolve(parentPath).toLowerCase()
  return child === parent || child.startsWith(`${parent}${sep}`)
}

function executableName(name) {
  return process.platform === 'win32' ? `${name}.exe` : name
}

function pathCandidates(name, envName) {
  const candidates = []
  if (process.env[envName]) candidates.push(process.env[envName])
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (entry) candidates.push(join(entry, executableName(name)))
  }
  candidates.push(join(tmpToolDir, executableName(name)))
  candidates.push(join(wingetLinkDir, executableName(name)), join(codexWingetLinkDir, executableName(name)))
  for (const dir of pythonScriptDirs) candidates.push(join(dir, executableName(name)))
  return candidates
}

function findExecutable(name, envName) {
  const found = pathCandidates(name, envName).find((candidate) => candidate && existsSync(candidate))
  return found ? resolve(found) : null
}

function toolEnvOverrides() {
  const ffmpeg = findExecutable('ffmpeg', 'FFMPEG_PATH')
  const ffprobe = findExecutable('ffprobe', 'FFPROBE_PATH')
  const whisper = findExecutable('whisper', 'WHISPER_BIN')
  const extraDirs = [ffmpeg ? dirname(ffmpeg) : '', ffprobe ? dirname(ffprobe) : '', whisper ? dirname(whisper) : ''].filter(Boolean)
  const env = {}
  if (ffmpeg) env.FFMPEG_PATH = ffmpeg
  if (ffprobe) env.FFPROBE_PATH = ffprobe
  if (whisper) env.WHISPER_BIN = whisper
  if (extraDirs.length > 0) env.PATH = [...new Set(extraDirs), process.env.PATH ?? ''].filter(Boolean).join(delimiter)
  return env
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(payload, null, 2))
}

function sendText(res, status, text) {
  res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
  res.end(text)
}

function parseJsonObjectFromText(text) {
  const raw = String(text ?? '')
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
}

function formatSrtTimestamp(ms) {
  const safeMs = Math.max(0, Math.round(Number(ms) || 0))
  const hours = Math.floor(safeMs / 3_600_000)
  const minutes = Math.floor((safeMs % 3_600_000) / 60_000)
  const seconds = Math.floor((safeMs % 60_000) / 1000)
  const millis = safeMs % 1000
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')},${String(millis).padStart(3, '0')}`
}

function normalizeSrtCue(cue) {
  const startMs = Math.max(0, Math.round(Number(cue?.startMs) || 0))
  const rawEndMs = Math.max(0, Math.round(Number(cue?.endMs) || 0))
  const endMs = Math.max(rawEndMs, startMs + 250)
  const text = String(cue?.text ?? '').replace(/\r\n?/g, '\n').trim()
  return { startMs, endMs, text }
}

function serializeSrt(cues) {
  const entries = cues
    .map(normalizeSrtCue)
    .filter((cue) => cue.text)
    .map((cue, index) => `${index + 1}\n${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(cue.endMs)}\n${cue.text}`)
  return entries.length > 0 ? `${entries.join('\n\n')}\n` : ''
}

function resolveStaticPath(appRoot, requestUrl, host, port) {
  const pathname = decodeURIComponent(new URL(requestUrl, `http://${host}:${port}`).pathname)
  const rel = pathname === '/' ? 'index.html' : pathname.slice(1)
  const file = normalize(join(appRoot, rel))
  return safeStartsWith(file, appRoot) ? file : null
}

function resolveWorkspacePath(workspaceRoot, inputPath) {
  if (!inputPath) throw new Error('projectPath가 필요합니다.')
  const file = isAbsolute(inputPath) ? resolve(inputPath) : resolve(workspaceRoot, inputPath)
  if (!safeStartsWith(file, workspaceRoot)) {
    throw new Error('워크스페이스 밖의 경로는 사용할 수 없습니다.')
  }
  return file
}

function resolveProjectFile(workspaceRoot, projectPath) {
  const target = resolveWorkspacePath(workspaceRoot, projectPath)
  const ext = extname(target).toLowerCase()
  return ext === '.yaml' || ext === '.yml' ? target : join(target, 'project.yaml')
}

function projectDirFromYaml(workspaceRoot, yamlText, requestedDir) {
  if (requestedDir) return resolveWorkspacePath(workspaceRoot, requestedDir)
  const parsed = YAML.parse(yamlText)
  return projectDirFromName(workspaceRoot, parsed?.projectName)
}

function safeProjectName(value) {
  const rawName = String(value ?? 'new-project')
  const safeName = rawName
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return safeName || 'new-project'
}

function projectDirFromName(workspaceRoot, projectName) {
  const safeName = safeProjectName(projectName)
  return join(workspaceRoot, 'projects', safeName || 'new-project')
}

async function readJsonBody(req, maxBytes = 1024 * 1024) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > maxBytes) throw new Error('요청 본문이 너무 큽니다.')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  return raw ? JSON.parse(raw) : {}
}

function safeFileName(value, fallback = 'media') {
  const withoutControlChars = Array.from(String(value ?? '')).filter((char) => {
    const code = char.codePointAt(0) ?? 0
    return code >= 32 && code !== 127
  })
  const cleaned = withoutControlChars
    .join('')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
  const compact = cleaned.replace(/^\.+/, '').slice(0, 120)
  return compact || fallback
}

function mediaFolderForKind(kind) {
  if (kind === 'image') return 'images'
  if (kind === 'audio') return 'audio'
  return 'clips'
}

// npm.cmd를 shell:false로 스폰하면 Node 20.12+에서 EINVAL이 나므로(CVE-2024-27980 패치),
// node 실행파일로 tsx CLI(없으면 빌드된 dist)를 직접 실행한다.
function cliEntryArgs() {
  // CLI도 함께 배포되는 파일이다 — 작업 폴더가 아니라 프로그램 위치에서 찾는다.
  const tsxCli = join(PROGRAM_ROOT, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  if (existsSync(tsxCli)) return [tsxCli, join(PROGRAM_ROOT, 'src', 'cli', 'index.ts')]
  return [join(PROGRAM_ROOT, 'dist', 'cli', 'index.js')]
}

// ── 자식 프로세스 관리: 좀비가 남지 않게 트리째 종료한다 ──

// 실행 중인 모든 CLI 자식 — 앱 종료·작업 중지 시 일괄 정리 대상.
const activeCliChildren = new Set()

/** 자식 프로세스를 손자(크로미움·ffmpeg)까지 트리째 종료한다. child.kill()만으로는 고아가 남는다. */
function killChildTree(child) {
  if (!child) return
  try {
    if (process.platform === 'win32' && child.pid) {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, shell: false })
    } else {
      child.kill?.()
    }
  } catch {
    /* 이미 종료된 프로세스 */
  }
}

/** 앱 종료 시 남아 있는 자식을 전부 정리한다(좀비 방지). */
export function killAllCliChildren() {
  for (const child of activeCliChildren) killChildTree(child)
  activeCliChildren.clear()
}

/** 앱 시작 시, 이전 실행이 남긴 고아 드롭샷 크로미움을 청소한다. */
function sweepOrphanDropshotChromium() {
  if (process.platform !== 'win32') return
  try {
    spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | Where-Object { $_.CommandLine -match 'dropshot-profile' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
      ],
      { windowsHide: true, shell: false, stdio: 'ignore' },
    ).unref()
  } catch {
    /* 청소 실패는 무시 */
  }
}

// ── 진단 기록: 최근 CLI 실행 결과를 메모리에 남겨 진단 로그 파일로 저장할 수 있게 한다 ──
const diagnosticsEvents = []

function recordDiagnostics(kind, detail) {
  diagnosticsEvents.push({ ts: new Date().toISOString(), kind, ...detail })
  if (diagnosticsEvents.length > 200) diagnosticsEvents.shift()
}

function defaultCommandRunner({ command, projectPath, workspaceRoot, args, env, onSpawn, onOutput }) {
  return new Promise((resolveCommand) => {
    const cliArgs = args ?? [command, projectPath]
    // Electron 내부에서는 process.execPath가 electron.exe이므로,
    // ELECTRON_RUN_AS_NODE=1로 순수 Node처럼 실행한다(일반 node에서는 무시됨).
    const child = spawn(process.execPath, [...cliEntryArgs(), ...cliArgs], {
      cwd: workspaceRoot,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...toolEnvOverrides(), ...env },
      shell: false,
      windowsHide: true,
    })
    // 중지 기능 등에서 실행 중 프로세스를 붙잡을 수 있게 노출한다.
    activeCliChildren.add(child)
    onSpawn?.(child)
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
      onOutput?.(String(chunk))
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
      onOutput?.(String(chunk))
    })
    child.on('close', (exitCode) => {
      activeCliChildren.delete(child)
      recordDiagnostics('cli', {
        command,
        args: cliArgs.join(' ').slice(0, 400),
        exitCode: exitCode ?? 1,
        stderrTail: stderr.split(/\r?\n/).slice(-30).join('\n').slice(0, 4000),
        stdoutTail: stdout.split(/\r?\n/).slice(-20).join('\n').slice(0, 2500),
      })
      resolveCommand({ exitCode: exitCode ?? 1, stdout, stderr })
    })
    child.on('error', (error) => {
      activeCliChildren.delete(child)
      recordDiagnostics('cli-error', { command, exitCode: 1, stderrTail: error.message })
      resolveCommand({ exitCode: 1, stdout, stderr: error.message })
    })
  })
}

async function sendStaticFile(res, file, req = null) {
  try {
    const info = await stat(file)
    if (!info.isFile()) throw new Error('not a file')
    const contentType = mimeTypes.get(extname(file)) ?? 'application/octet-stream'

    // Range 지원 — 없으면 브라우저가 오디오/영상 길이를 모르고(Infinity 표시) 탐색도 안 된다.
    const range = req?.headers?.range
    const match = range ? /^bytes=(\d*)-(\d*)$/.exec(range) : null
    if (match && (match[1] !== '' || match[2] !== '')) {
      const start = match[1] === '' ? Math.max(0, info.size - Number(match[2])) : Number(match[1])
      const end = match[1] !== '' && match[2] !== '' ? Math.min(Number(match[2]), info.size - 1) : info.size - 1
      if (start >= info.size || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${info.size}` })
        res.end()
        return
      }
      res.writeHead(206, {
        'content-type': contentType,
        'content-length': end - start + 1,
        'content-range': `bytes ${start}-${end}/${info.size}`,
        'accept-ranges': 'bytes',
        'cache-control': 'no-store',
      })
      createReadStream(file, { start, end }).pipe(res)
      return
    }

    res.writeHead(200, {
      'content-type': contentType,
      'content-length': info.size,
      'accept-ranges': 'bytes',
      'cache-control': 'no-store',
    })
    createReadStream(file).pipe(res)
  } catch {
    sendText(res, 404, 'not found')
  }
}

async function handleProjectWrite(req, res, workspaceRoot) {
  const body = await readJsonBody(req)
  const yamlText = String(body.yaml ?? '')
  if (!yamlText.trim()) {
    sendJson(res, 400, { ok: false, error: 'yaml 내용이 필요합니다.' })
    return
  }

  const projectDir = projectDirFromYaml(workspaceRoot, yamlText, body.projectDir)
  if (!safeStartsWith(projectDir, workspaceRoot)) {
    sendJson(res, 400, { ok: false, error: '워크스페이스 밖에는 저장할 수 없습니다.' })
    return
  }

  const parsed = YAML.parse(yamlText)
  const projectName = String(parsed?.projectName ?? '')
  const projectFile = join(projectDir, 'project.yaml')
  await mkdir(dirname(projectFile), { recursive: true })
  await writeFile(projectFile, yamlText, 'utf8')
  sendJson(res, 200, { ok: true, projectDir, projectFile, projectName })
}

async function handleProjectRead(url, res, workspaceRoot) {
  const projectPath = url.searchParams.get('projectPath')
  const projectFile = resolveProjectFile(workspaceRoot, projectPath)
  const yaml = await readFile(projectFile, 'utf8')
  sendJson(res, 200, { ok: true, projectFile, yaml })
}

async function handleMediaUpload(req, res, workspaceRoot) {
  const body = await readJsonBody(req, 260 * 1024 * 1024)
  const projectName = body.projectName ?? 'new-project'
  const kind = body.kind === 'image' || body.kind === 'audio' ? body.kind : 'video'
  const files = Array.isArray(body.files) ? body.files : []
  if (files.length === 0) {
    sendJson(res, 400, { ok: false, error: '가져올 파일이 없습니다.' })
    return
  }

  const projectDir = projectDirFromName(workspaceRoot, projectName)
  const folder = mediaFolderForKind(kind)
  const targetDir = join(projectDir, folder)
  await mkdir(targetDir, { recursive: true })

  const imported = []
  for (let index = 0; index < files.length; index += 1) {
    const file = files[index] ?? {}
    const name = safeFileName(file.name, `${kind}-${index + 1}`)
    const rawData = String(file.data ?? '').replace(/^data:[^,]+,/, '')
    if (!rawData) {
      sendJson(res, 400, { ok: false, error: `${name} 파일 데이터가 비어 있습니다.` })
      return
    }
    const targetPath = join(targetDir, name)
    await writeFile(targetPath, Buffer.from(rawData, 'base64'))
    imported.push({
      name,
      kind,
      relativePath: `${folder}/${name}`,
      absolutePath: targetPath,
      size: Number(file.size ?? 0),
      type: String(file.type ?? ''),
    })
  }

  sendJson(res, 200, { ok: true, projectDir, imported })
}

async function handleMediaPreview(url, res, workspaceRoot, req = null) {
  const mediaFile = String(url.searchParams.get('file') ?? '')
  if (!mediaFile.trim()) {
    sendJson(res, 400, { ok: false, error: '미리볼 파일 경로가 필요합니다.' })
    return
  }

  const projectPath = url.searchParams.get('projectPath')
  const projectName = url.searchParams.get('projectName')
  const projectDir = projectPath
    ? resolveWorkspacePath(workspaceRoot, projectPath)
    : projectDirFromName(workspaceRoot, projectName ?? 'new-project')
  const target = resolve(projectDir, mediaFile)
  if (!safeStartsWith(target, projectDir) || !safeStartsWith(target, workspaceRoot)) {
    sendJson(res, 403, { ok: false, error: '프로젝트 밖의 미디어는 미리볼 수 없습니다.' })
    return
  }
  await sendStaticFile(res, target, req)
}

async function handleStoryboardRender(req, res, workspaceRoot, commandRunner) {
  const body = await readJsonBody(req, 2 * 1024 * 1024)
  const projectName = String(body.projectName ?? 'story-project')
  const scenes = Array.isArray(body.scenes) ? body.scenes : []
  if (scenes.length === 0) {
    sendJson(res, 400, { ok: false, error: '영상화할 이미지 장면이 없습니다.' })
    return
  }

  const projectDir = projectDirFromName(workspaceRoot, projectName)
  const storyboardPath = join(projectDir, 'storyboard.yaml')
  const outputDir = join(projectDir, 'story-video')
  const storyboard = {
    projectName,
    title: String(body.title ?? projectName),
    productName: String(body.productName ?? 'Story Channel'),
    affiliateUrl: String(body.affiliateUrl ?? 'https://example.com/story'),
    disclosure: String(body.disclosure ?? 'AI 생성 또는 사용자가 제공한 이미지로 만든 영상입니다.'),
    imageRights: body.imageRights === 'owned' || body.imageRights === 'licensed' ? body.imageRights : 'ai_generated',
    scenes: scenes.map((scene, index) => ({
      image: String(scene.image ?? ''),
      narration: String(scene.narration ?? `장면 ${index + 1}`),
      caption: String(scene.caption ?? scene.narration ?? `장면 ${index + 1}`),
      durationSec: Number(scene.durationSec ?? 4),
    })),
  }

  await mkdir(projectDir, { recursive: true })
  await writeFile(storyboardPath, YAML.stringify(storyboard), 'utf8')
  const args = ['storyboard-render', storyboardPath, '--out-dir', outputDir]
  const result = await commandRunner({
    command: 'storyboard-render',
    projectPath: storyboardPath,
    workspaceRoot,
    args,
    outputDir,
  })
  sendJson(res, 200, {
    ok: result.exitCode === 0,
    command: 'storyboard-render',
    projectPath: storyboardPath,
    outputDir,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  })
}

function normalizeImageProvider(value) {
  if (value === 'gemini') return 'gemini'
  if (value === 'dropshot') return 'dropshot'
  if (value === 'leaders_nano_banana_pro' || value === 'leaders') return 'leaders_nano_banana_pro'
  if (value === 'mock') return 'mock'
  return 'gpt'
}

function imageProviderEnv(provider, body) {
  if (provider === 'gpt') {
    return body.apiKey ? { OPENAI_API_KEY: String(body.apiKey) } : {}
  }
  if (provider === 'gemini') {
    return body.apiKey ? { GEMINI_API_KEY: String(body.apiKey) } : {}
  }
  if (provider === 'leaders_nano_banana_pro') {
    const env = {}
    if (body.apiKey) env.LEADERS_NANO_BANANA_API_KEY = String(body.apiKey)
    if (body.endpoint) env.LEADERS_NANO_BANANA_ENDPOINT = String(body.endpoint)
    return env
  }
  return {}
}

function normalizeCaptionProvider(value) {
  return value === 'mock' ? 'mock' : 'local-whisper'
}

/**
 * STT 전용 venv의 파이썬 — 롱폼 자막 엔진(WhisperX)이 여기 설치된다.
 * **실행 위치(cwd)가 아니라 워크스페이스 기준**으로 찾는다.
 * 패키지된 앱은 어디서 실행될지 알 수 없어서, cwd로 찾으면 설치 여부를 잘못 판단한다(실측).
 */
function whisperxPython(workspaceRoot) {
  for (const candidate of [
    process.env.SF_WHISPERX_PYTHON,
    join(workspaceRoot, '.venv-stt', 'Scripts', 'python.exe'),
    join(workspaceRoot, '.venv-stt', 'bin', 'python'),
  ]) {
    if (candidate && existsSync(candidate)) return candidate
  }
  return null
}

function captionToolSpecs(workspaceRoot) {
  return [
    {
      id: 'ffmpeg',
      label: 'FFmpeg',
      command: findExecutable('ffmpeg', 'FFMPEG_PATH') || 'ffmpeg',
      args: ['-version'],
      installHint: 'winget install Gyan.FFmpeg 또는 FFMPEG_PATH 환경변수로 ffmpeg.exe 경로를 지정하세요.',
    },
    {
      id: 'ffprobe',
      label: 'FFprobe',
      command: findExecutable('ffprobe', 'FFPROBE_PATH') || 'ffprobe',
      args: ['-version'],
      installHint: 'FFmpeg 설치 후 PATH를 새로고침하거나 FFPROBE_PATH 환경변수로 ffprobe.exe 경로를 지정하세요.',
    },
    {
      // 롱폼 자막 탭이 쓰는 엔진. 전용 venv(.venv-stt)에 설치한다.
      id: 'whisperx',
      label: '롱폼 자막 엔진(WhisperX)',
      command: whisperxPython(workspaceRoot) ?? 'python',
      args: ['-c', 'import whisperx'],
      installHint:
        '설치 안내: 저장소 폴더에서 py -3.13 -m venv .venv-stt → .venv-stt/Scripts/python -m pip install whisperx. ' +
        'GPU를 쓰려면 CUDA용 torch도 함께 설치하세요.',
    },
    {
      id: 'local-whisper',
      label: '구버전 Whisper(선택)',
      command: findExecutable('whisper', 'WHISPER_BIN') || process.env.WHISPER_BIN || 'whisper',
      args: ['--help'],
      installHint:
        '없어도 됩니다 — 롱폼 자막은 WhisperX를 씁니다. 프로젝트 자동자막(구버전)에만 필요합니다. ' +
        '필요하면 python -m pip install -U openai-whisper.',
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

function firstOutputLine(value) {
  return String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean)
}

function checkCaptionTool(spec) {
  return new Promise((resolveTool) => {
    if (spec.id === 'local-whisper' && existsSync(spec.command)) {
      resolveTool({
        id: spec.id,
        label: spec.label,
        command: spec.command,
        available: true,
        version: 'whisper.exe 감지됨',
        installHint: spec.installHint,
      })
      return
    }
    let child
    try {
      child = spawn(spec.command, spec.args, {
        windowsHide: true,
        shell: false,
      })
    } catch (error) {
      resolveTool({
        id: spec.id,
        label: spec.label,
        command: spec.command,
        available: false,
        version: error instanceof Error ? error.message : String(error),
        installHint: spec.installHint,
      })
      return
    }
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      resolveTool({
        id: spec.id,
        label: spec.label,
        command: spec.command,
        available: false,
        version: 'timeout',
        installHint: spec.installHint,
      })
    }, 6000)

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveTool({
        id: spec.id,
        label: spec.label,
        command: spec.command,
        available: false,
        version: error.message,
        installHint: spec.installHint,
      })
    })
    child.on('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveTool({
        id: spec.id,
        label: spec.label,
        command: spec.command,
        available: exitCode === 0,
        version: firstOutputLine(`${stdout}\n${stderr}`),
        installHint: spec.installHint,
      })
    })
  })
}

async function handleCaptionStatus(res, workspaceRoot) {
  const tools = await Promise.all(captionToolSpecs(workspaceRoot).map((spec) => checkCaptionTool(spec)))
  const hasTool = (id) => tools.some((tool) => tool.id === id && tool.available)
  sendJson(res, 200, {
    ok: true,
    tools,
    localWhisperReady: hasTool('ffmpeg') && hasTool('local-whisper'),
    // 롱폼 자막 탭이 실제로 필요로 하는 조합
    longformReady: hasTool('ffmpeg') && hasTool('whisperx'),
  })
}

async function handleStoryImagesGenerate(req, res, workspaceRoot, commandRunner) {
  const body = await readJsonBody(req, 2 * 1024 * 1024)
  const projectName = String(body.projectName ?? 'story-images')
  const provider = normalizeImageProvider(body.provider)
  const projectDir = projectDirFromName(workspaceRoot, projectName)
  const inputPath = join(projectDir, 'story-image-input.yaml')
  const outDir = join(projectDir, 'story-generated')
  const input = {
    projectName,
    title: String(body.title ?? projectName),
    script: String(body.script ?? ''),
    imageStyle: String(body.imageStyle ?? '세로형 9:16 쇼츠용 장면, 한국 배경과 한국인 인물, 사실적인 실사풍, 선명한 피사체, 이미지 안에 글자 없음'),
    productName: String(body.productName ?? 'Story Channel'),
    affiliateUrl: String(body.affiliateUrl ?? 'https://example.com/story'),
    sceneDurationSec: Number(body.sceneDurationSec ?? 4),
  }
  if (!input.script.trim()) {
    sendJson(res, 400, { ok: false, error: '이미지를 만들 대본이 필요합니다.' })
    return
  }

  await mkdir(projectDir, { recursive: true })
  await writeFile(inputPath, YAML.stringify(input), 'utf8')

  const args = ['generate-story-images', inputPath, '--provider', provider, '--out-dir', outDir]
  if (body.model) args.push('--model', String(body.model))
  const result = await commandRunner({
    command: 'generate-story-images',
    projectPath: inputPath,
    workspaceRoot,
    args,
    outDir,
    env: imageProviderEnv(provider, body),
  })

  let storyboard = null
  let report = null
  if (result.exitCode === 0) {
    try {
      storyboard = JSON.parse(await readFile(join(outDir, 'storyboard.json'), 'utf8'))
      report = JSON.parse(await readFile(join(outDir, 'image_generation_report.json'), 'utf8'))
    } catch {
      // The command may be mocked in tests. stdout/stderr still carries the result.
    }
  }

  sendJson(res, 200, {
    ok: result.exitCode === 0,
    command: 'generate-story-images',
    provider,
    inputPath,
    outDir,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    storyboard,
    report,
  })
}

async function handleCaptionGenerate(req, res, workspaceRoot, commandRunner) {
  const body = await readJsonBody(req, 1024 * 1024)
  const projectPath = String(body.projectPath ?? '')
  const resolvedPath = resolveWorkspacePath(workspaceRoot, projectPath)
  const args = ['auto-caption', resolvedPath, '--json']
  if (body.clipFile) args.push('--clip', String(body.clipFile))
  args.push('--provider', normalizeCaptionProvider(body.provider))
  if (body.language) args.push('--language', String(body.language))
  if (body.model) args.push('--model', String(body.model))
  if (body.modelDir) args.push('--model-dir', String(body.modelDir))
  if (body.minChars !== undefined) args.push('--min-chars', String(body.minChars))
  if (body.maxChars !== undefined) args.push('--max-chars', String(body.maxChars))
  if (body.whisperBin) args.push('--whisper-bin', String(body.whisperBin))

  const result = await commandRunner({
    command: 'auto-caption',
    projectPath: resolvedPath,
    workspaceRoot,
    args,
  })

  const report = parseJsonObjectFromText(result.stdout)
  sendJson(res, 200, {
    ok: result.exitCode === 0,
    command: 'auto-caption',
    projectPath: resolvedPath,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    report,
  })
}

async function handleCaptionSave(req, res, workspaceRoot) {
  const body = await readJsonBody(req, 1024 * 1024)
  const projectPath = String(body.projectPath ?? '')
  const srtFile = String(body.srtFile ?? '').trim()
  if (!srtFile) {
    sendJson(res, 400, { ok: false, error: 'SRT 파일 경로가 필요합니다.' })
    return
  }

  const projectDir = resolveWorkspacePath(workspaceRoot, projectPath)
  const target = isAbsolute(srtFile) ? resolveWorkspacePath(workspaceRoot, srtFile) : resolve(projectDir, srtFile)
  if (!safeStartsWith(target, projectDir) || !safeStartsWith(target, workspaceRoot)) {
    sendJson(res, 403, { ok: false, error: '프로젝트 폴더 밖에는 자막을 저장할 수 없습니다.' })
    return
  }

  const cues = Array.isArray(body.cues) ? body.cues : []
  const content = serializeSrt(cues)
  await mkdir(dirname(target), { recursive: true })
  await writeFile(target, content, 'utf8')
  sendJson(res, 200, {
    ok: true,
    srtFile: target,
    cueCount: content ? cues.map(normalizeSrtCue).filter((cue) => cue.text).length : 0,
  })
}

async function handleSilenceAnalyze(req, res, workspaceRoot, commandRunner) {
  const body = await readJsonBody(req, 1024 * 1024)
  const projectPath = String(body.projectPath ?? '')
  const resolvedPath = resolveWorkspacePath(workspaceRoot, projectPath)
  const args = ['analyze-silence', resolvedPath, '--json']
  if (body.clipFile) args.push('--clip', String(body.clipFile))
  if (body.noiseDb !== undefined) args.push('--noise-db', String(body.noiseDb))
  if (body.minDurationSec !== undefined) args.push('--min-duration', String(body.minDurationSec))
  if (body.paddingSec !== undefined) args.push('--padding', String(body.paddingSec))

  const result = await commandRunner({
    command: 'analyze-silence',
    projectPath: resolvedPath,
    workspaceRoot,
    args,
  })

  const report = parseJsonObjectFromText(result.stdout)
  // 실패 원인이 모달/상태창에 그대로 보이게 최상위 error로 올린다(과거엔 "요청 실패"로 뭉개졌음).
  const failDetail =
    result.exitCode === 0
      ? undefined
      : report?.error ||
        [result.stderr, result.stdout]
          .map((value) => String(value ?? '').trim())
          .filter(Boolean)
          .join(' ')
          .split('\n')
          .filter(Boolean)
          .at(-1)
          ?.slice(0, 300) ||
        '무음 분석 실패 — 진단 로그를 확인하세요.'
  sendJson(res, 200, {
    ok: result.exitCode === 0,
    error: failDetail,
    command: 'analyze-silence',
    projectPath: resolvedPath,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    report,
  })
}

/**
 * 클립 오디오 파형(물결) PNG — 타임라인 오디오 레인 배경용.
 * <project>/waveforms/에 캐시하고 원본이 바뀌면 다시 만든다. start/end를 주면 그 구간만 그린다.
 */
async function handleMediaWaveform(url, res, workspaceRoot, req = null) {
  const mediaFile = String(url.searchParams.get('file') ?? '')
  if (!mediaFile.trim()) {
    sendJson(res, 400, { ok: false, error: '파형을 만들 파일 경로가 필요합니다.' })
    return
  }
  const projectPath = url.searchParams.get('projectPath')
  const projectName = url.searchParams.get('projectName')
  const projectDir = projectPath
    ? resolveWorkspacePath(workspaceRoot, projectPath)
    : projectDirFromName(workspaceRoot, projectName ?? 'new-project')
  const target = resolve(projectDir, mediaFile)
  if (!safeStartsWith(target, projectDir) || !safeStartsWith(target, workspaceRoot)) {
    sendJson(res, 403, { ok: false, error: '프로젝트 밖의 미디어는 사용할 수 없습니다.' })
    return
  }
  const sourceInfo = await stat(target).catch(() => null)
  if (!sourceInfo?.isFile()) {
    sendJson(res, 404, { ok: false, error: `파일을 찾을 수 없습니다: ${mediaFile}` })
    return
  }
  const start = Number(url.searchParams.get('start'))
  const end = Number(url.searchParams.get('end'))
  const hasRange = Number.isFinite(start) && Number.isFinite(end) && end > start
  const wavesDir = join(projectDir, 'waveforms')
  const cacheName =
    safeFileName(mediaFile.replace(/[\\/]/g, '_'), 'clip') +
    (hasRange ? `.${start.toFixed(2)}-${end.toFixed(2)}` : '') +
    '.png'
  const outPath = join(wavesDir, cacheName)
  const cached = await stat(outPath).catch(() => null)
  if (!cached || cached.mtimeMs < sourceInfo.mtimeMs) {
    await mkdir(wavesDir, { recursive: true })
    const ffmpeg = findExecutable('ffmpeg', 'FFMPEG_PATH') || 'ffmpeg'
    const filter =
      'aformat=channel_layouts=mono' +
      (hasRange ? `,atrim=${start.toFixed(3)}:${end.toFixed(3)}` : '') +
      ',showwavespic=s=1200x96:colors=#7fb0ff'
    try {
      await runToolCapture(ffmpeg, ['-y', '-i', target, '-filter_complex', filter, '-frames:v', '1', outPath])
    } catch (error) {
      sendJson(res, 200, { ok: false, error: `파형 생성 실패(오디오 없는 클립일 수 있음): ${error.message}` })
      return
    }
  }
  await sendStaticFile(res, outPath, req)
}

function voiceNameFrom(value) {
  // 한글 이름 허용, 경로/URL에 위험한 문자만 제거
  const cleaned = safeFileName(value, 'voice').replace(/\s+/g, '-')
  return cleaned || 'voice'
}

/** typecast:<voice_id> 형태의 클라우드 성우 목소리인지 확인한다. */
function isTypecastVoice(value) {
  return String(value ?? '').startsWith('typecast:')
}

/** CLI --voice 인자 — 타입캐스트 성우는 원본 id 그대로, 파일 목소리는 안전한 이름으로. */
function cliVoiceArg(value) {
  return isTypecastVoice(value) ? String(value).trim() : voiceNameFrom(value)
}

/** 요청 본문의 타입캐스트 키를 CLI 환경변수로 옮긴다(디스크/로그에 남기지 않는다). */
function typecastEnvFrom(body) {
  return body?.typecastApiKey ? { TYPECAST_API_KEY: String(body.typecastApiKey) } : {}
}

function ffmpegConvertToWav(inputPath, outputPath) {
  const ffmpeg = findExecutable('ffmpeg', 'FFMPEG_PATH') || 'ffmpeg'
  // 목소리 샘플용 정리 체인 — 복제 목소리의 원천이므로 여기가 제일 중요하다.
  // 저역 컷(100Hz) + 방 울림이 뭉치는 저중역(250Hz 부근) 감쇠 + 클릭/배경 잡음 제거 + 명료 대역 살짝 보강.
  const cleanupFilter = [
    'highpass=f=100',
    'equalizer=f=250:t=q:w=1.2:g=-3.5',
    'adeclick',
    'afftdn=nf=-27',
    'equalizer=f=3000:t=q:w=1.2:g=1.5',
  ].join(',')
  return new Promise((resolveConvert, rejectConvert) => {
    const child = spawn(
      ffmpeg,
      ['-y', '-i', inputPath, '-af', cleanupFilter, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', outputPath],
      { windowsHide: true, shell: false },
    )
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => rejectConvert(new Error(`ffmpeg 실행 실패: ${error.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolveConvert()
      else rejectConvert(new Error(`음성 변환 실패(ffmpeg ${code}): ${stderr.split('\n').slice(-3).join(' ')}`))
    })
  })
}

function ffmpegConvertToGif(inputPath, outputPath) {
  const ffmpeg = findExecutable('ffmpeg', 'FFMPEG_PATH') || 'ffmpeg'
  // palettegen/paletteuse 2패스를 한 필터 그래프로: 작은 용량 + 깨끗한 색
  const filter = 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse'
  return new Promise((resolveConvert, rejectConvert) => {
    const child = spawn(ffmpeg, ['-y', '-i', inputPath, '-filter_complex', filter, outputPath], {
      windowsHide: true,
      shell: false,
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => rejectConvert(new Error(`ffmpeg 실행 실패: ${error.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolveConvert()
      else rejectConvert(new Error(`GIF 변환 실패(ffmpeg ${code}): ${stderr.split('\n').slice(-3).join(' ')}`))
    })
  })
}

async function handleExportGif(req, res, workspaceRoot) {
  const body = await readJsonBody(req)
  const projectDir = resolveWorkspacePath(workspaceRoot, String(body.projectPath ?? ''))
  const sourceName = safeFileName(String(body.file ?? 'video_01.mp4'), 'video_01.mp4')
  const inputPath = join(projectDir, 'output', sourceName)
  if (!existsSync(inputPath)) {
    sendJson(res, 404, { ok: false, error: `렌더된 영상이 없습니다: output/${sourceName}. 먼저 MP4 내보내기(렌더)를 실행하세요.` })
    return
  }
  const outputPath = inputPath.replace(/\.[^.]+$/, '.gif')
  await ffmpegConvertToGif(inputPath, outputPath)
  sendJson(res, 200, { ok: true, gifFile: outputPath })
}

// ── 대본 자동 생성: API(GPT/Gemini/Claude) 또는 로컬 에이전트(Claude Code/Codex) ──

/** 형식별 품질 기준 — 어떤 주제든 그 형식의 끝판왕 대본이 나오게 한다. */
async function generatePolishedScript(method, apiKey, prompt, durationSec, format, genre, polish = true, tone = '') {
  void polish
  const useResearch = RESEARCH_GENRES.has(genre)
  const angles = [
    ' 접근 각도: 이 주제에서 가장 강력한 정공법 구성으로 써라.',
    ' 접근 각도: 뻔하지 않은 의외의 시점이나 설정으로 써라.',
  ]
  const drafts = (
    await Promise.all(
      angles.map((angle) => generateWithMethod(method, apiKey, prompt + angle, useResearch).catch(() => '')),
    )
  )
    .map((text) => text.trim())
    .filter(Boolean)
  if (drafts.length === 0) throw new Error('대본 생성에 실패했습니다. 잠시 후 다시 시도하세요.')
  if (drafts.length === 1) return drafts[0]
  try {
    const judged = (
      await generateWithMethod(method, apiKey, judgePrompt(drafts, durationSec, format, genre, tone), false, true)
    ).trim()
    return judged || drafts[0]
  } catch {
    return drafts[0]
  }
}

async function fetchJsonOrThrow(url, init) {
  const response = await fetch(url, init)
  const text = await response.text()
  if (!response.ok) throw new Error(`API 오류(${response.status}): ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

function findAgentBinary(name, envName) {
  if (process.env[envName] && existsSync(process.env[envName])) return resolve(process.env[envName])
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (!entry) continue
    for (const ext of exts) {
      const candidate = join(entry, `${name}${ext}`)
      if (existsSync(candidate)) return resolve(candidate)
    }
  }
  return null
}

function runAgentCommand(binary, args, timeoutMs = 180000, stdinText = null) {
  return new Promise((resolveRun, rejectRun) => {
    // 중첩 실행 방지: 이 앱이 Claude Code 안에서 실행됐을 때 상속되는 세션 변수를 제거한다.
    const env = { ...process.env }
    for (const key of Object.keys(env)) {
      if (key === 'CLAUDECODE' || key.startsWith('CLAUDE_CODE_')) delete env[key]
    }
    const spawnOptions = {
      windowsHide: true,
      shell: false,
      env,
      cwd: homedir(), // 프로젝트 폴더 컨텍스트를 읽지 않게 중립 위치에서 실행
      // 한글 프롬프트는 cmd 셔틀 인자로 넘기면 cp949로 깨지므로 stdin(UTF-8)으로 전달한다.
      stdio: [stdinText === null ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    }
    // .cmd/.bat은 Node 20.12+에서 shell:false 스폰이 막혀 있어 cmd /c로 감싼다.
    const isCmdShim = /\.(cmd|bat)$/i.test(binary)
    const child = isCmdShim
      ? spawn('cmd', ['/c', binary, ...args], spawnOptions)
      : spawn(binary, args, spawnOptions)
    if (stdinText !== null) child.stdin.end(stdinText, 'utf8')
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      rejectRun(new Error('에이전트 응답 시간 초과(3분). 로그인 상태를 확인하세요.'))
    }, timeoutMs)
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      rejectRun(new Error(`에이전트 실행 실패: ${error.message}`))
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code === 0) resolveRun(stdout.trim())
      else {
        const detail = [stderr, stdout].map((s) => s.trim()).filter(Boolean).join(' | ')
        rejectRun(new Error(`에이전트 오류(${code}): ${detail.split('\n').slice(-4).join(' ').slice(0, 300) || '출력 없음'}`))
      }
    })
  })
}

/** 웹 리서치가 실제로 도움이 되는 장르(사실 기반)만 검색을 허용해 시간을 아낀다. */

const RESEARCH_GENRES = new Set(['경제', '과학', '고전·역사썰', '미스터리·미제', '상식·꿀팁'])

async function generateWithMethod(method, apiKey, prompt, useResearch = false, fastModel = false, images = []) {
  if (method === 'api-gpt') {
    if (!apiKey) throw new Error('OpenAI API 키가 필요합니다. 환경설정에서 입력하세요.')
    const data = await fetchJsonOrThrow('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'user', content: images.length > 0 ? openaiVisionContent(prompt, images) : prompt },
        ],
      }),
    })
    return data.choices?.[0]?.message?.content ?? ''
  }
  if (method === 'api-gemini') {
    if (!apiKey) throw new Error('Gemini API 키가 필요합니다. 환경설정에서 입력하세요.')
    const data = await fetchJsonOrThrow(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: images.length > 0 ? geminiVisionParts(prompt, images) : [{ text: prompt }] }],
        }),
      },
    )
    return data.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  }
  if (method === 'api-claude') {
    if (!apiKey) throw new Error('Claude API 키가 필요합니다. 환경설정에서 입력하세요.')
    const data = await fetchJsonOrThrow('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 8000,
        messages: [
          { role: 'user', content: images.length > 0 ? claudeVisionContent(prompt, images) : prompt },
        ],
      }),
    })
    return data.content?.[0]?.text ?? ''
  }
  if (images.length > 0) {
    // 에이전트 CLI(stdin 텍스트)로는 이미지를 넘길 수 없다 — API 방식에서만 지원.
    throw new Error('이미지 분석은 API 방식(GPT/Gemini/Claude 키)에서만 가능합니다. 환경설정에서 키를 입력하세요.')
  }
  if (method === 'agent-claude') {
    const binary = findAgentBinary('claude', 'CLAUDE_BIN')
    if (!binary) throw new Error('Claude Code CLI를 찾을 수 없습니다. 설치: npm install -g @anthropic-ai/claude-code')
    if (!agentLoggedIn('claude')) throw new Error('Claude Code 세션이 없거나 만료되었습니다. 환경설정에서 다시 로그인하세요.')
    // 사실 기반 장르에서만 웹 검색을 허용한다(창작 장르는 검색이 시간만 잡아먹는다).
    const args = useResearch ? ['-p', '--allowedTools', 'WebSearch'] : ['-p']
    if (fastModel) args.push('--model', 'haiku')
    return runAgentCommand(binary, args, 420000, prompt)
  }
  if (method === 'agent-gemini') {
    // Antigravity는 헤드리스 CLI가 없어 앱이 부를 수 없다 — 같은 구글 계열인 Gemini CLI를 쓴다.
    const binary = findAgentBinary('gemini', 'GEMINI_BIN')
    if (!binary) throw new Error('Gemini CLI를 찾을 수 없습니다. 설치: npm install -g @google/gemini-cli')
    return runAgentCommand(binary, ['-p', prompt], 420000)
  }
  if (method === 'agent-codex') {
    const binary = findAgentBinary('codex', 'CODEX_BIN')
    if (!binary) throw new Error('Codex CLI를 찾을 수 없습니다. 설치: npm install -g @openai/codex')
    if (!agentLoggedIn('codex')) throw new Error('Codex 세션이 없거나 만료되었습니다. 환경설정에서 다시 로그인하세요.')
    return runAgentCommand(binary, ['exec', '--skip-git-repo-check', '-'], 420000, prompt)
  }
  throw new Error(`알 수 없는 생성 방식: ${method}`)
}

async function handleScriptGenerate(req, res) {
  const body = await readJsonBody(req)
  const topic = String(body.topic ?? '').trim()
  const method = String(body.method ?? 'api-gpt')
  const apiKey = String(body.apiKey ?? '').trim()
  // 쿠팡 쇼핑쇼츠 모드 — 주제 대신 상품 정보로 바이럴 대본을 만든다.
  const coupangInfo =
    body.mode === 'coupang' && body.productInfo && typeof body.productInfo === 'object'
      ? body.productInfo
      : null
  if (!topic && !coupangInfo) {
    sendJson(res, 400, { ok: false, error: '먼저 주제를 입력하세요.' })
    return
  }
  const seriesEpisode = Math.max(0, Number(body.seriesEpisode) || 0)
  const seriesPrevious = String(body.seriesPrevious ?? '').trim().slice(0, 600)
  const durationSec = Math.min(600, Math.max(15, Number(body.durationSec) || 30))
  const format = String(body.format ?? '').trim().slice(0, 30)
  const genre = String(body.genre ?? '').trim().slice(0, 30)
  const polish = body.polish !== false
  const tone = String(body.tone ?? '').trim().slice(0, 20)
  let script = ''
  let episodes = null

  if (seriesEpisode > 1 && !seriesPrevious) {
    // 이전 화 줄거리가 없으면 1화부터 요청한 회차까지 전체 시리즈를 순서대로 완성한다.
    episodes = []
    for (let ep = 1; ep <= seriesEpisode; ep++) {
      const episodeScript = await generatePolishedScript(
        method,
        apiKey,
        seriesArcPrompt(topic, ep, seriesEpisode, episodes, durationSec, format, genre, tone),
        durationSec,
        format,
        genre,
        polish,
        tone,
      )
      if (!episodeScript.trim()) throw new Error(`${ep}화 대본이 비어 있습니다. 다시 시도하세요.`)
      episodes.push(episodeScript.trim())
    }
    script = episodes[seriesEpisode - 1]
  } else {
    script = await generatePolishedScript(
      method,
      apiKey,
      coupangInfo
        ? coupangViralPrompt(coupangInfo, durationSec, tone)
        : scriptPrompt(topic, seriesEpisode > 0 ? { episode: seriesEpisode, previous: seriesPrevious } : null, durationSec, format, genre, tone) +
            ` ${COHERENCE_RULES}`,
      durationSec,
      format,
      genre,
      polish,
      tone,
    )
  }

  if (!script.trim()) throw new Error('대본이 비어 있습니다. 다시 시도하세요.')
  sendJson(res, 200, { ok: true, script: script.trim(), episodes })
}

/** 쿠팡 캡처 분석 — 프로젝트에 업로드된 캡처에서 상품 정보를 추출한다(비전 API 전용). */
async function handleCoupangAnalyze(req, res, workspaceRoot) {
  const body = await readJsonBody(req)
  const projectName = safeProjectName(body.projectName ?? '')
  const relPaths = Array.isArray(body.images) ? body.images.filter(Boolean).map(String) : []
  if (relPaths.length === 0) {
    sendJson(res, 400, { ok: false, error: '분석할 캡처 이미지를 먼저 업로드하세요.' })
    return
  }
  const method = String(body.method ?? 'api-gpt')
  const apiKey = String(body.apiKey ?? '').trim()
  const projectDir = projectDirFromName(workspaceRoot, projectName)
  const images = []
  for (const rel of relPaths.slice(0, 5)) {
    const abs = join(projectDir, rel)
    if (!safeStartsWith(abs, projectDir)) {
      sendJson(res, 403, { ok: false, error: '허용되지 않은 경로입니다.' })
      return
    }
    const info = await stat(abs).catch(() => null)
    if (!info?.isFile()) {
      sendJson(res, 400, { ok: false, error: `캡처 파일을 찾을 수 없습니다: ${rel}` })
      return
    }
    // 비전 API의 이미지 한도(클로드 5MB)를 넘기지 않게 미리 거른다.
    if (info.size > 5 * 1024 * 1024) {
      sendJson(res, 400, { ok: false, error: `캡처가 너무 큽니다(5MB 초과): ${rel} — 화면을 나눠서 캡처해 주세요.` })
      return
    }
    const data = await readFile(abs)
    images.push({ base64: data.toString('base64'), mimeType: captureMimeType(rel) })
  }
  try {
    const raw = await generateWithMethod(method, apiKey, coupangVisionPrompt(), false, true, images)
    const productInfo = parseCoupangProductInfo(raw)
    if (!productInfo || !productInfo.productName) {
      sendJson(res, 200, {
        ok: false,
        error: '캡처에서 상품 정보를 읽지 못했습니다. 상품명이 보이는 화면으로 다시 캡처하거나 아래 칸에 직접 입력하세요.',
      })
      return
    }
    sendJson(res, 200, { ok: true, productInfo })
  } catch (error) {
    sendJson(res, 200, { ok: false, error: String(error?.message ?? error) })
  }
}

/** 에이전트 로그인 여부 — CLI가 저장하는 자격증명 파일 존재로 판정한다. */
function agentLoggedIn(agent) {
  if (agent === 'gemini') {
    // Gemini CLI는 홈 폴더에 설정을 남긴다.
    return existsSync(join(homedir(), '.gemini'))
  }
  if (agent === 'claude') {
    if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return true
    return existsSync(join(homedir(), '.claude', '.credentials.json'))
  }
  return existsSync(join(homedir(), '.codex', 'auth.json'))
}

// ── 대본 보관함: 생성/작성한 대본을 파일로 저장하고 다시 불러온다 ──

function scriptLibraryPath(workspaceRoot) {
  return join(workspaceRoot, 'projects', 'scripts-library.json')
}

async function readScriptLibrary(workspaceRoot) {
  try {
    return JSON.parse(await readFile(scriptLibraryPath(workspaceRoot), 'utf8'))
  } catch {
    return []
  }
}

async function writeScriptLibrary(workspaceRoot, entries) {
  await mkdir(join(workspaceRoot, 'projects'), { recursive: true })
  await writeFile(scriptLibraryPath(workspaceRoot), JSON.stringify(entries, null, 2), 'utf8')
}

async function handleScriptsList(res, workspaceRoot) {
  sendJson(res, 200, { ok: true, scripts: await readScriptLibrary(workspaceRoot) })
}

async function handleScriptSave(req, res, workspaceRoot) {
  const body = await readJsonBody(req)
  const script = String(body.script ?? '').trim()
  if (!script) {
    sendJson(res, 400, { ok: false, error: '저장할 대본이 없습니다.' })
    return
  }
  const entries = await readScriptLibrary(workspaceRoot)
  const entry = {
    id: `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    title: String(body.title ?? '').trim().slice(0, 80) || script.split(/\r?\n/)[0].slice(0, 40),
    topic: String(body.topic ?? '').slice(0, 80),
    genre: String(body.genre ?? '').slice(0, 30),
    format: String(body.format ?? '').slice(0, 30),
    tone: String(body.tone ?? '').slice(0, 20),
    durationSec: Number(body.durationSec) || 30,
    script,
    episodes: Array.isArray(body.episodes) ? body.episodes.map((text) => String(text)) : null,
    audio: String(body.audio ?? '').slice(0, 300) || null,
    savedAt: new Date().toISOString(),
  }
  entries.unshift(entry)
  await writeScriptLibrary(workspaceRoot, entries.slice(0, 200))
  sendJson(res, 200, { ok: true, id: entry.id })
}

async function handleScriptDelete(pathname, res, workspaceRoot) {
  const id = pathname.split('/').pop()
  const entries = await readScriptLibrary(workspaceRoot)
  const next = entries.filter((entry) => entry.id !== id)
  await writeScriptLibrary(workspaceRoot, next)
  sendJson(res, 200, { ok: true, removed: entries.length - next.length })
}

// ── 앱 조종 비서: 클로드코드 CLI를 MCP로 붙여 앱 기능을 도구로 쓰게 한다 ──

/** 대화는 한 번에 하나만 — 동시에 여러 개를 돌리면 구독 한도만 태운다. */
let assistantRuntime = null

/**
 * 승인 게이트 — 위험한 도구(렌더·덮어쓰기·취소)는 MCP 서버가 여기에 먼저 물어본다.
 * 대화 스트림이 열려 있으면 UI에 카드로 띄우고 사용자의 대답을 기다린다.
 * 대화 밖에서 온 호출은 물어볼 사람이 없으므로 그대로 통과시킨다.
 */
const pendingApprovals = new Map()
let assistantStream = null

const APPROVAL_TIMEOUT_MS = 300000

function settleApproval(id, approved, reason) {
  const pending = pendingApprovals.get(id)
  if (!pending) return false
  pendingApprovals.delete(id)
  clearTimeout(pending.timer)
  pending.resolve({ approved, reason })
  return true
}

/** 대화가 끝나거나 중단되면 대기 중인 승인은 전부 거절로 정리한다(도구가 영원히 매달리지 않게). */
function clearPendingApprovals(reason) {
  for (const id of [...pendingApprovals.keys()]) settleApproval(id, false, reason)
}

async function handleAssistantApprovalRequest(req, res) {
  const body = await readJsonBody(req)
  if (!assistantStream) {
    sendJson(res, 200, { ok: true, approved: true, reason: '대화 밖 호출 — 자동 승인' })
    return
  }
  const id = `ap-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
  const decision = await new Promise((resolveApproval) => {
    const timer = setTimeout(() => settleApproval(id, false, '5분 안에 답이 없어 취소했습니다.'), APPROVAL_TIMEOUT_MS)
    pendingApprovals.set(id, { resolve: resolveApproval, timer })
    assistantStream({ type: 'approval', id, tool: String(body.tool ?? ''), input: body.input ?? {} })
  })
  sendJson(res, 200, { ok: true, ...decision })
}

async function handleAssistantApprove(req, res) {
  const body = await readJsonBody(req)
  const id = String(body.id ?? '')
  const approved = body.approved === true
  const settled = settleApproval(id, approved, approved ? null : '사용자가 취소했습니다.')
  sendJson(res, settled ? 200 : 404, { ok: settled, ...(settled ? {} : { error: '이미 끝난 승인 요청입니다.' }) })
}

// ── 자막 지우기: 영상에 박힌 자막을 배경으로 메운다 ──

async function handleSubtitleErase(req, res, workspaceRoot) {
  const body = await readJsonBody(req)
  const mediaPath = String(body.mediaPath ?? '').trim()
  if (!mediaPath || !existsSync(mediaPath)) {
    sendJson(res, 400, { ok: false, error: '영상 파일을 찾을 수 없습니다.' })
    return
  }

  const python = whisperxPython(workspaceRoot)
  if (!python) {
    sendJson(res, 200, {
      ok: false,
      error: '자막 지우기 엔진이 없습니다. 롱폼 자막 탭에서 "엔진 설치"를 먼저 실행하세요.',
    })
    return
  }

  const runPython = async (args) => {
    try {
      const result = await execFileAsync(python, args, { timeout: 1000 * 60 * 120, maxBuffer: 32 * 1024 * 1024 })
      return { ok: true, stderr: result.stderr ?? '' }
    } catch (error) {
      const detail = String(error?.stderr ?? error?.message ?? '').trim().split('\n').slice(-4).join('\n')
      return { ok: false, error: detail || '자막 지우기에 실패했습니다.' }
    }
  }

  const result = await eraseSubtitles(
    mediaPath,
    { runPython, scriptPath: join(PROGRAM_ROOT, 'scripts', 'subtitle_erase.py') },
    {
      preview: body.preview === true,
      mode: String(body.mode ?? 'background'),
      target: String(body.target ?? 'subtitle'),
      box: body.box ? String(body.box) : 'auto',
      startSec: Number(body.startSec) || 0,
      durationSec: Number(body.durationSec) || 0,
      mediaSeconds: Number(body.mediaSeconds) || 0,
    },
  )
  sendJson(res, 200, result)
}

// ── 자동 편집: 받아쓰기 → 자를 후보 → (확인) → 컷 적용 ──

/** 분석 결과를 잠깐 들고 있는다 — 사용자가 확인하는 동안 다시 받아쓰지 않게. */
const autoEditCache = new Map()

async function loadAutoEditModules() {
  const [reformat, autoCut] = await Promise.all([
    import('../dist/subtitles/reformat.js'),
    import('../dist/edit/autoCut.js'),
  ])
  return { subtitles: { reformatSubtitles: reformat.reformatSubtitles }, autoCut }
}

/**
 * 검수 화면이 쓰는 영상 — 사용자가 고른 파일을 그대로 내보낸다.
 *
 * 기존 미리보기 엔드포인트는 projects/ 안으로 제한돼 있어 바깥 영상을 못 연다.
 * 자동 편집은 사용자가 직접 고른 아무 경로나 다루므로 별도로 둔다(서버는 127.0.0.1 전용이고,
 * 분석·자르기가 이미 같은 경로를 받는다).
 */
async function handleAutoEditMedia(url, res, req) {
  const mediaPath = String(url.searchParams.get('mediaPath') ?? '').trim()
  if (!mediaPath || !existsSync(mediaPath)) {
    sendJson(res, 404, { ok: false, error: '영상을 찾을 수 없습니다.' })
    return
  }
  await sendStaticFile(res, mediaPath, req)
}

/** 타임라인에 그릴 파형 — 말 없는 구간이 납작하게 보여야 자를 곳이 눈에 띈다. */
async function handleAutoEditPeaks(url, res) {
  const mediaPath = String(url.searchParams.get('mediaPath') ?? '').trim()
  const buckets = Math.min(60000, Math.max(100, Number(url.searchParams.get('buckets')) || 1200))
  if (!mediaPath || !existsSync(mediaPath)) {
    sendJson(res, 404, { ok: false, error: '영상을 찾을 수 없습니다.' })
    return
  }
  try {
    const ffmpeg = findExecutable('ffmpeg', 'FFMPEG_PATH') || 'ffmpeg'
    const { stdout } = await execFileAsync(ffmpeg, buildPeaksArgs(mediaPath), {
      encoding: 'buffer',
      maxBuffer: 256 * 1024 * 1024,
      timeout: 1000 * 60 * 5,
    })
    const samples = new Int16Array(stdout.buffer, stdout.byteOffset, Math.floor(stdout.length / 2))
    sendJson(res, 200, { ok: true, peaks: bucketPeaks(samples, buckets) })
  } catch (error) {
    sendJson(res, 200, { ok: false, error: '파형을 만들지 못했습니다: ' + String(error?.message ?? error).slice(0, 200) })
  }
}

/** 받아쓰기가 어디까지 갔는지 — 화면이 막대로 보여준다. 파이썬이 적어 둔 진짜 값이다. */
async function handleAutoEditProgress(url, res) {
  const mediaPath = String(url.searchParams.get('mediaPath') ?? '').trim()
  if (!mediaPath) {
    sendJson(res, 400, { ok: false, error: '영상 경로가 없습니다.' })
    return
  }
  const { progressPathFor } = await import('../dist/captions/whisperx.js')
  sendJson(res, 200, await readAutoEditProgress(mediaPath, { readFile, progressPathFor }))
}

/** ① 받아쓰기 + 후보 뽑기. 실제 자르기는 하지 않는다. */
async function handleAutoEditAnalyze(req, res, workspaceRoot, commandRunner) {
  const body = await readJsonBody(req)
  const mediaPath = String(body.mediaPath ?? '').trim()
  if (!mediaPath || !existsSync(mediaPath)) {
    sendJson(res, 400, { ok: false, error: '영상 또는 음성 파일을 찾을 수 없습니다.' })
    return
  }

  const { subtitles, autoCut } = await loadAutoEditModules()
  const transcribe = async (path) => {
    const args = ['longform-stt', path, '--json']
    if (body.language) args.push('--language', String(body.language))
    const result = await commandRunner({ command: 'longform-stt', projectPath: path, workspaceRoot, args })
    const report = parseJsonObjectFromText(result.stdout)
    if (!report?.ok) throw new Error(report?.error || '받아쓰기에 실패했습니다.')
    return report.cues ?? []
  }

  try {
    const analysis = await analyzeForAutoEdit(mediaPath, { transcribe, subtitles, autoCut }, {
      strength: String(body.strength ?? 'normal'),
    })
    if (!analysis.ok) {
      sendJson(res, 200, analysis)
      return
    }
    autoEditCache.set(mediaPath, { totalMs: analysis.totalMs, cues: analysis.cues, at: Date.now() })
    sendJson(res, 200, { ...analysis, cues: undefined })
  } catch (error) {
    sendJson(res, 200, { ok: false, error: String(error?.message ?? error) })
  }
}

/** ② 사용자가 고른 구간만 실제로 자른다. */
async function handleAutoEditApply(req, res, workspaceRoot, commandRunner) {
  const body = await readJsonBody(req, 4 * 1024 * 1024)
  const mediaPath = String(body.mediaPath ?? '').trim()
  const cached = autoEditCache.get(mediaPath)
  const totalMs = Number(body.totalMs) || cached?.totalMs || 0
  // 원인마다 다른 안내를 준다 — 셋을 한 메시지로 뭉치면 사용자가 뭘 고쳐야 할지 모른다.
  if (!mediaPath || !existsSync(mediaPath)) {
    sendJson(res, 400, { ok: false, error: `영상 파일을 찾을 수 없습니다: ${mediaPath || '(경로 없음)'}` })
    return
  }
  if (totalMs <= 0) {
    sendJson(res, 400, { ok: false, error: '먼저 "자를 곳 찾기"를 실행하세요.' })
    return
  }
  if (!Array.isArray(body.selected) || body.selected.length === 0) {
    sendJson(res, 400, { ok: false, error: '자를 구간을 하나도 고르지 않았습니다.' })
    return
  }

  const { autoCut } = await loadAutoEditModules()
  const runCommand = async (args) => {
    const result = await commandRunner({ command: 'apply-cuts', projectPath: mediaPath, workspaceRoot, args })
    const report = parseJsonObjectFromText(result.stdout)
    return report?.ok
      ? { ok: true, outPath: report.outPath }
      : { ok: false, error: report?.error || String(result.stderr ?? '').slice(-300) }
  }

  const selected = Array.isArray(body.selected) ? body.selected : []
  const result = await applySelectedCuts(
    mediaPath,
    selected,
    totalMs,
    { autoCut, writeFile, runCommand },
    { smoothJoin: body.smoothJoin !== false },
  )
  sendJson(res, 200, result)
}

// ── 롱폼 자막 엔진(WhisperX) 설치 ──

/** 설치는 한 번에 하나만. 워크스페이스가 바뀔 일이 없으므로 모듈 수준에 둔다. */
let sttInstaller = null

function getInstaller(workspaceRoot) {
  if (!sttInstaller) sttInstaller = createInstaller({ workspaceRoot })
  return sttInstaller
}

async function handleSttEngineStatus(res, workspaceRoot) {
  const installer = getInstaller(workspaceRoot)
  sendJson(res, 200, { ok: true, ...installer.status(), installed: isEngineInstalled(workspaceRoot) })
}

async function handleSttEngineInstall(req, res, workspaceRoot) {
  const body = await readJsonBody(req)
  const installer = getInstaller(workspaceRoot)
  const result = await installer.start({ cuda: body.cuda !== false })
  sendJson(res, 200, { ok: true, ...result, ...installer.status() })
}

// ── 롱폼 자막: 영상/음성 하나 → 정렬 SRT + 공백메움 SRT + 검수 리포트 ──

/** 순수 변환 모듈은 빌드 산출물(dist)에서 가져온다 — 로직을 서버에 복제하지 않는다. */
async function loadSubtitleModules() {
  const [srt, reformat, gaps, audit, correct, script, glossary] = await Promise.all([
    import('../dist/subtitles/srt.js'),
    import('../dist/subtitles/reformat.js'),
    import('../dist/subtitles/gaps.js'),
    import('../dist/subtitles/audit.js'),
    import('../dist/subtitles/correct.js'),
    import('../dist/subtitles/script.js'),
    import('../dist/subtitles/glossary.js'),
  ])
  return {
    subtitles: {
      reformatSubtitles: reformat.reformatSubtitles,
      fillGaps: gaps.fillGaps,
      serializeSrt: srt.serializeSrt,
      auditSubtitles: audit.auditSubtitles,
      summarizeAudit: audit.summarizeAudit,
    },
    correct,
    script,
    glossary,
  }
}

/** 용어 사전을 받아쓰기 힌트 한 줄로 만든다(모듈은 dist에 있으므로 지연 로딩). */
async function glossaryHint(text) {
  if (!String(text ?? '').trim()) return ''
  const glossary = await import('../dist/subtitles/glossary.js')
  return glossary.glossaryHint(glossary.parseGlossary(text))
}

async function handleLongformCaptions(req, res, workspaceRoot, commandRunner) {
  const body = await readJsonBody(req, 2 * 1024 * 1024)
  const mediaPath = String(body.mediaPath ?? '').trim()
  if (!mediaPath || !existsSync(mediaPath)) {
    sendJson(res, 400, { ok: false, error: '영상 또는 음성 파일을 찾을 수 없습니다.' })
    return
  }

  // ① 세밀 STT — 무거운 일이라 CLI(WhisperX)에 맡긴다.
  const script = String(body.script ?? '').trim()
  const sttArgs = ['longform-stt', mediaPath, '--json']
  if (body.language) sttArgs.push('--language', String(body.language))
  if (body.model) sttArgs.push('--model', String(body.model))
  // 대본 앞부분과 용어 사전을 받아쓰기 힌트로 넘긴다 — 고유명사·숫자를 처음부터 맞게 받아쓴다.
  const glossaryText = String(body.glossary ?? '')
  const hintParts = [script.slice(0, 300), await glossaryHint(glossaryText)].filter(Boolean)
  if (hintParts.length > 0) sttArgs.push('--initial-prompt', hintParts.join(' ').slice(0, 400))
  const sttResult = await commandRunner({
    command: 'longform-stt',
    projectPath: mediaPath,
    workspaceRoot,
    args: sttArgs,
  })
  const sttReport = parseJsonObjectFromText(sttResult.stdout)
  if (sttResult.exitCode !== 0 || !sttReport?.ok || !Array.isArray(sttReport.cues) || sttReport.cues.length === 0) {
    const detail = sttReport?.error || [sttResult.stderr, sttResult.stdout].map((v) => String(v ?? '').trim()).filter(Boolean).join(' ').slice(-300)
    sendJson(res, 200, { ok: false, error: `받아쓰기 실패: ${detail || '결과가 비어 있습니다.'}` })
    return
  }

  const { subtitles, correct, script: scriptModule, glossary: glossaryModule } = await loadSubtitleModules()
  let cues = sttReport.cues
  let correction = null

  // ② 대본 대조 보정 — 대본이 있을 때만. 시각은 건드리지 않고 텍스트만 고친다.
  if (script) {
    const askModel = (prompt) =>
      generateWithMethod(String(body.method ?? 'agent-claude'), String(body.apiKey ?? '').trim(), prompt, false, true)
    correction = await correctWithScript(cues, script, { askModel, correct })
    cues = correction.cues
  }

  // ②-b 대본이 없어도 문맥 교정을 한 번 돌린다(사용자가 켠 경우).
  let proofread = null
  if (!script && body.proofread === true) {
    const askModel = (prompt) =>
      generateWithMethod(String(body.method ?? 'agent-claude'), String(body.apiKey ?? '').trim(), prompt, false, true)
    proofread = await proofreadCues(cues, glossaryText, { askModel, correct, glossary: glossaryModule })
    cues = proofread.cues
  }

  // ②-c 용어 사전 — 고정된 오타를 규칙으로 바로잡는다(시각은 그대로).
  const parsedGlossary = glossaryModule.parseGlossary(glossaryText)
  const glossaryResult = glossaryModule.applyGlossary(cues, parsedGlossary)
  cues = glossaryResult.cues

  // ③④⑤ 재편성 → 공백 메움 → 검수
  const result = await buildLongformOutputs(cues, mediaPath, { subtitles, writeFile }, {
    minChars: Number(body.minChars) || 18,
    maxChars: Number(body.maxChars) || 44,
  })

  // 영상이면 자막을 바로 얹어 완성본까지 만든다(원클릭).
  let burned = null
  const burnMode = String(body.burn ?? 'none')
  if (burnMode === 'burn' || burnMode === 'mux') {
    // 화면 자막은 한 줄에 들어갈 길이로 다시 나눈다(어절이 두 줄로 쪼개지는 것 방지).
    const burnSrt = await buildBurnSrt(cues, mediaPath, { subtitles, writeFile }, {
      burnMaxChars: Number(body.burnMaxChars) || 26,
    })
    const burnResult = await commandRunner({
      command: 'burn-captions',
      projectPath: mediaPath,
      workspaceRoot,
      args: [
        'burn-captions',
        mediaPath,
        '--srt',
        burnSrt.path,
        '--mode',
        burnMode,
        '--preset',
        String(body.stylePreset ?? 'basic'),
        ...(body.fontSize ? ['--font-size', String(body.fontSize)] : []),
        ...(body.outline ? ['--outline', String(body.outline)] : []),
        ...(body.color ? ['--color', String(body.color)] : []),
        ...(body.outlineColor ? ['--outline-color', String(body.outlineColor)] : []),
        ...(body.position ? ['--position', String(body.position)] : []),
        ...(body.bold === true ? ['--bold'] : []),
        ...(body.box === true ? ['--box'] : []),
        '--json',
      ],
    })
    const burnReport = parseJsonObjectFromText(burnResult.stdout)
    burned = burnReport?.ok
      ? { path: burnReport.outPath, mode: burnMode, srt: burnSrt.path, cueCount: burnSrt.cueCount }
      : { error: burnReport?.error || String(burnResult.stderr ?? '').trim().slice(-300) || '자막 넣기에 실패했습니다.' }
  }

  // 대본이 없던 영상이면 받아쓴 내용으로 대본 파일을 만들어 준다.
  const method = String(body.method ?? 'agent-claude')
  const apiKey = String(body.apiKey ?? '').trim()
  const wantsScript = body.makeScript !== false
  const scriptFile = wantsScript
    ? await buildScriptFile(cues, mediaPath, {
        script: scriptModule,
        writeFile,
        askModel: (prompt) => generateWithMethod(method, apiKey, prompt, false, true),
      }, { polish: body.polishScript === true })
    : null

  // 중간 파일 정리 — 영상까지 만들었을 때만.
  const keep = ['video', 'script', 'all'].includes(String(body.keep)) ? String(body.keep) : 'script'
  const tidied = await tidyOutputs(mediaPath, keep, Boolean(burned?.path))

  sendJson(res, 200, {
    ok: true,
    mediaPath,
    keep,
    removedFiles: tidied.removed.length,
    sttCueCount: sttReport.cues.length,
    correction: correction ? { batches: correction.batches, failedBatches: correction.failedBatches } : null,
    proofread: proofread ? { batches: proofread.batches, failedBatches: proofread.failedBatches } : null,
    glossaryFixed: glossaryResult.changed,
    scriptFile,
    burned,
    ...result,
  })
}

async function handleAssistantStatus(res) {
  sendJson(res, 200, {
    ok: true,
    installed: Boolean(findAgentBinary('claude', 'CLAUDE_BIN')),
    loggedIn: agentLoggedIn('claude'),
    busy: Boolean(assistantRuntime?.busy),
  })
}

async function handleAssistantCancel(res) {
  clearPendingApprovals('사용자가 대화를 중단했습니다.')
  const cancelled = Boolean(assistantRuntime?.cancel())
  sendJson(res, 200, { ok: true, cancelled })
}

/** 대화 한 턴 — 진행 상황을 SSE로 흘린다(도구 호출·텍스트·완료). */
async function handleAssistantChat(req, res, workspaceRoot) {
  const body = await readJsonBody(req)
  if (assistantRuntime?.busy) {
    sendJson(res, 409, { ok: false, error: '이미 대화가 진행 중입니다. 먼저 중단하세요.' })
    return
  }
  assistantRuntime = createAssistantRuntime({
    apiBase: `http://${req.headers.host}`,
    serverScript: join(PROGRAM_ROOT, 'scripts', 'mcp', 'shorts-mcp.mjs'),
    claudeBinary: findAgentBinary('claude', 'CLAUDE_BIN'),
    defaults: { method: body.method ? String(body.method) : undefined, apiKey: body.apiKey ? String(body.apiKey) : undefined },
  })

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  const send = (event) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  // 사용자가 창을 닫거나 새로고침하면 CLI도 같이 정리한다(좀비·비용 방지).
  req.on('close', () => {
    if (!res.writableEnded) assistantRuntime?.cancel()
  })

  assistantStream = send
  try {
    await assistantRuntime.chat({
      message: String(body.message ?? ''),
      sessionId: body.sessionId ? String(body.sessionId) : null,
      model: body.model ? String(body.model) : null,
      onEvent: send,
    })
  } catch (error) {
    send({ type: 'error', message: String(error?.message ?? error) })
  } finally {
    clearPendingApprovals('대화가 끝나 승인 요청을 취소했습니다.')
    assistantStream = null
  }
  res.end()
}

async function handleAgentsStatus(res) {
  sendJson(res, 200, {
    ok: true,
    agents: {
      claude: {
        installed: Boolean(findAgentBinary('claude', 'CLAUDE_BIN')),
        loggedIn: agentLoggedIn('claude'),
      },
      codex: {
        installed: Boolean(findAgentBinary('codex', 'CODEX_BIN')),
        loggedIn: agentLoggedIn('codex'),
      },
      gemini: {
        installed: Boolean(findAgentBinary('gemini', 'GEMINI_BIN')),
        loggedIn: agentLoggedIn('gemini'),
      },
    },
  })
}

async function handleAgentLogin(req, res) {
  const body = await readJsonBody(req)
  const agent = body.agent === 'codex' ? 'codex' : 'claude'
  if (agent === 'codex') {
    const binary = findAgentBinary('codex', 'CODEX_BIN')
    if (!binary) {
      sendJson(res, 200, { ok: false, message: 'Codex CLI가 없습니다. 설치: npm install -g @openai/codex' })
      return
    }
    // codex login은 스스로 브라우저를 열므로 CMD 창 없이 숨김 실행한다.
    const child = /\.(cmd|bat)$/i.test(binary)
      ? spawn('cmd', ['/c', binary, 'login'], { detached: true, windowsHide: true, shell: false, stdio: 'ignore' })
      : spawn(binary, ['login'], { detached: true, windowsHide: true, shell: false, stdio: 'ignore' })
    child.unref()
    sendJson(res, 200, { ok: true, message: '브라우저에서 Codex 로그인을 완료하세요. 완료되면 아래 상태가 자동으로 바뀝니다.' })
    return
  }
  // claude는 대화형 터미널(/login)이 필요해서 터미널 창을 띄운다.
  spawn('cmd', ['/c', 'start', 'Claude Code 로그인', 'cmd', '/k', 'claude'], {
    detached: true,
    windowsHide: false,
    shell: false,
  }).unref()
  sendJson(res, 200, { ok: true, message: '터미널에서 /login 을 입력해 로그인하세요. 완료되면 아래 상태가 자동으로 바뀝니다.' })
}

// ── 드롭샷(나노바나나프로) 로그인 관리 ──

async function loadDropshotModule() {
  return import('./dropshot-generator.mjs')
}

async function handleDropshotStatus(res) {
  const mod = await loadDropshotModule()
  const status = await mod.checkDropshotLogin()
  // 서버 프로세스가 브라우저(프로필)를 들고 있으면 이미지 생성 CLI가
  // 같은 프로필을 못 열어 images 단계가 통째로 실패한다 — 확인 후 반드시 닫는다.
  await mod.closeDropshotBrowser?.()
  sendJson(res, 200, { ok: true, ...status })
}

async function handleDropshotLogin(res) {
  const mod = await loadDropshotModule()
  const result = await mod.loginDropshot()
  await mod.closeDropshotBrowser?.()
  sendJson(res, 200, { ok: result.loggedIn, ...result })
}

// 갤러리가 다루는 미디어 폴더들 — 조회/삭제 모두 이 안에서만 허용한다.
const GALLERY_IMAGE_DIRS = ['pipeline/images', 'story-generated/images', 'images']
const GALLERY_VIDEO_DIRS = ['pipeline/motion', 'pipeline/video/output', 'story-video/output', 'output']
const GALLERY_MEDIA_RE = /\.(png|jpe?g|webp|mp4|webm|mov)$/i

/** 프로젝트의 대본 제목을 읽는다(story-input.yaml). 없으면 null. */
async function readProjectTitle(projectsDir, project) {
  try {
    const raw = await readFile(join(projectsDir, project, 'story-input.yaml'), 'utf8')
    const parsed = YAML.parse(raw)
    const title = String(parsed?.title ?? '').trim()
    return title || null
  } catch {
    return null
  }
}

/** 프로젝트 목록 — project.yaml이 있는 폴더만, 최근 수정순. 에이전트·UI가 프로젝트를 찾는 창구. */
async function handleProjectsList(res, workspaceRoot) {
  const { readdir } = await import('node:fs/promises')
  const projectsDir = join(workspaceRoot, 'projects')
  let entries = []
  try {
    entries = await readdir(projectsDir, { withFileTypes: true })
  } catch {
    /* 프로젝트 폴더가 아직 없음 */
  }
  const projects = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const projectFile = join(projectsDir, entry.name, 'project.yaml')
    const info = await stat(projectFile).catch(() => null)
    if (!info?.isFile()) continue
    projects.push({
      name: entry.name,
      title: await readProjectTitle(projectsDir, entry.name),
      projectPath: `projects/${entry.name}`,
      updatedAt: info.mtime.toISOString(),
    })
  }
  projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  sendJson(res, 200, { ok: true, projects })
}

/** 모든 프로젝트에서 생성된 이미지 모음(갤러리) — 최신순. */
async function handleGalleryImages(res, workspaceRoot) {
  const { readdir } = await import('node:fs/promises')
  const projectsDir = join(workspaceRoot, 'projects')
  const images = []
  let projectNames = []
  try {
    projectNames = await readdir(projectsDir)
  } catch {
    /* 프로젝트 폴더가 아직 없음 */
  }
  for (const project of projectNames) {
    let title = null
    const dirGroups = [
      { dirs: GALLERY_IMAGE_DIRS, type: 'image', pattern: /\.(png|jpe?g|webp)$/i },
      { dirs: GALLERY_VIDEO_DIRS, type: 'video', pattern: /\.(mp4|webm|mov)$/i },
    ]
    for (const { dirs, type, pattern } of dirGroups) {
      for (const rel of dirs) {
        try {
          for (const file of await readdir(join(projectsDir, project, rel))) {
            if (!pattern.test(file)) continue
            if (title === null) title = (await readProjectTitle(projectsDir, project)) ?? ''
            const info = await stat(join(projectsDir, project, rel, file)).catch(() => null)
            images.push({
              project,
              type,
              title: title || project,
              file: `${rel}/${file}`,
              url: `/api/media/preview?projectPath=${encodeURIComponent(`projects/${project}`)}&file=${encodeURIComponent(`${rel}/${file}`)}`,
              savedAt: info ? info.mtime.toISOString() : '',
            })
          }
        } catch {
          /* 해당 폴더 없음 */
        }
      }
    }
  }
  images.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
  sendJson(res, 200, { ok: true, images })
}

/** 갤러리 이미지 삭제 — 허용된 이미지 폴더 안의 파일만 지운다. */
async function handleGalleryDelete(req, res, workspaceRoot) {
  const body = await readJsonBody(req)
  const project = safeProjectName(body.project)
  const file = String(body.file ?? '')
  const allowed =
    [...GALLERY_IMAGE_DIRS, ...GALLERY_VIDEO_DIRS].some((dir) => file.startsWith(`${dir}/`)) &&
    GALLERY_MEDIA_RE.test(file)
  const target = join(workspaceRoot, 'projects', project, file)
  const projectDir = join(workspaceRoot, 'projects', project)
  if (!allowed || !safeStartsWith(target, projectDir)) {
    sendJson(res, 400, { ok: false, error: '허용되지 않은 경로입니다.' })
    return
  }
  const { rm } = await import('node:fs/promises')
  await rm(target, { force: true })
  sendJson(res, 200, { ok: true })
}

/** 프로젝트의 갤러리 이미지 전체 삭제(허용된 이미지 폴더 안의 이미지 파일만). */
async function handleGalleryDeleteProject(req, res, workspaceRoot) {
  const body = await readJsonBody(req)
  const project = safeProjectName(body.project)
  const { readdir, rm } = await import('node:fs/promises')
  let deleted = 0
  for (const rel of [...GALLERY_IMAGE_DIRS, ...GALLERY_VIDEO_DIRS]) {
    const dir = join(workspaceRoot, 'projects', project, rel)
    try {
      for (const file of await readdir(dir)) {
        if (!GALLERY_MEDIA_RE.test(file)) continue
        await rm(join(dir, file), { force: true })
        deleted += 1
      }
    } catch {
      /* 해당 폴더 없음 */
    }
  }
  sendJson(res, 200, { ok: true, project, deleted })
}

/** 프로젝트에서 생성된 이미지 목록(파이프라인/스토리보드 산출물). */
async function handleProjectImages(requestUrl, res, workspaceRoot) {
  const projectName = safeProjectName(requestUrl.searchParams.get('projectName'))
  const projectDir = join(workspaceRoot, 'projects', projectName)
  const { readdir } = await import('node:fs/promises')
  const images = []
  for (const rel of ['pipeline/images', 'story-generated/images', 'images']) {
    try {
      const entries = await readdir(join(projectDir, rel))
      for (const file of entries) {
        if (/\.(png|jpe?g|webp)$/i.test(file)) images.push(`${rel}/${file}`)
      }
    } catch {
      /* 아직 생성 전이면 폴더가 없다 */
    }
  }
  images.sort()
  sendJson(res, 200, { ok: true, projectPath: `projects/${projectName}`, images })
}

// ── 낭독 스튜디오: 저장된 낭독 목록 + 속도/톤 변환 ──

async function handleNarrationsList(res, workspaceRoot) {
  const dir = join(workspaceRoot, 'projects', 'narrations')
  const { readdir } = await import('node:fs/promises')
  const items = []
  try {
    for (const file of await readdir(dir)) {
      if (!file.toLowerCase().endsWith('.wav')) continue
      const info = await stat(join(dir, file)).catch(() => null)
      const name = file.slice(0, -4)
      let metadata = null
      try {
        metadata = JSON.parse(await readFile(join(dir, `${name}.json`), 'utf8'))
      } catch {
        // 이전 버전에서 만든 wav는 메타데이터가 없다.
      }
      items.push({
        name,
        url: `/api/voices/audio?saved=${encodeURIComponent(name)}`,
        sizeKb: info ? Math.round(info.size / 1024) : 0,
        savedAt: info ? info.mtime.toISOString() : '',
        metadata,
      })
    }
  } catch {
    /* 폴더가 아직 없으면 빈 목록 */
  }
  items.sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1))
  sendJson(res, 200, { ok: true, narrations: items })
}

/** 속도(음정 유지 배속)와 톤(반음 단위 피치)을 조절한 새 wav를 만든다. */
async function handleNarrationAdjust(req, res, workspaceRoot) {
  const body = await readJsonBody(req)
  const name = voiceNameFrom(body.name)
  const speed = Math.min(2, Math.max(0.5, Number(body.speed) || 1))
  const pitch = Math.min(6, Math.max(-6, Math.round(Number(body.pitch) || 0)))
  const dir = join(workspaceRoot, 'projects', 'narrations')
  const inputPath = join(dir, `${name}.wav`)
  if (!existsSync(inputPath)) {
    sendJson(res, 404, { ok: false, error: `낭독 파일이 없습니다: ${name}` })
    return
  }
  const suffix = `x${speed}${pitch === 0 ? '' : pitch > 0 ? `+${pitch}키` : `${pitch}키`}`
  const outName = `${name}.${suffix}`
  const outputPath = join(dir, `${outName}.wav`)

  // 피치: 입력을 44100Hz로 통일한 뒤 asetrate로 음정·속도를 올리고 atempo로 속도만 되돌린다.
  // (TTS 출력이 24kHz라 샘플레이트를 가정하면 배속이 왜곡된다 — 실측으로 잡은 버그)
  const factor = Math.pow(2, pitch / 12)
  const filters = []
  if (pitch !== 0) {
    filters.push(
      'aresample=44100',
      `asetrate=44100*${factor.toFixed(6)}`,
      'aresample=44100',
      `atempo=${(1 / factor).toFixed(6)}`,
    )
  }
  if (speed !== 1) filters.push(`atempo=${speed}`)
  if (filters.length === 0) {
    sendJson(res, 400, { ok: false, error: '속도나 톤 중 하나는 바꿔야 합니다.' })
    return
  }

  const ffmpeg = findExecutable('ffmpeg', 'FFMPEG_PATH') || 'ffmpeg'
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(ffmpeg, ['-y', '-i', inputPath, '-af', filters.join(','), outputPath], {
      windowsHide: true,
      shell: false,
    })
    let stderr = ''
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => rejectRun(new Error(`ffmpeg 실행 실패: ${error.message}`)))
    child.on('close', (code) => {
      if (code === 0) resolveRun()
      else rejectRun(new Error(`변환 실패(ffmpeg ${code}): ${stderr.split('\n').slice(-3).join(' ')}`))
    })
  })

  sendJson(res, 200, {
    ok: true,
    name: outName,
    url: `/api/voices/audio?saved=${encodeURIComponent(outName)}`,
  })
}

/** 저장된 낭독 파일 이름 변경. */
async function handleNarrationRename(req, res, workspaceRoot) {
  const body = await readJsonBody(req)
  const from = voiceNameFrom(body.from)
  const to = voiceNameFrom(body.to)
  if (!from || !to || from === to) {
    sendJson(res, 400, { ok: false, error: '바꿀 이름을 확인해 주세요.' })
    return
  }
  const dir = join(workspaceRoot, 'projects', 'narrations')
  const fromPath = join(dir, `${from}.wav`)
  const toPath = join(dir, `${to}.wav`)
  if (!existsSync(fromPath)) {
    sendJson(res, 200, { ok: false, error: '원본 낭독 파일이 없습니다.' })
    return
  }
  if (existsSync(toPath)) {
    sendJson(res, 200, { ok: false, error: `'${to}' 이름의 낭독이 이미 있습니다.` })
    return
  }
  const { rename } = await import('node:fs/promises')
  await rename(fromPath, toPath)
  const fromMeta = join(dir, `${from}.json`)
  if (existsSync(fromMeta)) await rename(fromMeta, join(dir, `${to}.json`))
  sendJson(res, 200, { ok: true, name: to })
}

async function handleNarrationDelete(pathname, res, workspaceRoot) {
  const name = voiceNameFrom(decodeURIComponent(pathname.split('/').pop() ?? ''))
  const file = join(workspaceRoot, 'projects', 'narrations', `${name}.wav`)
  const { rm } = await import('node:fs/promises')
  await rm(file, { force: true })
  await rm(join(workspaceRoot, 'projects', 'narrations', `${name}.json`), { force: true })
  sendJson(res, 200, { ok: true })
}

async function handleVoiceDelete(pathname, res, workspaceRoot) {
  const raw = decodeURIComponent(pathname.split('/').pop() ?? '').trim()
  const name = voiceNameFrom(raw)
  // 경로 조작 문자가 섞여 정제 결과가 달라지면 거부한다.
  if (!raw || name !== raw.replace(/\s+/g, '-')) {
    sendJson(res, 400, { ok: false, error: '허용되지 않은 목소리 이름입니다.' })
    return
  }
  const voicesDir = join(workspaceRoot, 'voices')
  const wavPath = join(voicesDir, `${name}.wav`)
  if (!safeStartsWith(wavPath, voicesDir)) {
    sendJson(res, 400, { ok: false, error: '허용되지 않은 경로입니다.' })
    return
  }
  const { rm } = await import('node:fs/promises')
  await rm(wavPath, { force: true })
  await rm(join(voicesDir, `${name}.txt`), { force: true })
  sendJson(res, 200, { ok: true, name })
}

async function handleVoicesList(res, workspaceRoot) {
  const voicesDir = join(workspaceRoot, 'voices')
  let entries = []
  try {
    const { readdir } = await import('node:fs/promises')
    entries = await readdir(voicesDir)
  } catch {
    // voices 폴더가 아직 없으면 빈 목록
  }
  const voices = []
  for (const file of entries) {
    if (!file.toLowerCase().endsWith('.wav')) continue
    const name = file.slice(0, -4)
    const info = await stat(join(voicesDir, file)).catch(() => null)
    voices.push({
      name,
      hasTranscript: existsSync(join(voicesDir, `${name}.txt`)),
      size: info?.size ?? 0,
    })
  }
  sendJson(res, 200, { ok: true, voices })
}

/** 타입캐스트 성우 목록 프록시 — 키는 요청 헤더로만 받고 서버에 저장하지 않는다. */
async function handleTypecastVoices(req, res) {
  const apiKey = String(req.headers['x-typecast-key'] ?? '').trim()
  if (!apiKey) {
    sendJson(res, 400, { ok: false, error: '타입캐스트 API 키가 필요합니다. 환경설정에서 키를 입력하세요.' })
    return
  }
  const apiBase = (process.env.TYPECAST_API_BASE ?? 'https://api.typecast.ai').replace(/\/+$/, '')
  try {
    const upstream = await fetch(`${apiBase}/v2/voices`, {
      headers: { 'X-API-KEY': apiKey },
      signal: AbortSignal.timeout(15_000),
    })
    if (!upstream.ok) {
      sendJson(res, 200, {
        ok: false,
        error:
          upstream.status === 401 || upstream.status === 403
            ? '타입캐스트 API 키가 올바르지 않습니다. 환경설정에서 키를 확인하세요.'
            : `타입캐스트 성우 목록을 가져오지 못했습니다(HTTP ${upstream.status}).`,
      })
      return
    }
    const parsed = await upstream.json()
    const rawList = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.voices) ? parsed.voices : []
    const voices = rawList
      .map((entry) => ({
        id: String(entry.voice_id ?? entry.id ?? ''),
        name: String(entry.voice_name ?? entry.name ?? entry.voice_id ?? ''),
        ...(entry.model ? { model: String(entry.model) } : {}),
        ...(Array.isArray(entry.emotions) ? { emotions: entry.emotions } : {}),
      }))
      .filter((voice) => voice.id)
    sendJson(res, 200, { ok: true, voices })
  } catch (error) {
    sendJson(res, 200, { ok: false, error: `타입캐스트 연결 실패: ${error.message}` })
  }
}

async function handleVoiceSave(req, res, workspaceRoot) {
  const body = await readJsonBody(req, 60 * 1024 * 1024)
  const name = voiceNameFrom(body.name)
  const rawData = String(body.audioData ?? '').replace(/^data:[^,]+,/, '')
  if (!rawData) {
    sendJson(res, 400, { ok: false, error: '녹음/업로드된 음성 데이터가 없습니다.' })
    return
  }
  const voicesDir = join(workspaceRoot, 'voices')
  await mkdir(voicesDir, { recursive: true })
  const wavPath = join(voicesDir, `${name}.wav`)
  const format = String(body.format ?? 'wav').toLowerCase().replace(/[^a-z0-9]/g, '')

  // wav 업로드도 잡음 제거(클릭/배경 소음)를 거쳐 저장한다.
  const tmpPath = join(voicesDir, `.upload-${name}.${format || 'wav'}`)
  await writeFile(tmpPath, Buffer.from(rawData, 'base64'))
  try {
    await ffmpegConvertToWav(tmpPath, wavPath)
  } finally {
    const { rm } = await import('node:fs/promises')
    await rm(tmpPath, { force: true })
  }

  const transcript = String(body.transcript ?? '').trim()
  if (transcript) {
    await writeFile(join(voicesDir, `${name}.txt`), transcript, 'utf8')
  }
  // 목소리가 바뀌었으니 캐시된 테스트 샘플은 무효 — 다음 테스트 듣기 때 새로 만든다.
  {
    const { rm } = await import('node:fs/promises')
    const sampleBase = join(workspaceRoot, 'tmp', 'voice-test', `${name}.sample`)
    await rm(`${sampleBase}.wav`, { force: true })
    await rm(`${sampleBase}.txt`, { force: true })
  }
  sendJson(res, 200, { ok: true, name, hasTranscript: Boolean(transcript) })
}

async function handleVoiceAudio(url, res, workspaceRoot, req = null) {
  const name = url.searchParams.get('name')
  const test = url.searchParams.get('test')
  const saved = url.searchParams.get('saved')
  const baseDir = saved
    ? join(workspaceRoot, 'projects', 'narrations')
    : test
      ? join(workspaceRoot, 'tmp', 'voice-test')
      : join(workspaceRoot, 'voices')
  const file = join(baseDir, `${voiceNameFrom(saved ?? test ?? name)}.wav`)
  if (!safeStartsWith(file, baseDir)) {
    sendJson(res, 403, { ok: false, error: '허용되지 않은 경로입니다.' })
    return
  }
  await sendStaticFile(res, file, req)
}

// 문장 분리 — src/tts/chunk.ts의 splitSentences와 같은 규칙이어야 연출 계획 번호가 어긋나지 않는다.
async function inferDeliveryPlan(method, apiKey, text, styleId = 'natural', strength = 2, customInstruction = '') {
  const sentences = splitSentencesForDelivery(text)
  if (sentences.length === 0) return null
  const selected = resolveNarrationStyle(styleId, customInstruction)
  const fallback = buildPresetDeliveryPlan(sentences, selected.id, strength, customInstruction)
  if (!method || sentences.length < 3) return fallback
  try {
    const raw = await generateWithMethod(
      method,
      apiKey,
      deliveryPrompt(sentences, { label: selected.label, instruction: selected.instruction, strength }),
      false,
      true,
    )
    return parseDeliveryResponse(raw, sentences.length) ?? fallback
  } catch {
    return fallback
  }
}

// 실행 중인 낭독 작업 — 목소리 이름 → { child, cancelled }. 중지 요청 시 프로세스를 죽인다.
const activeVoiceTests = new Map()

/** 실행 중인 낭독을 중지한다(프로세스 종료). */
async function handleVoiceTestCancel(req, res, workspaceRoot) {
  const body = await readJsonBody(req)
  const voice = voiceNameFrom(body.voice)
  const track = activeVoiceTests.get(voice)
  if (!track) {
    sendJson(res, 200, { ok: false, error: '진행 중인 낭독이 없습니다.' })
    return
  }
  // 자식 프로세스가 아직 없어도(연출 분석 단계) 중지 표시를 남긴다 — 이후 단계가 시작되지 않는다.
  track.cancelled = true
  // 트리째 종료 — CLI만 죽이면 크로미움·ffmpeg 손자가 좀비로 남는다.
  killChildTree(track.child)
  // 진행 파일을 지워 게이지가 옛 상태를 보여주지 않게 한다.
  const { rm } = await import('node:fs/promises')
  await rm(join(workspaceRoot, 'tmp', 'voice-test', `${voice}.wav.progress.json`), { force: true })
  sendJson(res, 200, { ok: true, voice })
}

/** 낭독 진행 조회 — CLI가 남기는 <voice>.wav.progress.json을 읽는다(게이지바 폴링용). */
async function handleVoiceProgress(url, res, workspaceRoot) {
  const voice = voiceNameFrom(url.searchParams.get('voice'))
  const testDir = join(workspaceRoot, 'tmp', 'voice-test')
  const progressPath = join(testDir, `${voice}.wav.progress.json`)
  if (!safeStartsWith(progressPath, testDir)) {
    sendJson(res, 403, { ok: false, error: '허용되지 않은 경로입니다.' })
    return
  }
  let progress = null
  try {
    progress = JSON.parse(await readFile(progressPath, 'utf8'))
  } catch {
    // 아직 시작 전이면 진행 파일이 없다
  }
  sendJson(res, 200, { ok: true, progress })
}

/** 목소리 샘플(테스트 음성)이 이미 있는지 확인 — 있으면 재생성 없이 바로 듣는다. */
async function handleVoiceSampleCheck(url, res, workspaceRoot) {
  const voice = voiceNameFrom(url.searchParams.get('voice'))
  const samplePath = join(workspaceRoot, 'tmp', 'voice-test', `${voice}.sample.wav`)
  const exists = existsSync(samplePath)
  sendJson(res, 200, {
    ok: true,
    exists,
    url: exists ? `/api/voices/audio?test=${encodeURIComponent(`${voice}.sample`)}` : null,
  })
}

async function handleVoiceTest(req, res, workspaceRoot, commandRunner) {
  const body = await readJsonBody(req)
  const voice = voiceNameFrom(body.voice)
  // 기본 테스트 문장 — 약 30초 분량, 평서·의문·감탄을 섞어 억양과 끝음 처리를 확인할 수 있게.
  const text =
    String(body.text ?? '').trim() ||
    '안녕하세요, 지금 들리는 목소리는 제 목소리로 만든 테스트 나레이션입니다. ' +
      '억양이 자연스러운지, 문장 끝음이 부드럽게 떨어지는지 천천히 들어보세요. ' +
      '궁금한 게 하나 있는데요, 목소리가 또렷하게 들리시나요? ' +
      '좋아요, 이 정도 톤이면 어떤 대본이든 자연스럽게 읽을 수 있을 거예요. ' +
      '긴 이야기도, 짧은 광고 멘트도 문제없습니다. 오늘도 좋은 하루 보내세요.'
  // sample 모드: 표준 테스트 문장을 <voice>.sample.wav로 따로 저장해 두고 재사용한다
  // (대본 낭독이 <voice>.wav를 덮어써도 테스트 샘플은 살아남는다).
  const sampleMode = body.sample === true
  const base = sampleMode ? `${voice}.sample` : voice
  const testDir = join(workspaceRoot, 'tmp', 'voice-test')
  await mkdir(testDir, { recursive: true })
  const textFile = join(testDir, `${base}.txt`)
  const outWav = join(testDir, `${base}.wav`)

  // 같은 문장의 샘플이 이미 있으면 재생성하지 않는다(GPU 30초~1분 절약).
  if (sampleMode && existsSync(outWav)) {
    const previousText = await readFile(textFile, 'utf8').catch(() => '')
    if (previousText.trim() === text) {
      sendJson(res, 200, {
        ok: true,
        voice,
        cached: true,
        audioUrl: `/api/voices/audio?test=${encodeURIComponent(base)}`,
      })
      return
    }
  }
  // GPU는 하나뿐 — 낭독이 동시에 돌면 서로 대기시간을 늘려 타임아웃으로 둘 다 죽는다(실측: 70덩어리 2개 동시 사망).
  if (activeVoiceTests.size > 0) {
    sendJson(res, 200, {
      ok: false,
      busy: true,
      error: '이미 다른 낭독이 진행 중입니다. 끝나기를 기다리거나 중지한 뒤 다시 시도하세요.',
    })
    return
  }

  await writeFile(textFile, text, 'utf8')

  // 이전 실행의 진행 파일이 게이지에 섞이지 않게 지우고 시작한다.
  const progressPath = join(testDir, `${base}.wav.progress.json`)
  const { rm } = await import('node:fs/promises')
  await rm(progressPath, { force: true })

  const args = ['narrate', textFile, '--voice', cliVoiceArg(body.voice), '--out-dir', testDir]
  if (isTypecastVoice(body.voice)) args.push('--provider', 'typecast')
  else if (body.provider) args.push('--provider', String(body.provider))

  // 연출 분석 단계에서도 중지가 걸리게, 작업 시작 시점부터 등록한다.
  const track = { child: null, cancelled: false }
  activeVoiceTests.set(base, track)
  let result
  const requestedStyleId = String(body.styleId ?? '').trim()
  const styleStrength = Math.min(3, Math.max(1, Math.round(Number(body.styleStrength) || 2)))
  const customInstruction = String(body.customStyle ?? '').trim().slice(0, 500)
  const selectedStyle = resolveNarrationStyle(requestedStyleId || 'natural', customInstruction)
  let directed = false
  try {
    // 선택 말투는 항상 프리셋 계획으로 적용하고, AI 연출을 켜면 대본 문맥에 맞게 문장별로 세밀화한다.
    const shouldApplyStyle = Boolean(requestedStyleId) || Boolean(body.directed)
    if (shouldApplyStyle) {
      await writeFile(progressPath, JSON.stringify({ status: 'directing', updatedAt: new Date().toISOString() }), 'utf8')
      const plan = await inferDeliveryPlan(
        body.directed ? String(body.method ?? '') : '',
        String(body.apiKey ?? ''),
        text,
        selectedStyle.id,
        styleStrength,
        customInstruction,
      )
      if (plan && !track.cancelled) {
        const planPath = join(testDir, `${base}.delivery.json`)
        await writeFile(planPath, JSON.stringify(plan), 'utf8')
        args.push('--delivery', planPath)
        directed = Boolean(body.directed)
      }
    }

    // 연출 분석 중에 중지됐으면 낭독을 시작하지 않는다.
    if (track.cancelled) {
      sendJson(res, 200, { ok: false, cancelled: true, voice, error: '낭독을 중지했습니다.' })
      return
    }

    result = await commandRunner({
      command: 'narrate',
      projectPath: textFile,
      workspaceRoot,
      args,
      env: typecastEnvFrom(body),
      onSpawn: (child) => {
        track.child = child
      },
    })
    result.directed = directed
  } finally {
    activeVoiceTests.delete(base)
  }

  if (track.cancelled) {
    sendJson(res, 200, { ok: false, cancelled: true, voice, error: '낭독을 중지했습니다.' })
    return
  }
  directed = Boolean(result.directed)

  // keepAs가 있으면 임시 파일을 영구 보관 폴더(projects/narrations)로 복사한다.
  let savedAudioUrl = null
  if (result.exitCode === 0 && body.keepAs) {
    try {
      const { copyFile } = await import('node:fs/promises')
      const savedName = safeFileName(String(body.keepAs), `narration-${Date.now().toString(36)}`).replace(/\s+/g, '-')
      const narrationsDir = join(workspaceRoot, 'projects', 'narrations')
      await mkdir(narrationsDir, { recursive: true })
      await copyFile(outWav, join(narrationsDir, `${savedName}.wav`))
      await writeFile(
        join(narrationsDir, `${savedName}.json`),
        JSON.stringify(
          {
            styleId: selectedStyle.id,
            styleLabel: selectedStyle.label,
            styleStrength,
            customInstruction: customInstruction || undefined,
            directed,
            createdAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      )
      savedAudioUrl = `/api/voices/audio?saved=${encodeURIComponent(savedName)}`
    } catch {
      /* 보관 실패해도 미리듣기는 정상 동작 */
    }
  }

  // 실패하면 원인이 모달에 그대로 보이게 마지막 로그 줄을 error로 담는다.
  const failDetail =
    result.exitCode === 0
      ? undefined
      : `낭독 생성 실패: ${
          [result.stderr, result.stdout]
            .map((value) => String(value ?? '').trim())
            .filter(Boolean)
            .join(' | ')
            .split('\n')
            .filter(Boolean)
            .slice(-3)
            .join(' ')
            .slice(0, 300) || '원인 미상 — 다시 시도해 주세요.'
        }`

  sendJson(res, 200, {
    ok: result.exitCode === 0,
    voice,
    directed,
    style: {
      id: selectedStyle.id,
      label: selectedStyle.label,
      strength: styleStrength,
    },
    error: failDetail,
    audioUrl: `/api/voices/audio?test=${encodeURIComponent(base)}`,
    savedAudioUrl,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  })
}

async function handleNarrate(req, res, workspaceRoot, commandRunner) {
  const body = await readJsonBody(req)
  const storyboardPath = resolveWorkspacePath(workspaceRoot, String(body.storyboardPath ?? ''))
  const args = ['narrate', storyboardPath, '--voice', cliVoiceArg(body.voice)]
  if (isTypecastVoice(body.voice)) args.push('--provider', 'typecast')
  else if (body.provider) args.push('--provider', String(body.provider))
  if (body.outDir) args.push('--out-dir', resolveWorkspacePath(workspaceRoot, String(body.outDir)))
  const result = await commandRunner({
    command: 'narrate',
    projectPath: storyboardPath,
    workspaceRoot,
    args,
    env: typecastEnvFrom(body),
  })
  sendJson(res, 200, {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  })
}

async function handleScriptTemplates(res, workspaceRoot, commandRunner) {
  const result = await commandRunner({
    command: 'story-templates',
    projectPath: workspaceRoot,
    workspaceRoot,
    args: ['story-templates', '--json'],
  })
  const parsed = parseJsonObjectFromText(result.stdout)
  sendJson(res, 200, {
    ok: result.exitCode === 0 && Boolean(parsed?.templates),
    templates: parsed?.templates ?? [],
  })
}

// ── 비동기 잡: 긴 파이프라인을 즉시 응답 + 폴링으로 처리 ──
// 복수 작업은 큐에 쌓고 한 번에 하나씩 실행한다 — GPU(TTS)와 드롭샷 브라우저 프로필은
// 동시에 두 작업이 쓰면 서로 죽이기 때문(실측). UI는 전부 병렬로 보여준다.
const pipelineJobs = new Map()
const pipelineQueue = []
let pipelineJobActive = false

function createPipelineJob(fields) {
  const id = `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  const job = { id, status: 'queued', createdAt: new Date().toISOString(), ...fields }
  pipelineJobs.set(id, job)
  return job
}

function processPipelineQueue() {
  if (pipelineJobActive) return
  const next = pipelineQueue.shift()
  if (!next) return
  const { job, run } = next
  if (job.cancelled) {
    job.status = 'cancelled'
    processPipelineQueue()
    return
  }
  pipelineJobActive = true
  job.status = 'running'
  job.startedAt = new Date().toISOString()
  run()
    .then((result) => {
      job.status = job.cancelled ? 'cancelled' : result.exitCode === 0 ? 'done' : 'error'
      job.exitCode = result.exitCode
      job.stdout = result.stdout
      job.stderr = result.stderr
    })
    .catch((error) => {
      job.status = 'error'
      job.exitCode = 1
      job.stderr = error instanceof Error ? error.message : String(error)
    })
    .finally(() => {
      pipelineJobActive = false
      processPipelineQueue()
    })
}

/** 작업 하나의 공개 상태(진행 파일 포함)를 만든다. */
async function describePipelineJob(job) {
  let progress = null
  if (job.pipelineDir) {
    try {
      progress = JSON.parse(await readFile(join(job.pipelineDir, 'progress.json'), 'utf8'))
    } catch {
      /* 아직 없음 */
    }
  }
  return {
    id: job.id,
    projectName: job.projectName ?? null,
    title: job.title ?? job.projectName ?? null,
    status: job.status,
    createdAt: job.createdAt,
    startedAt: job.startedAt ?? null,
    exitCode: job.exitCode ?? null,
    finalVideo: job.finalVideo ?? null,
    progress: job.status === 'running' || job.status === 'done' || job.status === 'error' ? progress : null,
    logTail: job.status === 'running' ? (job.logLines ?? []).slice(-3) : undefined,
    stderrTail:
      job.status === 'error' ? String(job.stderr ?? '').split(/\r?\n/).slice(-4).join('\n') : undefined,
    queuePosition: job.status === 'queued' ? pipelineQueue.findIndex((entry) => entry.job.id === job.id) + 1 : undefined,
  }
}

/** 전체 작업 목록 — 최신 등록 순. */
async function handleJobsList(res) {
  const jobs = [...pipelineJobs.values()].slice(-12).reverse()
  sendJson(res, 200, { ok: true, jobs: await Promise.all(jobs.map(describePipelineJob)) })
}

/** 작업 취소 — 대기 중이면 큐에서 빼고, 실행 중이면 프로세스를 죽인다. */
async function handleJobCancel(pathname, res) {
  const id = pathname.split('/')[3]
  const job = pipelineJobs.get(id)
  if (!job) {
    sendJson(res, 404, { ok: false, error: '알 수 없는 작업입니다.' })
    return
  }
  job.cancelled = true
  if (job.status === 'queued') job.status = 'cancelled'
  // 트리째 종료 — CLI만 죽이면 크로미움·ffmpeg 손자가 좀비로 남는다.
  killChildTree(job.track?.child)
  sendJson(res, 200, { ok: true, id })
}

async function handleJobStatus(pathname, res) {
  const id = pathname.slice('/api/jobs/'.length)
  const job = pipelineJobs.get(id)
  if (!job) {
    sendJson(res, 404, { ok: false, error: '알 수 없는 잡입니다.' })
    return
  }
  let progress = null
  if (job.pipelineDir) {
    try {
      progress = JSON.parse(await readFile(join(job.pipelineDir, 'progress.json'), 'utf8'))
    } catch {
      // 아직 progress.json이 없을 수 있다
    }
  }

  // 회로차단기: CLI가 progress에 실패를 기록했는데 프로세스가 종료 신호를 못 보내고
  // 매달려 있으면 잡이 영원히 running으로 남는다(실측: UI가 "N초 경과"만 세는 사고).
  // 실패 기록이 30초 이상 그대로면 잡을 실패로 간주해 UI에 알린다.
  let status = job.status
  let stderrTail = job.status === 'error' ? String(job.stderr ?? '').split(/\r?\n/).slice(-6).join('\n') : undefined
  if (status === 'running' && progress?.status === 'error') {
    const staleMs = Date.now() - new Date(progress.updatedAt ?? 0).getTime()
    if (Number.isFinite(staleMs) && staleMs > 30_000) {
      status = 'error'
      stderrTail = `${progress.current ?? '?'} 단계 실패 — 진행 기록이 ${Math.round(staleMs / 1000)}초째 멈춰 있습니다. 다시 시도해 주세요.`
    }
  }

  sendJson(res, 200, {
    ok: true,
    id: job.id,
    status,
    exitCode: job.exitCode ?? null,
    finalVideo: job.finalVideo ?? null,
    projectName: job.projectName ?? null,
    progress,
    logTail: status === 'running' ? (job.logLines ?? []).slice(-4) : undefined,
    stderrTail,
  })
}

// ── AI 촬영감독: 장면별 숏 연출 추론 ──

// src/modes/story.ts의 splitStoryScript와 같은 규칙이어야 숏 배열이 장면 번호와 어긋나지 않는다.
async function inferShotPlan(method, apiKey, script, maxSceneChars, character) {
  const scenes = splitScenesForShots(script, maxSceneChars)
  if (scenes.length < 2) return null
  try {
    const raw = await generateWithMethod(method, apiKey, shotPrompt(scenes, character), false, true)
    return parseShotResponse(raw, scenes.length)
  } catch {
    return null
  }
}

/** 진단 로그 저장 — 최근 잡/CLI 기록/프로젝트 진행 상태를 파일로 만든다(기본: 바탕화면). */
async function handleDiagnosticsSave(req, res, workspaceRoot) {
  const body = await readJsonBody(req).catch(() => ({}))
  const os = await import('node:os')
  const targetDir = String(body.targetDir ?? '').trim() || join(os.homedir(), 'Desktop')
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const file = join(targetDir, `쇼츠팩토리-진단로그-${stamp}.txt`)

  const lines = []
  lines.push(`쇼츠팩토리 진단 로그 — ${new Date().toISOString()}`)
  lines.push(`platform: ${process.platform} / node: ${process.version}`)
  lines.push(`workspaceRoot: ${workspaceRoot}`)
  lines.push('')

  lines.push(`── 최근 파이프라인 잡 (${pipelineJobs.size}개) ──`)
  for (const job of [...pipelineJobs.values()].slice(-5)) {
    lines.push(`[${job.startedAt}] ${job.id} status=${job.status} exit=${job.exitCode ?? '-'} project=${job.projectName ?? '-'}`)
    if (job.stderr) lines.push(`  stderr(tail):\n${String(job.stderr).split(/\r?\n/).slice(-40).join('\n')}`)
    if (job.stdout) lines.push(`  stdout(tail):\n${String(job.stdout).split(/\r?\n/).slice(-25).join('\n')}`)
    lines.push('')
  }

  lines.push(`── 최근 CLI 실행 기록 (${diagnosticsEvents.length}건) ──`)
  for (const event of diagnosticsEvents.slice(-30)) {
    lines.push(`[${event.ts}] ${event.kind} ${event.command ?? ''} exit=${event.exitCode ?? '-'}`)
    if (event.args) lines.push(`  args: ${event.args}`)
    if (event.exitCode !== 0 && event.stderrTail) lines.push(`  stderr:\n${event.stderrTail}`)
    if (event.exitCode !== 0 && event.stdoutTail) lines.push(`  stdout:\n${event.stdoutTail}`)
    lines.push('')
  }

  lines.push('── 프로젝트 진행 상태 (progress.json) ──')
  try {
    const { readdir } = await import('node:fs/promises')
    const projectsDir = join(workspaceRoot, 'projects')
    for (const name of await readdir(projectsDir)) {
      const progressPath = join(projectsDir, name, 'pipeline', 'progress.json')
      if (existsSync(progressPath)) {
        lines.push(`${name}: ${(await readFile(progressPath, 'utf8')).replace(/\s+/g, ' ')}`)
      }
    }
  } catch {
    lines.push('(프로젝트 폴더 없음)')
  }

  await mkdir(targetDir, { recursive: true })
  await writeFile(file, lines.join('\n'), 'utf8')
  sendJson(res, 200, { ok: true, file })
}

async function handleStoryPipeline(req, res, workspaceRoot, commandRunner) {
  const body = await readJsonBody(req, 2 * 1024 * 1024)
  const projectName = safeProjectName(body.projectName ?? 'story-shorts')
  const script = String(body.script ?? '').trim()
  if (!script) {
    sendJson(res, 400, { ok: false, error: '대본(script)이 필요합니다.' })
    return
  }

  const projectDir = join(workspaceRoot, 'projects', projectName)
  const inputPath = join(projectDir, 'story-input.yaml')
  const pipelineDir = join(projectDir, 'pipeline')
  const ratio = body.ratio === '16:9' ? '16:9' : '9:16'
  const input = {
    projectName,
    title: String(body.title ?? projectName),
    script,
    imageStyle: String(
      body.imageStyle ??
        (ratio === '16:9'
          ? '가로형 16:9 롱폼 영상 장면, 한국 배경과 한국인 인물, 사실적인 실사풍, 선명한 피사체, 이미지 안에 글자 없음'
          : '세로형 9:16 쇼츠용 장면, 한국 배경과 한국인 인물, 사실적인 실사풍, 선명한 피사체, 이미지 안에 글자 없음'),
    ),
    maxSceneChars: Number(body.maxSceneChars ?? 60),
    sceneDurationSec: Number(body.sceneDurationSec ?? 4),
    ratio,
    ...(String(body.character ?? '').trim() ? { character: String(body.character).trim() } : {}),
    ...(body.promptProfile === 'product' ? { promptProfile: 'product' } : {}),
    ...(String(body.disclosure ?? '').trim() ? { disclosure: String(body.disclosure).trim() } : {}),
  }
  // 상품 캡처 등 사용자 참조 이미지 — 프로젝트 폴더 안 파일만 절대경로로 yaml에 싣는다.
  if (Array.isArray(body.referenceImages) && body.referenceImages.length > 0) {
    const referenceImages = []
    for (const rel of body.referenceImages.filter(Boolean).map(String).slice(0, 5)) {
      const abs = join(projectDir, rel)
      if (safeStartsWith(abs, projectDir) && existsSync(abs)) referenceImages.push(abs)
    }
    if (referenceImages.length > 0) input.referenceImages = referenceImages
  }
  await mkdir(projectDir, { recursive: true })
  await writeFile(inputPath, YAML.stringify(input), 'utf8')

  const imageProvider = normalizeImageProvider(body.imageProvider)
  const args = [
    'story-pipeline',
    inputPath,
    '--out-dir',
    pipelineDir,
    '--image-provider',
    imageProvider,
    '--tts-provider',
    body.ttsProvider === 'mock'
      ? 'mock'
      : body.ttsProvider === 'typecast' || isTypecastVoice(body.voice)
        ? 'typecast'
        : 'qwen3',
  ]
  if (body.voice) args.push('--voice', cliVoiceArg(body.voice))
  if (body.imageModel) args.push('--image-model', String(body.imageModel))
  // TTS 타이밍 동기 자막(쿠팡 모드: center/12자)
  if (['top', 'center', 'bottom'].includes(body.captionPosition)) {
    args.push('--caption-position', String(body.captionPosition))
  }
  const captionMaxChars = Math.round(Number(body.captionMaxChars))
  if (Number.isFinite(captionMaxChars) && captionMaxChars >= 4) {
    args.push('--caption-max-chars', String(captionMaxChars))
  }
  const motionMode = body.motionMode === 'hook' || body.motionMode === 'all' ? body.motionMode : 'none'
  if (motionMode !== 'none') {
    args.push('--motion-mode', motionMode)
    args.push(
      '--motion-engine',
      body.motionEngine === 'dropshot' ? 'dropshot' : body.motionEngine === 'higgsfield' ? 'higgsfield' : 'seedance',
    )
  }
  // 배경음악: 프로젝트 폴더 내부 파일만 허용(업로드 API가 audio/에 저장한 파일).
  if (body.bgmFile) {
    const bgmAbs = join(projectDir, String(body.bgmFile))
    if (safeStartsWith(bgmAbs, projectDir) && existsSync(bgmAbs)) args.push('--bgm', bgmAbs)
  }
  if (body.force) args.push('--force')

  const env = imageProviderEnv(imageProvider, body)
  if (body.falApiKey) env.FAL_KEY = String(body.falApiKey)
  if (body.higgsfieldApiKey) env.HIGGSFIELD_API_KEY = String(body.higgsfieldApiKey)
  if (body.higgsfieldSecret) env.HIGGSFIELD_SECRET = String(body.higgsfieldSecret)
  Object.assign(env, typecastEnvFrom(body))

  const runnerCall = {
    command: 'story-pipeline',
    projectPath: inputPath,
    workspaceRoot,
    args,
    env,
  }
  const finalVideo = join(pipelineDir, 'video', 'output', 'video_01.mp4')

  // AI 촬영감독: 대본 생성과 같은 방식(에이전트/API)으로 장면별 숏 연출을 뽑아 이미지 품질을 올린다.
  const scriptMethod = String(body.scriptMethod ?? '').trim()
  const runPipelineJob = async () => {
    if (body.voice) {
      const styleId = String(body.narrationStyle ?? 'natural')
      const strength = Math.min(3, Math.max(1, Math.round(Number(body.narrationStrength) || 2)))
      const customInstruction = String(body.customNarrationStyle ?? '').trim().slice(0, 500)
      const selectedStyle = resolveNarrationStyle(styleId, customInstruction)
      const delivery = await inferDeliveryPlan(
        body.directedNarration ? scriptMethod : '',
        String(body.scriptApiKey ?? ''),
        script,
        selectedStyle.id,
        strength,
        customInstruction,
      )
      if (delivery) {
        const deliveryPath = join(projectDir, 'narration-delivery.json')
        await writeFile(
          deliveryPath,
          JSON.stringify(
            {
              styleId: selectedStyle.id,
              styleLabel: selectedStyle.label,
              strength,
              customInstruction: customInstruction || undefined,
              sentences: delivery,
            },
            null,
            2,
          ),
          'utf8',
        )
        runnerCall.args.push('--delivery', deliveryPath)
      }
    }
    if (scriptMethod) {
      const shots = await inferShotPlan(
        scriptMethod,
        String(body.scriptApiKey ?? ''),
        script,
        input.maxSceneChars,
        input.character ?? '',
      )
      if (shots) {
        const shotsPath = join(projectDir, 'shots.json')
        // {world: 세트 시트, shots: 장면별 숏} 형태로 저장 — CLI가 읽어 프롬프트에 주입한다.
        await writeFile(shotsPath, JSON.stringify(shots, null, 2), 'utf8')
        runnerCall.args.push('--shots', shotsPath)
      }
    }
    return commandRunner(runnerCall)
  }

  if (body.async) {
    const job = createPipelineJob({ projectName, title: input.title, pipelineDir, finalVideo })
    // 실행 로그를 실시간으로 모아 UI가 진행 상황을 보여줄 수 있게 한다.
    job.logLines = []
    job.track = { child: null }
    runnerCall.onOutput = (chunk) => {
      for (const line of String(chunk).split(/\r?\n/)) {
        const trimmed = line.trim()
        if (trimmed) job.logLines.push(trimmed)
      }
      if (job.logLines.length > 60) job.logLines.splice(0, job.logLines.length - 60)
    }
    runnerCall.onSpawn = (child) => {
      job.track.child = child
    }
    pipelineQueue.push({ job, run: runPipelineJob })
    processPipelineQueue()
    sendJson(res, 200, { ok: true, jobId: job.id, projectName, pipelineDir, finalVideo })
    return
  }

  const result = await runPipelineJob()
  sendJson(res, 200, {
    ok: result.exitCode === 0,
    projectName,
    inputPath,
    pipelineDir,
    finalVideo,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  })
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

/** 도구(ffprobe/ffmpeg) 실행 stdout을 문자열로 받는다 — 짧은 작업 전용. */
function runToolCapture(binary, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(binary, args, { windowsHide: true, shell: false })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('close', (code) => {
      if (code === 0) resolveRun(stdout)
      else rejectRun(new Error(stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(' ').slice(0, 300) || `exit ${code}`))
    })
    child.on('error', rejectRun)
  })
}

/**
 * 소스 짜집기 — 소스 분석(프로브·프레임·비전 자막감지)→AI 매칭→plan.json→CLI source-remix.
 * 무거운 렌더는 전부 CLI로 위임하고, 분석은 큐에 들어간 run() 안에서 수행한다(스토리 파이프라인과 동일 패턴).
 */
async function handleSourceRemix(req, res, workspaceRoot, commandRunner) {
  const body = await readJsonBody(req, 2 * 1024 * 1024)
  const projectName = safeProjectName(body.projectName ?? 'remix-shorts')
  const script = String(body.script ?? '').trim()
  const clips = Array.isArray(body.clips) ? body.clips.filter(Boolean).map(String) : []
  if (!script) {
    sendJson(res, 400, { ok: false, error: '대본(script)이 필요합니다.' })
    return
  }
  if (clips.length === 0) {
    sendJson(res, 400, { ok: false, error: '소스 영상을 먼저 업로드하세요.' })
    return
  }
  if (!String(body.voice ?? '').trim()) {
    sendJson(res, 400, { ok: false, error: '목소리를 선택하세요 — 자막이 목소리 타이밍에 맞춰집니다.' })
    return
  }
  const projectDir = projectDirFromName(workspaceRoot, projectName)
  const sourceFiles = []
  for (const rel of clips.slice(0, 10)) {
    const abs = join(projectDir, rel)
    if (!safeStartsWith(abs, projectDir)) {
      sendJson(res, 403, { ok: false, error: '허용되지 않은 경로입니다.' })
      return
    }
    if (!existsSync(abs)) {
      sendJson(res, 400, { ok: false, error: `소스 파일을 찾을 수 없습니다: ${rel}` })
      return
    }
    sourceFiles.push(abs)
  }

  const remixDir = join(projectDir, 'remix')
  const finalVideo = join(remixDir, 'video', 'output', 'video_01.mp4')
  const planPath = join(remixDir, 'plan.json')
  const method = String(body.scriptMethod ?? '')
  const apiKey = String(body.scriptApiKey ?? '')
  const ffprobeBin = findExecutable('ffprobe', 'FFPROBE_PATH') || 'ffprobe'
  const ffmpegBin = findExecutable('ffmpeg', 'FFMPEG_PATH') || 'ffmpeg'

  const job = createPipelineJob({
    projectName,
    title: String(body.title ?? projectName),
    pipelineDir: remixDir,
    finalVideo,
  })
  job.logLines = []
  job.track = { child: null }
  const pushLog = (message) => {
    job.logLines.push(message)
    if (job.logLines.length > 60) job.logLines.splice(0, job.logLines.length - 60)
  }
  const writeRemixProgress = async (current, completed) => {
    try {
      await writeFile(
        join(remixDir, 'progress.json'),
        JSON.stringify(
          {
            status: 'running',
            stages: ['analyze', 'narrate', 'cut', 'clips', 'render'],
            current,
            completed,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
        'utf8',
      )
    } catch {
      /* 진행 표시는 부가 기능 */
    }
  }

  const runRemixJob = async () => {
    await mkdir(join(remixDir, 'frames'), { recursive: true })
    await writeRemixProgress('analyze', [])

    // ① 소스별 길이·해상도 프로브 + 대표 프레임 추출 + 비전 분석(내용·박힌 자막 위치)
    const sources = []
    for (let index = 0; index < sourceFiles.length; index++) {
      if (job.cancelled) return { exitCode: 1, stdout: '', stderr: '중지됨' }
      const abs = sourceFiles[index]
      let probe = null
      try {
        probe = parseProbeOutput(await runToolCapture(ffprobeBin, buildProbeArgs(abs)))
      } catch {
        probe = null
      }
      if (!probe || !probe.durationSec) {
        return { exitCode: 1, stdout: '', stderr: `소스 영상을 읽을 수 없습니다: ${clips[index]}` }
      }
      const framePath = join(remixDir, 'frames', `frame_${pad2(index + 1)}.png`)
      try {
        await runToolCapture(ffmpegBin, buildFrameExtractArgs(abs, probe.durationSec / 2, framePath))
      } catch (error) {
        return { exitCode: 1, stdout: '', stderr: `대표 프레임 추출 실패(${clips[index]}): ${error.message}` }
      }
      let info = null
      if (method.startsWith('api-') && apiKey) {
        try {
          const frameData = await readFile(framePath)
          const raw = await generateWithMethod(method, apiKey, sourceClipVisionPrompt(), false, true, [
            { base64: frameData.toString('base64'), mimeType: 'image/png' },
          ])
          info = parseSourceClipInfo(raw)
        } catch (error) {
          pushLog(`소스 ${index + 1} 비전 분석 실패(계속 진행): ${error.message}`)
        }
      }
      pushLog(
        `소스 ${index + 1}/${sourceFiles.length}: ${info?.description || '설명 없음'}${info?.subtitleBand ? ' · 자막 감지 → 블러 예정' : ''}`,
      )
      sources.push({
        file: abs,
        frame: framePath,
        description: info?.description || `소스 영상 ${index + 1}`,
        durationSec: probe.durationSec,
        width: probe.width || 1080,
        height: probe.height || 1920,
        subtitleBand: info?.subtitleBand ?? null,
      })
    }
    if (job.cancelled) return { exitCode: 1, stdout: '', stderr: '중지됨' }

    // ② 문장 분할 + AI 내용 매칭(실패 시 순서 배치 폴백)
    const sentences = splitSentencesForDelivery(script)
    let assignments = null
    if (method) {
      try {
        const raw = await generateWithMethod(
          method,
          apiKey,
          remixMatchPrompt(sentences, sources.map((source) => source.description)),
          false,
          true,
        )
        assignments = parseRemixMatch(raw, sentences.length, sources.length)
      } catch (error) {
        pushLog(`AI 매칭 실패 — 순서 배치로 진행: ${error.message}`)
      }
    }
    if (!assignments) assignments = sentences.map((_, index) => index % sources.length)
    pushLog(`문장 ${sentences.length}개 ↔ 소스 배정 [${assignments.join(', ')}]`)

    // ③ 말투 연출 계획(선택)
    const styleId = String(body.narrationStyle ?? 'shopping-host')
    const strength = Math.min(3, Math.max(1, Math.round(Number(body.narrationStrength) || 2)))
    const customInstruction = String(body.customNarrationStyle ?? '').trim().slice(0, 500)
    const selectedStyle = resolveNarrationStyle(styleId, customInstruction)
    const delivery = await inferDeliveryPlan(
      body.directedNarration ? method : '',
      apiKey,
      script,
      selectedStyle.id,
      strength,
      customInstruction,
    )
    const deliveryArgs = []
    if (delivery) {
      const deliveryPath = join(remixDir, 'narration-delivery.json')
      await writeFile(
        deliveryPath,
        JSON.stringify(
          { styleId: selectedStyle.id, styleLabel: selectedStyle.label, strength, sentences: delivery },
          null,
          2,
        ),
        'utf8',
      )
      deliveryArgs.push('--delivery', deliveryPath)
    }

    // ④ plan.json 저장 → CLI 실행
    const plan = buildRemixPlan({
      projectName,
      title: String(body.title ?? '').trim() || undefined,
      sentences,
      sources,
      assignments,
      ratio: body.ratio,
      disclosure: String(body.disclosure ?? '').trim() || undefined,
    })
    await writeFile(planPath, JSON.stringify(plan, null, 2), 'utf8')
    if (job.cancelled) return { exitCode: 1, stdout: '', stderr: '중지됨' }
    return commandRunner({
      command: 'source-remix',
      projectPath: planPath,
      workspaceRoot,
      args: [
        'source-remix',
        planPath,
        '--voice',
        cliVoiceArg(body.voice),
        '--tts-provider',
        body.ttsProvider === 'mock' ? 'mock' : isTypecastVoice(body.voice) ? 'typecast' : 'qwen3',
        '--out-dir',
        remixDir,
        ...deliveryArgs,
      ],
      env: typecastEnvFrom(body),
      onOutput: (chunk) => {
        for (const line of String(chunk).split(/\r?\n/)) {
          const trimmed = line.trim()
          if (trimmed) pushLog(trimmed)
        }
      },
      onSpawn: (child) => {
        job.track.child = child
      },
    })
  }

  pipelineQueue.push({ job, run: runRemixJob })
  processPipelineQueue()
  sendJson(res, 200, { ok: true, jobId: job.id, projectName, pipelineDir: remixDir, finalVideo })
}

async function handleProductPipeline(req, res, workspaceRoot, commandRunner) {
  const body = await readJsonBody(req, 2 * 1024 * 1024)
  const projectName = safeProjectName(body.projectName ?? 'shop-shorts')
  const clips = Array.isArray(body.clips) ? body.clips.filter(Boolean).map(String) : []
  if (clips.length === 0) {
    sendJson(res, 400, { ok: false, error: '업로드된 클립이 없습니다.' })
    return
  }
  if (!String(body.productName ?? '').trim()) {
    sendJson(res, 400, { ok: false, error: '상품명이 필요합니다.' })
    return
  }

  const projectDir = projectDirFromName(workspaceRoot, projectName)
  const variants = Math.min(10, Math.max(1, Number(body.variants) || 5))
  await mkdir(projectDir, { recursive: true })

  let narrationFile
  if (body.voice) {
    const narrationText = buildProductNarrationText(body)
    const narrationTextPath = join(projectDir, 'product-narration.txt')
    const narrationDir = join(projectDir, 'narration')
    const narrationStyle = resolveNarrationStyle(
      String(body.narrationStyle ?? 'shopping-host'),
      String(body.customNarrationStyle ?? '').trim().slice(0, 500),
    )
    const narrationStrength = Math.min(3, Math.max(1, Math.round(Number(body.narrationStrength) || 2)))
    const customInstruction = String(body.customNarrationStyle ?? '').trim().slice(0, 500)
    const plan = await inferDeliveryPlan(
      body.directedNarration ? String(body.scriptMethod ?? '') : '',
      String(body.scriptApiKey ?? ''),
      narrationText,
      narrationStyle.id,
      narrationStrength,
      customInstruction,
    )
    const deliveryPath = join(projectDir, 'narration-delivery.json')
    await writeFile(narrationTextPath, narrationText, 'utf8')
    await writeFile(
      deliveryPath,
      JSON.stringify(
        {
          styleId: narrationStyle.id,
          styleLabel: narrationStyle.label,
          strength: narrationStrength,
          customInstruction: customInstruction || undefined,
          sentences: plan ?? [],
        },
        null,
        2,
      ),
      'utf8',
    )
    const narrationArgs = [
      'narrate',
      narrationTextPath,
      '--voice',
      cliVoiceArg(body.voice),
      '--out-dir',
      narrationDir,
      '--delivery',
      deliveryPath,
    ]
    if (isTypecastVoice(body.voice)) narrationArgs.push('--provider', 'typecast')
    const narrationResult = await commandRunner({
      command: 'narrate',
      projectPath: narrationTextPath,
      workspaceRoot,
      args: narrationArgs,
      env: typecastEnvFrom(body),
    })
    if (narrationResult.exitCode !== 0) {
      sendJson(res, 200, {
        ok: false,
        projectName,
        videos: [],
        exitCode: narrationResult.exitCode,
        stdout: narrationResult.stdout,
        stderr: narrationResult.stderr,
        error: '쇼핑 나레이션 생성에 실패했습니다.',
      })
      return
    }
    narrationFile = 'narration/product-narration.wav'
  }

  const spec = {
    projectDir,
    projectName,
    productName: String(body.productName),
    affiliateUrl: String(body.affiliateUrl ?? ''),
    benefit: String(body.benefit ?? ''),
    painPoint: String(body.painPoint ?? ''),
    clips,
    variants,
    ...(narrationFile ? { narrationFile } : {}),
  }
  const specPath = join(projectDir, 'product-spec.json')
  await writeFile(specPath, JSON.stringify(spec, null, 2), 'utf8')

  const result = await commandRunner({
    command: 'product-render',
    projectPath: specPath,
    workspaceRoot,
    args: ['product-render', specPath],
  })

  const videos = Array.from({ length: variants }, (_, i) => `video_${pad2(i + 1)}.mp4`)
  sendJson(res, 200, {
    ok: result.exitCode === 0,
    projectName,
    projectDir,
    videos: result.exitCode === 0 ? videos : [],
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  })
}

async function handleCommand(req, res, workspaceRoot, commandRunner, command) {
  const body = await readJsonBody(req)
  const projectPath = String(body.projectPath ?? '')
  const resolvedPath = resolveWorkspacePath(workspaceRoot, projectPath)
  const result = await commandRunner({ command, projectPath: resolvedPath, workspaceRoot })
  sendJson(res, 200, {
    ok: result.exitCode === 0,
    command,
    projectPath: resolvedPath,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
  })
}

/** 앱 시작 시 TTS 데몬을 미리 띄우고 모델을 예열해 첫 낭독의 30초 콜드스타트를 없앤다. */
function warmUpTtsDaemon(workspaceRoot) {
  const port = Number(process.env.QWEN3_TTS_PORT ?? 8756)
  const base = `http://127.0.0.1:${port}`
  const attempt = async () => {
    const health = async () => {
      try {
        const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(1500) })
        return res.ok
      } catch {
        return false
      }
    }
    if (!(await health())) {
      const pythonw = join(workspaceRoot, '.venv-tts', 'Scripts', 'pythonw.exe')
      const daemonScript = join(PROGRAM_ROOT, 'scripts', 'qwen3_tts_daemon.py')
      if (!existsSync(pythonw) || !existsSync(daemonScript)) return
      spawn(pythonw, [daemonScript, String(port)], {
        cwd: workspaceRoot,
        detached: true,
        windowsHide: true,
        stdio: 'ignore',
      }).unref()
      const startTs = Date.now()
      while (Date.now() - startTs < 20000) {
        await new Promise((r) => setTimeout(r, 1000))
        if (await health()) break
      }
    }
    try {
      await fetch(`${base}/warmup`, { signal: AbortSignal.timeout(3000) })
    } catch {
      /* 예열 실패는 무해 — 첫 낭독 때 로드된다 */
    }
  }
  attempt().catch(() => {})
}

export function createShortsFactoryServer(options = {}) {
  // workspaceRoot는 **사용자가 만든 것**(projects, .venv-stt)이 있는 곳이다.
  // 함께 배포되는 파일(scripts, dist, app)은 PROGRAM_ROOT에서 찾는다 — 설치본은
  // 업데이트 때 설치 폴더를 갈아엎어서, 둘을 같은 곳에 두면 작업물이 지워진다.
  const workspaceRoot = resolve(options.workspaceRoot ?? process.cwd())
  const appRoot = resolve(options.appRoot ?? join(PROGRAM_ROOT, 'app'))
  const host = options.host ?? '127.0.0.1'
  const port = Number(options.port ?? process.env.PORT ?? 4173)
  const commandRunner = options.commandRunner ?? defaultCommandRunner

  // 이전 실행이 남긴 고아 크로미움을 청소한다(Electron 앱에서만 켠다 — 테스트/보조 서버 제외).
  if (options.sweepOrphans) setTimeout(sweepOrphanDropshotChromium, 1500)

  const server = createServer(async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? '/', `http://${host}:${port}`)
      const pathname = requestUrl.pathname

      if (pathname === '/api/health') {
        sendJson(res, 200, { ok: true, app: 'shorts-factory', workspaceRoot })
        return
      }

      if (pathname === '/api/project/write' && req.method === 'POST') {
        await handleProjectWrite(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/project/read' && req.method === 'GET') {
        await handleProjectRead(requestUrl, res, workspaceRoot)
        return
      }

      if (pathname === '/api/media/upload' && req.method === 'POST') {
        await handleMediaUpload(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/media/preview' && req.method === 'GET') {
        await handleMediaPreview(requestUrl, res, workspaceRoot, req)
        return
      }

      if (pathname === '/api/media/waveform' && req.method === 'GET') {
        await handleMediaWaveform(requestUrl, res, workspaceRoot, req)
        return
      }

      if (pathname === '/api/storyboard/render' && req.method === 'POST') {
        await handleStoryboardRender(req, res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/story-images/generate' && req.method === 'POST') {
        await handleStoryImagesGenerate(req, res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/captions/status' && req.method === 'GET') {
        await handleCaptionStatus(res, workspaceRoot)
        return
      }

      if (pathname === '/api/captions/generate' && req.method === 'POST') {
        await handleCaptionGenerate(req, res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/captions/save' && req.method === 'POST') {
        await handleCaptionSave(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/silence/analyze' && req.method === 'POST') {
        await handleSilenceAnalyze(req, res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/voices' && req.method === 'GET') {
        await handleVoicesList(res, workspaceRoot)
        return
      }

      if (pathname === '/api/typecast/voices' && req.method === 'GET') {
        await handleTypecastVoices(req, res)
        return
      }

      if (pathname === '/api/narration-styles' && req.method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          styles: NARRATION_STYLES.map(({ id, group, label, description }) => ({ id, group, label, description })),
        })
        return
      }

      if (pathname === '/api/voices' && req.method === 'POST') {
        await handleVoiceSave(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/voices/audio' && req.method === 'GET') {
        await handleVoiceAudio(requestUrl, res, workspaceRoot, req)
        return
      }

      if (pathname.startsWith('/api/voices/') && req.method === 'DELETE') {
        await handleVoiceDelete(pathname, res, workspaceRoot)
        return
      }

      if (pathname === '/api/voices/progress' && req.method === 'GET') {
        await handleVoiceProgress(requestUrl, res, workspaceRoot)
        return
      }

      if (pathname === '/api/voices/sample' && req.method === 'GET') {
        await handleVoiceSampleCheck(requestUrl, res, workspaceRoot)
        return
      }

      if (pathname === '/api/voices/test/cancel' && req.method === 'POST') {
        await handleVoiceTestCancel(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/voices/test' && req.method === 'POST') {
        await handleVoiceTest(req, res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/narrate' && req.method === 'POST') {
        await handleNarrate(req, res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/script-templates' && req.method === 'GET') {
        await handleScriptTemplates(res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/story-pipeline' && req.method === 'POST') {
        await handleStoryPipeline(req, res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/projects' && req.method === 'GET') {
        await handleProjectsList(res, workspaceRoot)
        return
      }

      if (pathname === '/api/gallery/images' && req.method === 'GET') {
        await handleGalleryImages(res, workspaceRoot)
        return
      }

      if (pathname === '/api/gallery/delete' && req.method === 'POST') {
        await handleGalleryDelete(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/gallery/delete-project' && req.method === 'POST') {
        await handleGalleryDeleteProject(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/diagnostics/save' && req.method === 'POST') {
        await handleDiagnosticsSave(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/jobs' && req.method === 'GET') {
        await handleJobsList(res)
        return
      }

      if (/^\/api\/jobs\/[^/]+\/cancel$/.test(pathname) && req.method === 'POST') {
        await handleJobCancel(pathname, res)
        return
      }

      if (pathname.startsWith('/api/jobs/') && req.method === 'GET') {
        await handleJobStatus(pathname, res)
        return
      }

      if (pathname === '/api/product-pipeline' && req.method === 'POST') {
        await handleProductPipeline(req, res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/validate' && req.method === 'POST') {
        await handleCommand(req, res, workspaceRoot, commandRunner, 'validate')
        return
      }

      if (pathname === '/api/package' && req.method === 'POST') {
        await handleCommand(req, res, workspaceRoot, commandRunner, 'package')
        return
      }

      if (pathname === '/api/render' && req.method === 'POST') {
        await handleCommand(req, res, workspaceRoot, commandRunner, 'render')
        return
      }

      if (pathname === '/api/export/gif' && req.method === 'POST') {
        await handleExportGif(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/script/generate' && req.method === 'POST') {
        await handleScriptGenerate(req, res)
        return
      }

      if (pathname === '/api/coupang/analyze' && req.method === 'POST') {
        await handleCoupangAnalyze(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/source-remix' && req.method === 'POST') {
        await handleSourceRemix(req, res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/narrations' && req.method === 'GET') {
        await handleNarrationsList(res, workspaceRoot)
        return
      }

      if (pathname === '/api/narrations/adjust' && req.method === 'POST') {
        await handleNarrationAdjust(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/narrations/rename' && req.method === 'POST') {
        await handleNarrationRename(req, res, workspaceRoot)
        return
      }

      if (pathname.startsWith('/api/narrations/') && req.method === 'DELETE') {
        await handleNarrationDelete(pathname, res, workspaceRoot)
        return
      }

      if (pathname === '/api/scripts' && req.method === 'GET') {
        await handleScriptsList(res, workspaceRoot)
        return
      }

      if (pathname === '/api/scripts' && req.method === 'POST') {
        await handleScriptSave(req, res, workspaceRoot)
        return
      }

      if (pathname.startsWith('/api/scripts/') && req.method === 'DELETE') {
        await handleScriptDelete(pathname, res, workspaceRoot)
        return
      }

      if (pathname === '/api/subtitle-erase' && req.method === 'POST') {
        await handleSubtitleErase(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/auto-edit/media' && req.method === 'GET') {
        await handleAutoEditMedia(requestUrl, res, req)
        return
      }

      if (pathname === '/api/auto-edit/peaks' && req.method === 'GET') {
        await handleAutoEditPeaks(requestUrl, res)
        return
      }

      if (pathname === '/api/auto-edit/progress' && req.method === 'GET') {
        await handleAutoEditProgress(requestUrl, res)
        return
      }

      if (pathname === '/api/auto-edit/analyze' && req.method === 'POST') {
        await handleAutoEditAnalyze(req, res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/auto-edit/apply' && req.method === 'POST') {
        await handleAutoEditApply(req, res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/stt-engine/status' && req.method === 'GET') {
        await handleSttEngineStatus(res, workspaceRoot)
        return
      }

      if (pathname === '/api/stt-engine/install' && req.method === 'POST') {
        await handleSttEngineInstall(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/longform-captions' && req.method === 'POST') {
        await handleLongformCaptions(req, res, workspaceRoot, commandRunner)
        return
      }

      if (pathname === '/api/assistant/status' && req.method === 'GET') {
        await handleAssistantStatus(res)
        return
      }

      if (pathname === '/api/assistant/chat' && req.method === 'POST') {
        await handleAssistantChat(req, res, workspaceRoot)
        return
      }

      if (pathname === '/api/assistant/approval' && req.method === 'POST') {
        await handleAssistantApprovalRequest(req, res)
        return
      }

      if (pathname === '/api/assistant/approve' && req.method === 'POST') {
        await handleAssistantApprove(req, res)
        return
      }

      if (pathname === '/api/assistant/cancel' && req.method === 'POST') {
        await handleAssistantCancel(res)
        return
      }

      if (pathname === '/api/agents/status' && req.method === 'GET') {
        await handleAgentsStatus(res)
        return
      }

      if (pathname === '/api/agents/login' && req.method === 'POST') {
        await handleAgentLogin(req, res)
        return
      }

      if (pathname === '/api/project/images' && req.method === 'GET') {
        await handleProjectImages(requestUrl, res, workspaceRoot)
        return
      }

      if (pathname === '/api/dropshot/status' && req.method === 'GET') {
        await handleDropshotStatus(res)
        return
      }

      if (pathname === '/api/dropshot/login' && req.method === 'POST') {
        await handleDropshotLogin(res)
        return
      }

      if (pathname.startsWith('/api/')) {
        sendJson(res, 404, { ok: false, error: '알 수 없는 API입니다.' })
        return
      }

      const file = resolveStaticPath(appRoot, req.url ?? '/', host, port)
      if (file === null) {
        sendText(res, 403, 'forbidden')
        return
      }
      await sendStaticFile(res, file, req)
    } catch (err) {
      sendJson(res, 500, { ok: false, error: err instanceof Error ? err.message : String(err) })
    }
  })

  // 이미지 생성/TTS/렌더는 수 분이 걸릴 수 있다. 로컬 전용 서버이므로
  // 요청 타임아웃을 해제해 긴 파이프라인 요청이 중간에 끊기지 않게 한다.
  server.requestTimeout = 0
  // TTS 데몬 예열은 서버 기동을 막지 않게 뒤로 미룬다.
  setTimeout(() => warmUpTtsDaemon(workspaceRoot), 2000)

  return server
}
