/* global console, process */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { delimiter, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const smokeDir = join(root, 'tmp', 'render-smoke-verify')
const clipsDir = join(smokeDir, 'clips')
const tmpToolDir = 'C:\\tmp\\shorts-factory-ffmpeg\\bin'
const wingetLinkDir = join(homedir(), 'AppData', 'Local', 'Microsoft', 'WinGet', 'Links')
const codexWingetLinkDir = 'C:\\CodexHome\\AppData\\Local\\Microsoft\\WinGet\\Links'

function pathCandidates(name, envName) {
  const exeName = process.platform === 'win32' ? `${name}.exe` : name
  const candidates = []
  if (process.env[envName]) candidates.push(process.env[envName])
  for (const entry of (process.env.PATH ?? '').split(delimiter)) {
    if (entry) candidates.push(join(entry, exeName))
  }
  candidates.push(join(tmpToolDir, exeName))
  candidates.push(join(wingetLinkDir, exeName), join(codexWingetLinkDir, exeName))
  return candidates
}

function findBinary(name, envName) {
  const found = pathCandidates(name, envName).find((candidate) => candidate && existsSync(candidate))
  if (!found) {
    throw new Error(
      `${name} not found. Install FFmpeg or set ${envName} to an absolute executable path.`,
    )
  }
  return resolve(found)
}

function tail(text, lines = 18) {
  return text.split(/\r?\n/).slice(-lines).join('\n')
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(
      [
        `Command failed: ${command} ${args.join(' ')}`,
        result.error?.message ?? '',
        tail(result.stdout ?? ''),
        tail(result.stderr ?? ''),
      ]
        .filter(Boolean)
        .join('\n'),
    )
  }
  return result.stdout ?? ''
}

async function createProject() {
  await rm(smokeDir, { recursive: true, force: true })
  await mkdir(clipsDir, { recursive: true })
  await writeFile(
    join(smokeDir, 'project.yaml'),
    `projectName: render-smoke-verify

product:
  name: Smoke Test Product
  category: Test Storage
  priceRange: 10000-30000
  affiliateUrl: https://example.com/product
  painPoint: cramped counter space
  benefit: shows a clear before and after

disclosure:
  type: affiliate
  text: This content may include affiliate links.

style:
  duration: 6
  ratio: 9:16
  resolution: 720x1280
  tone: friendly
  captionPosition: bottom
  captionStyle: bold-yellow
  transition: fade
  bgmVolume: 0.1

clips:
  - file: clips/hook.mp4
    role: hook
    start: 0
    end: 1.5
  - file: clips/use.mp4
    role: use
    start: 0
    end: 1.5
    mute: true
  - file: clips/result.mp4
    role: result
    start: 0
    end: 1.5

stickers:
  - text: smoke sticker
    start: 0.5
    end: 2
    position: center

variants:
  count: 1

publish:
  campaignName: render-smoke-verify
  platforms:
    - youtube_shorts
  hashtags:
    - smoke
  cta: Check the link for more details.

sources:
  - title: synthetic hook clip
    file: clips/hook.mp4
    rights: owned
    usage: edit
`,
    'utf8',
  )
}

function createClip(ffmpeg, color, output) {
  run(ffmpeg, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    `color=c=${color}:s=720x1280:d=2`,
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=44100',
    '-shortest',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    output,
  ])
}

function createLongformClip(ffmpeg, output) {
  run(ffmpeg, [
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x111827:s=1280x720:d=18',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x334155:s=1280x720:d=2',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x065f46:s=1280x720:d=23',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x7c2d12:s=1280x720:d=2',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x1d4ed8:s=1280x720:d=25',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=440:sample_rate=44100:d=18',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=44100:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=660:sample_rate=44100:d=23',
    '-f',
    'lavfi',
    '-i',
    'anullsrc=channel_layout=stereo:sample_rate=44100:d=2',
    '-f',
    'lavfi',
    '-i',
    'sine=frequency=550:sample_rate=44100:d=25',
    '-filter_complex',
    '[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1:a=0[v];[5:a][6:a][7:a][8:a][9:a]concat=n=5:v=0:a=1[a]',
    '-map',
    '[v]',
    '-map',
    '[a]',
    '-shortest',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    output,
  ])
}

async function createStoryImageInput() {
  await writeFile(
    join(smokeDir, 'story-image-input.json'),
    JSON.stringify(
      {
        projectName: 'render-smoke-story',
        title: 'Smoke Story',
        productName: 'Smoke Story Channel',
        affiliateUrl: 'https://example.com/story',
        script:
          'A package appeared at the door after midnight. The label showed a delivery time from tomorrow. The hallway light went out before anyone moved.',
        sceneDurationSec: 2,
      },
      null,
      2,
    ),
    'utf8',
  )
}

async function createLongformTranscript() {
  await writeFile(
    join(smokeDir, 'longform-source.srt'),
    [
      '1',
      '00:00:00,000 --> 00:00:17,500',
      'Intro and setup before the main product review.',
      '',
      '2',
      '00:00:21,000 --> 00:00:38,000',
      'Smoke Test Product review with price, discount, result, recommend, and link details.',
      '',
      '3',
      '00:00:46,000 --> 00:01:08,000',
      'General closing comments after the main highlight.',
      '',
    ].join('\n'),
    'utf8',
  )
}

async function assertOutput(ffprobe) {
  const outputFile = join(smokeDir, 'output', 'video_01.mp4')
  const manifestFile = join(smokeDir, 'output', 'publish_package', 'manifest.json')
  const traceabilityFile = join(smokeDir, 'output', 'publish_package', 'source_traceability.json')
  const zipFile = join(smokeDir, 'output', 'render-smoke-verify_publish_package.zip')

  for (const file of [outputFile, manifestFile, traceabilityFile, zipFile]) {
    if (!existsSync(file)) throw new Error(`Expected output missing: ${file}`)
  }

  const raw = run(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,duration',
    '-of',
    'json',
    outputFile,
  ])
  const data = JSON.parse(raw)
  const stream = data.streams?.[0]
  if (stream?.width !== 720 || stream?.height !== 1280) {
    throw new Error(`Unexpected smoke video size: ${JSON.stringify(stream)}`)
  }
  const duration = Number(stream.duration)
  if (!Number.isFinite(duration) || duration < 4 || duration > 6) {
    throw new Error(`Unexpected smoke video duration: ${stream.duration}`)
  }

  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'))
  if (manifest.items?.length !== 1) throw new Error('Smoke manifest should have one upload item.')
}

async function assertStoryboardOutput(ffprobe) {
  const projectFile = join(smokeDir, 'story-video', 'project.yaml')
  const reportFile = join(smokeDir, 'story-video', 'story_video_report.json')
  const imageReportFile = join(smokeDir, 'story-generated', 'image_generation_report.json')
  const clipFile = join(smokeDir, 'story-video', 'clips', 'scene_01.mp4')
  for (const file of [projectFile, reportFile, imageReportFile, clipFile]) {
    if (!existsSync(file)) throw new Error(`Expected storyboard output missing: ${file}`)
  }

  const raw = run(ffprobe, [
    '-v',
    'error',
    '-select_streams',
    'v:0',
    '-show_entries',
    'stream=width,height,duration',
    '-of',
    'json',
    clipFile,
  ])
  const data = JSON.parse(raw)
  const stream = data.streams?.[0]
  if (stream?.width !== 1080 || stream?.height !== 1920) {
    throw new Error(`Unexpected storyboard clip size: ${JSON.stringify(stream)}`)
  }
  const projectYaml = await readFile(projectFile, 'utf8')
  if (!projectYaml.includes('ai_generated')) throw new Error('Storyboard project should trace AI image rights.')
}

async function assertLongformAnalysis() {
  const reportFile = join(smokeDir, 'longform-analysis', 'longform_analysis.json')
  const projectFile = join(smokeDir, 'longform-analysis', 'first_shorts_project.yaml')
  for (const file of [reportFile, projectFile]) {
    if (!existsSync(file)) throw new Error(`Expected longform analysis output missing: ${file}`)
  }

  const report = JSON.parse(await readFile(reportFile, 'utf8'))
  if ((report.silences?.length ?? 0) < 2) {
    throw new Error(`Expected at least two detected silences: ${JSON.stringify(report.silences)}`)
  }
  if ((report.candidates?.length ?? 0) < 2) {
    throw new Error(`Expected at least two highlight candidates: ${JSON.stringify(report.candidates)}`)
  }
  if (report.transcript?.scoring !== 'keyword_overlap') {
    throw new Error(`Expected transcript scoring metadata: ${JSON.stringify(report.transcript)}`)
  }
  if (report.visual?.scoring !== 'ffmpeg_scene_change' || report.visual.signalCount < 1) {
    throw new Error(`Expected visual scene scoring metadata: ${JSON.stringify(report.visual)}`)
  }
  if (report.candidates?.[0]?.start !== 20) {
    throw new Error(`Expected transcript scoring to promote the second segment: ${JSON.stringify(report.candidates?.[0])}`)
  }
  if (!report.candidates?.some((candidate) => (candidate.visualScore?.sceneChangeCount ?? 0) > 0)) {
    throw new Error(`Expected visual score on at least one candidate: ${JSON.stringify(report.candidates)}`)
  }

  const projectYaml = await readFile(projectFile, 'utf8')
  if (!projectYaml.includes('clips:')) throw new Error('Generated first_shorts_project.yaml is incomplete.')
}

async function assertSourceDiscovery() {
  const reportFile = join(smokeDir, 'source-discovery', 'source_discovery.json')
  const boardFile = join(smokeDir, 'source-discovery', 'source_board.json')
  const traceFile = join(smokeDir, 'source-discovery', 'source_traceability.json')
  for (const file of [reportFile, boardFile, traceFile]) {
    if (!existsSync(file)) throw new Error(`Expected source discovery output missing: ${file}`)
  }

  const board = JSON.parse(await readFile(boardFile, 'utf8'))
  if ((board.sources?.length ?? 0) < 1) throw new Error('Source discovery should produce sources.')
  if (board.sources.some((source) => source.rights !== 'reference_only' || source.usage !== 'reference')) {
    throw new Error(`Discovered sources must stay reference-only: ${JSON.stringify(board.sources)}`)
  }
}

async function assertUploadPackage() {
  const resultFile = join(smokeDir, 'upload-results.json')
  if (!existsSync(resultFile)) throw new Error(`Expected upload result missing: ${resultFile}`)

  const upload = JSON.parse(await readFile(resultFile, 'utf8'))
  if ((upload.results?.length ?? 0) !== 1) {
    throw new Error(`Expected one upload result: ${JSON.stringify(upload.results)}`)
  }
  if (upload.results.some((result) => !result.ok || result.mode !== 'mock')) {
    throw new Error(`Mock upload should pass safely: ${JSON.stringify(upload.results)}`)
  }
}

async function main() {
  const ffmpeg = findBinary('ffmpeg', 'FFMPEG_PATH')
  const ffprobe = findBinary('ffprobe', 'FFPROBE_PATH')
  await createProject()
  createClip(ffmpeg, '0x0f766e', join(clipsDir, 'hook.mp4'))
  createClip(ffmpeg, '0x1d4ed8', join(clipsDir, 'use.mp4'))
  createClip(ffmpeg, '0xa16207', join(clipsDir, 'result.mp4'))
  createLongformClip(ffmpeg, join(smokeDir, 'longform-source.mp4'))
  await createLongformTranscript()
  await createStoryImageInput()

  const env = { ...process.env, FFMPEG_PATH: ffmpeg, FFPROBE_PATH: ffprobe }
  const tsxCli = join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs')
  run(process.execPath, [tsxCli, 'src/cli/index.ts', 'render', smokeDir], { env })
  run(process.execPath, [tsxCli, 'src/cli/index.ts', 'package', smokeDir], { env })
  run(
    process.execPath,
    [
      tsxCli,
      'src/cli/index.ts',
      'analyze-longform',
      join(smokeDir, 'longform-source.mp4'),
      '--project-name',
      'render-smoke-live',
      '--product-name',
      'Smoke Test Product',
      '--affiliate-url',
      'https://example.com/product',
      '--target-duration',
      '20',
      '--vision-scoring',
      '--transcript',
      join(smokeDir, 'longform-source.srt'),
      '--out-dir',
      join(smokeDir, 'longform-analysis'),
    ],
    { env },
  )
  run(
    process.execPath,
    [
      tsxCli,
      'src/cli/index.ts',
      'generate-story-images',
      join(smokeDir, 'story-image-input.json'),
      '--provider',
      'mock',
      '--out-dir',
      join(smokeDir, 'story-generated'),
    ],
    { env },
  )
  run(
    process.execPath,
    [
      tsxCli,
      'src/cli/index.ts',
      'storyboard-render',
      join(smokeDir, 'story-generated', 'storyboard.json'),
      '--out-dir',
      join(smokeDir, 'story-video'),
    ],
    { env },
  )
  run(process.execPath, [tsxCli, 'src/cli/index.ts', 'validate', join(smokeDir, 'story-video')], {
    env,
  })
  run(
    process.execPath,
    [
      tsxCli,
      'src/cli/index.ts',
      'discover-sources',
      '--product-name',
      'Smoke Test Product',
      '--provider',
      'mock',
      '--max-results',
      '2',
      '--out-dir',
      join(smokeDir, 'source-discovery'),
    ],
    { env },
  )
  run(
    process.execPath,
    [
      tsxCli,
      'src/cli/index.ts',
      'upload-package',
      join(smokeDir, 'output', 'publish_package'),
      '--mode',
      'mock',
      '--out',
      join(smokeDir, 'upload-results.json'),
    ],
    { env },
  )
  await assertOutput(ffprobe)
  await assertLongformAnalysis()
  await assertStoryboardOutput(ffprobe)
  await assertSourceDiscovery()
  await assertUploadPackage()

  console.log(`render smoke passed: ${join(smokeDir, 'output', 'video_01.mp4')}`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
