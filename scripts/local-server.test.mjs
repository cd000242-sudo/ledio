/* global Buffer, Response, fetch, process, setTimeout */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createShortsFactoryServer } from './local-server.mjs'

let workspaceRoot
let server
let baseUrl

/** ffmpeg가 읽을 수 있는 유효한 24kHz 모노 16bit wav를 만든다(잡음 제거 저장 테스트용). */
function makeTestWav(seconds = 0.5, rate = 24000) {
  const samples = Math.floor(seconds * rate)
  const dataSize = samples * 2
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20)
  buf.writeUInt16LE(1, 22)
  buf.writeUInt32LE(rate, 24)
  buf.writeUInt32LE(rate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  for (let i = 0; i < samples; i++) {
    buf.writeInt16LE(Math.round(Math.sin((i / rate) * 440 * 2 * Math.PI) * 6000), 44 + i * 2)
  }
  return buf
}

async function startServer(commandRunner) {
  server = createShortsFactoryServer({
    workspaceRoot,
    appRoot: join(workspaceRoot, 'app'),
    port: 0,
    commandRunner,
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  baseUrl = `http://127.0.0.1:${address.port}`
}

beforeEach(async () => {
  workspaceRoot = await mkdtemp(join(tmpdir(), 'sf-server-'))
})

afterEach(async () => {
  if (server) await new Promise((resolve) => server.close(resolve))
  server = undefined
  await rm(workspaceRoot, { recursive: true, force: true })
})

describe('local server API', () => {
  it('returns health information', async () => {
    await startServer()
    const response = await fetch(`${baseUrl}/api/health`)
    const data = await response.json()
    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.app).toBe('shorts-factory')
  })

  it('writes and reads a project yaml inside the workspace', async () => {
    await startServer()
    const yaml = 'projectName: saved-project\n'
    const writeResponse = await fetch(`${baseUrl}/api/project/write`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ yaml }),
    })
    const writeData = await writeResponse.json()

    expect(writeData.ok).toBe(true)
    expect(writeData.projectName).toBe('saved-project')
    await expect(readFile(writeData.projectFile, 'utf8')).resolves.toBe(yaml)

    const readResponse = await fetch(
      `${baseUrl}/api/project/read?projectPath=${encodeURIComponent(writeData.projectDir)}`,
    )
    const readData = await readResponse.json()
    expect(readData.ok).toBe(true)
    expect(readData.yaml).toBe(yaml)
  })

  it('uses the injected command runner for validate/package/render endpoints', async () => {
    const calls = []
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: `${call.command} ok`, stderr: '' }
    })

    const response = await fetch(`${baseUrl}/api/validate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectPath: workspaceRoot }),
    })
    const data = await response.json()

    expect(data.ok).toBe(true)
    expect(data.stdout).toBe('validate ok')
    expect(calls[0].command).toBe('validate')
    expect(calls[0].projectPath).toBe(workspaceRoot)
  })

  it('uploads selected media into a project media folder', async () => {
    await startServer()
    const response = await fetch(`${baseUrl}/api/media/upload`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: 'media-project',
        kind: 'video',
        files: [
          {
            name: 'clip.mp4',
            type: 'video/mp4',
            size: 5,
            data: Buffer.from('video').toString('base64'),
          },
        ],
      }),
    })
    const data = await response.json()

    expect(data.ok).toBe(true)
    expect(data.imported[0].relativePath).toBe('clips/clip.mp4')
    await expect(readFile(join(workspaceRoot, 'projects', 'media-project', 'clips', 'clip.mp4'), 'utf8')).resolves.toBe(
      'video',
    )
  })

  it('writes a storyboard and dispatches storyboard render through the command runner', async () => {
    const calls = []
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: 'storyboard ok', stderr: '' }
    })

    const response = await fetch(`${baseUrl}/api/storyboard/render`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: 'story-project',
        title: '테스트 썰',
        productName: '스토리 채널',
        affiliateUrl: 'https://example.com/story',
        imageRights: 'ai_generated',
        scenes: [{ image: 'images/scene-01.png', narration: '첫 장면', caption: '첫 자막', durationSec: 4 }],
      }),
    })
    const data = await response.json()
    const storyboard = await readFile(join(workspaceRoot, 'projects', 'story-project', 'storyboard.yaml'), 'utf8')

    expect(data.ok).toBe(true)
    expect(data.stdout).toBe('storyboard ok')
    expect(calls[0].command).toBe('storyboard-render')
    expect(calls[0].args[0]).toBe('storyboard-render')
    expect(calls[0].outputDir).toBe(join(workspaceRoot, 'projects', 'story-project', 'story-video'))
    expect(storyboard).toContain('images/scene-01.png')
  })

  it('writes story image input and dispatches image generation with provider env', async () => {
    const calls = []
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: 'images ok', stderr: '' }
    })

    const response = await fetch(`${baseUrl}/api/story-images/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: 'image-provider-project',
        title: '테스트 이야기',
        script: '문 앞에 이상한 택배가 있었다.',
        provider: 'leaders_nano_banana_pro',
        model: 'nano-banana-pro',
        apiKey: 'leaders-key',
        endpoint: 'https://leaders.example.test/image',
      }),
    })
    const data = await response.json()
    const input = await readFile(
      join(workspaceRoot, 'projects', 'image-provider-project', 'story-image-input.yaml'),
      'utf8',
    )

    expect(data.ok).toBe(true)
    expect(data.provider).toBe('leaders_nano_banana_pro')
    expect(calls[0].command).toBe('generate-story-images')
    expect(calls[0].args).toEqual([
      'generate-story-images',
      join(workspaceRoot, 'projects', 'image-provider-project', 'story-image-input.yaml'),
      '--provider',
      'leaders_nano_banana_pro',
      '--out-dir',
      join(workspaceRoot, 'projects', 'image-provider-project', 'story-generated'),
      '--model',
      'nano-banana-pro',
    ])
    expect(calls[0].env).toMatchObject({
      LEADERS_NANO_BANANA_API_KEY: 'leaders-key',
      LEADERS_NANO_BANANA_ENDPOINT: 'https://leaders.example.test/image',
    })
    expect(input).toContain('문 앞에 이상한 택배가 있었다.')
    expect(input).not.toContain('leaders-key')
  })

  it('dispatches silence analysis and parses the JSON report', async () => {
    const calls = []
    const report = {
      clip: { file: 'clips/hook.mp4' },
      plan: {
        sourceDurationSec: 10,
        silences: [{ start: 2, end: 3 }],
        remove: [{ start: 2.08, end: 2.92 }],
        keep: [
          { start: 0, end: 2.08, duration: 2.08 },
          { start: 2.92, end: 10, duration: 7.08 },
        ],
        outputDurationSec: 9.16,
      },
    }
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: `> shorts-factory\n${JSON.stringify(report, null, 2)}`, stderr: '' }
    })

    const response = await fetch(`${baseUrl}/api/silence/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: workspaceRoot,
        clipFile: 'clips/hook.mp4',
        noiseDb: -38,
        minDurationSec: 0.4,
        paddingSec: 0.08,
      }),
    })
    const data = await response.json()

    expect(data.ok).toBe(true)
    expect(data.report.plan.outputDurationSec).toBe(9.16)
    expect(calls[0].command).toBe('analyze-silence')
    expect(calls[0].args).toEqual([
      'analyze-silence',
      workspaceRoot,
      '--json',
      '--clip',
      'clips/hook.mp4',
      '--noise-db',
      '-38',
      '--min-duration',
      '0.4',
      '--padding',
      '0.08',
    ])
  })

  it('dispatches auto caption generation and parses the JSON report', async () => {
    const calls = []
    const report = {
      provider: 'mock',
      clip: { file: 'clips/hook.mp4' },
      srtFile: join(workspaceRoot, 'projects', 'caption-project', 'captions', 'hook.auto.srt'),
      cueCount: 2,
      cues: [
        { startMs: 0, endMs: 1500, text: '첫 자막' },
        { startMs: 1500, endMs: 3000, text: '두 번째 자막' },
      ],
      warnings: [],
    }
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: `> shorts-factory\n${JSON.stringify(report, null, 2)}`, stderr: '' }
    })

    const response = await fetch(`${baseUrl}/api/captions/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: workspaceRoot,
        clipFile: 'clips/hook.mp4',
        provider: 'mock',
        language: 'ko',
        model: 'base',
        minChars: 8,
        maxChars: 28,
      }),
    })
    const data = await response.json()

    expect(data.ok).toBe(true)
    expect(data.report.cueCount).toBe(2)
    expect(calls[0].command).toBe('auto-caption')
    expect(calls[0].args).toEqual([
      'auto-caption',
      workspaceRoot,
      '--json',
      '--clip',
      'clips/hook.mp4',
      '--provider',
      'mock',
      '--language',
      'ko',
      '--model',
      'base',
      '--min-chars',
      '8',
      '--max-chars',
      '28',
    ])
  })

  it('saves edited caption cues as an SRT file inside the project', async () => {
    await startServer()
    const projectDir = join(workspaceRoot, 'projects', 'caption-project')
    const response = await fetch(`${baseUrl}/api/captions/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectDir,
        srtFile: 'captions/hook.auto.srt',
        cues: [
          { startMs: 0, endMs: 1500, text: 'first caption' },
          { startMs: 1500, endMs: 3250, text: 'second caption' },
        ],
      }),
    })
    const data = await response.json()

    expect(response.status).toBe(200)
    expect(data.ok).toBe(true)
    expect(data.cueCount).toBe(2)
    await expect(readFile(join(projectDir, 'captions', 'hook.auto.srt'), 'utf8')).resolves.toBe(
      '1\n00:00:00,000 --> 00:00:01,500\nfirst caption\n\n2\n00:00:01,500 --> 00:00:03,250\nsecond caption\n',
    )
  })

  it('blocks caption saves outside the project directory', async () => {
    await startServer()
    const projectDir = join(workspaceRoot, 'projects', 'caption-project')
    const response = await fetch(`${baseUrl}/api/captions/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectPath: projectDir,
        srtFile: '../outside.srt',
        cues: [{ startMs: 0, endMs: 1000, text: 'blocked' }],
      }),
    })
    const data = await response.json()

    expect(response.status).toBe(403)
    expect(data.ok).toBe(false)
  })

  it('saves and lists voices with transcripts', async () => {
    await startServer()
    // 저장 시 ffmpeg 잡음 제거를 거치므로 실제 유효한 wav 바이트가 필요하다.
    const save = await fetch(`${baseUrl}/api/voices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '내 목소리',
        audioData: makeTestWav().toString('base64'),
        transcript: '안녕하세요 테스트입니다',
      }),
    })
    const saveData = await save.json()
    expect(saveData.ok).toBe(true)
    expect(saveData.hasTranscript).toBe(true)

    const list = await fetch(`${baseUrl}/api/voices`)
    const listData = await list.json()
    expect(listData.ok).toBe(true)
    expect(listData.voices).toHaveLength(1)
    expect(listData.voices[0].hasTranscript).toBe(true)
    await expect(
      readFile(join(workspaceRoot, 'voices', `${listData.voices[0].name}.txt`), 'utf8'),
    ).resolves.toBe('안녕하세요 테스트입니다')
  })

  it('deletes a saved voice (wav and transcript)', async () => {
    await startServer()
    await fetch(`${baseUrl}/api/voices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: '지울목소리',
        audioData: makeTestWav().toString('base64'),
        transcript: '삭제 테스트',
      }),
    })
    const del = await fetch(`${baseUrl}/api/voices/${encodeURIComponent('지울목소리')}`, { method: 'DELETE' })
    const delData = await del.json()
    expect(delData.ok).toBe(true)

    const listData = await (await fetch(`${baseUrl}/api/voices`)).json()
    expect(listData.voices).toHaveLength(0)
  })

  it('rejects deleting a voice with a path-traversal name', async () => {
    await startServer()
    const del = await fetch(`${baseUrl}/api/voices/..%2F..%2Fsecret`, { method: 'DELETE' })
    expect(del.status).toBe(400)
  })

  it('serves narration progress from the CLI progress file', async () => {
    await startServer()
    const { mkdir: mkdirp } = await import('node:fs/promises')
    const testDir = join(workspaceRoot, 'tmp', 'voice-test')
    await mkdirp(testDir, { recursive: true })
    const { writeFile: write } = await import('node:fs/promises')
    await write(
      join(testDir, '내목소리.wav.progress.json'),
      JSON.stringify({ status: 'running', done: 3, total: 16 }),
      'utf8',
    )
    const data = await (await fetch(`${baseUrl}/api/voices/progress?voice=${encodeURIComponent('내목소리')}`)).json()
    expect(data.ok).toBe(true)
    expect(data.progress.done).toBe(3)
    expect(data.progress.total).toBe(16)

    const empty = await (await fetch(`${baseUrl}/api/voices/progress?voice=none`)).json()
    expect(empty.ok).toBe(true)
    expect(empty.progress).toBeNull()
  })

  it('cancels a running narration via the cancel endpoint', async () => {
    // 끝나지 않는 CLI를 흉내 내고, kill되면 실패 코드로 끝나게 한다.
    const fakeChild = { killed: false, kill() { this.killed = true; this.onKill?.() } }
    await startServer((call) => {
      call.onSpawn?.(fakeChild)
      return new Promise((resolve) => {
        fakeChild.onKill = () => resolve({ exitCode: 1, stdout: '', stderr: 'killed' })
      })
    })

    const testPromise = fetch(`${baseUrl}/api/voices/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: '내목소리', text: '아주 긴 대본.' }),
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    const cancel = await fetch(`${baseUrl}/api/voices/test/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: '내목소리' }),
    })
    const cancelData = await cancel.json()
    expect(cancelData.ok).toBe(true)
    expect(fakeChild.killed).toBe(true)

    const testData = await (await testPromise).json()
    expect(testData.ok).toBe(false)
    expect(testData.cancelled).toBe(true)
  })

  it('rejects a second narration while one is already running (single GPU)', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await startServer(async () => {
      await gate
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const first = fetch(`${baseUrl}/api/voices/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: '내목소리', text: '긴 대본.' }),
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    const second = await fetch(`${baseUrl}/api/voices/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: '내목소리', text: '다른 대본.' }),
    })
    const secondData = await second.json()
    expect(secondData.ok).toBe(false)
    expect(secondData.busy).toBe(true)

    release()
    expect((await (await first).json()).ok).toBe(true)
  })

  it('cancels a narration even before the CLI process spawns (directing phase)', async () => {
    // 자식 프로세스를 아직 안 띄운 러너 — 연출 추론 단계처럼 child가 없는 상태를 흉내 낸다.
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await startServer(async () => {
      await gate
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const testPromise = fetch(`${baseUrl}/api/voices/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: '내목소리', text: '긴 대본.' }),
    })
    await new Promise((resolve) => setTimeout(resolve, 100))

    const cancel = await fetch(`${baseUrl}/api/voices/test/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: '내목소리' }),
    })
    expect((await cancel.json()).ok).toBe(true)

    release()
    const testData = await (await testPromise).json()
    expect(testData.ok).toBe(false)
    expect(testData.cancelled).toBe(true)
  })

  it('returns ok:false when cancelling a narration that is not running', async () => {
    await startServer()
    const cancel = await fetch(`${baseUrl}/api/voices/test/cancel`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: '없는목소리' }),
    })
    const data = await cancel.json()
    expect(data.ok).toBe(false)
  })

  it('reuses a cached voice sample instead of regenerating', async () => {
    const calls = []
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    // 이미 만들어진 샘플이 있는 상황
    const { mkdir: mkdirp, writeFile: write } = await import('node:fs/promises')
    const testDir = join(workspaceRoot, 'tmp', 'voice-test')
    await mkdirp(testDir, { recursive: true })
    const sampleText = '캐시 확인용 테스트 문장입니다.'
    await write(join(testDir, '내목소리.sample.txt'), sampleText, 'utf8')
    await write(join(testDir, '내목소리.sample.wav'), makeTestWav(), 'binary')

    const response = await fetch(`${baseUrl}/api/voices/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: '내목소리', sample: true, text: sampleText }),
    })
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.cached).toBe(true)
    expect(calls).toHaveLength(0)

    const check = await (await fetch(`${baseUrl}/api/voices/sample?voice=${encodeURIComponent('내목소리')}`)).json()
    expect(check.exists).toBe(true)
  })

  it('rejects a voice save without audio data', async () => {
    await startServer()
    const response = await fetch(`${baseUrl}/api/voices`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'x' }),
    })
    expect(response.status).toBe(400)
  })

  it('dispatches narrate through the command runner', async () => {
    const calls = []
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: 'narrate ok', stderr: '' }
    })
    const response = await fetch(`${baseUrl}/api/narrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ storyboardPath: 'projects/p/storyboard.yaml', voice: 'me', provider: 'mock' }),
    })
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(calls[0].args).toContain('narrate')
    expect(calls[0].args).toContain('--voice')
    expect(calls[0].args).toContain('me')
  })

  it('routes a typecast voice test to the typecast provider with the api key', async () => {
    const calls = []
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const response = await fetch(`${baseUrl}/api/voices/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        voice: 'typecast:tc_abc123',
        text: '타입캐스트 목소리 테스트 문장입니다.',
        typecastApiKey: 'tc-key',
      }),
    })
    const data = await response.json()
    expect(data.ok).toBe(true)
    // 파일 경로는 안전한 이름을 쓰되, CLI에는 원본 typecast:<id>가 전달돼야 한다.
    expect(calls[0].args).toContain('--voice')
    expect(calls[0].args).toContain('typecast:tc_abc123')
    expect(calls[0].args).toContain('--provider')
    expect(calls[0].args).toContain('typecast')
    expect(calls[0].env?.TYPECAST_API_KEY).toBe('tc-key')
  })

  it('passes a typecast voice and key through the story pipeline', async () => {
    const calls = []
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: 'pipeline ok', stderr: '' }
    })
    const response = await fetch(`${baseUrl}/api/story-pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: 'typecast-pipeline',
        script: '첫 문장입니다. 둘째 문장입니다.',
        voice: 'typecast:tc_abc123',
        ttsProvider: 'typecast',
        typecastApiKey: 'tc-key',
        imageProvider: 'mock',
      }),
    })
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(calls[0].args).toContain('--tts-provider')
    expect(calls[0].args).toContain('typecast')
    expect(calls[0].args).toContain('typecast:tc_abc123')
    expect(calls[0].env?.TYPECAST_API_KEY).toBe('tc-key')
  })

  it('coupang analyze: 캡처 없이 요청하면 400', async () => {
    await startServer()
    const response = await fetch(`${baseUrl}/api/coupang/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectName: 'coupang-x', images: [] }),
    })
    expect(response.status).toBe(400)
  })

  it('coupang analyze: 프로젝트 밖 경로는 403', async () => {
    await startServer()
    const response = await fetch(`${baseUrl}/api/coupang/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectName: 'coupang-x', images: ['../../secret.png'] }),
    })
    expect(response.status).toBe(403)
  })

  it('coupang analyze: 캡처를 비전 API로 보내 상품정보 JSON을 받는다', async () => {
    await startServer()
    const { mkdir: mkdirp, writeFile: write } = await import('node:fs/promises')
    const imagesDir = join(workspaceRoot, 'projects', 'coupang-vision', 'images')
    await mkdirp(imagesDir, { recursive: true })
    await write(join(imagesDir, 'capture.png'), Buffer.from('fake-png'))

    const upstreamBodies = []
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.openai.com')) {
        upstreamBodies.push(JSON.parse(init.body))
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    '{"productName":"접이식 선반","benefit":"수납 2배","painPoint":"좁은 주방","pricePoint":"오늘 40% 할인"}',
                },
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return realFetch(url, init)
    }
    try {
      const response = await fetch(`${baseUrl}/api/coupang/analyze`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectName: 'coupang-vision',
          images: ['images/capture.png'],
          method: 'api-gpt',
          apiKey: 'test-key',
        }),
      })
      const data = await response.json()
      expect(data.ok).toBe(true)
      expect(data.productInfo).toMatchObject({ productName: '접이식 선반', benefit: '수납 2배' })
      // 비전 본문에 이미지가 실렸는지
      const content = upstreamBodies[0]?.messages?.[0]?.content
      expect(Array.isArray(content)).toBe(true)
      expect(content.some((part) => part.type === 'image_url')).toBe(true)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('coupang 모드 대본 생성은 커머스 프롬프트를 쓴다', async () => {
    await startServer()
    const prompts = []
    const realFetch = globalThis.fetch
    globalThis.fetch = async (url, init) => {
      if (String(url).includes('api.openai.com')) {
        const body = JSON.parse(init.body)
        prompts.push(String(body.messages?.[0]?.content ?? ''))
        return new Response(
          JSON.stringify({ choices: [{ message: { content: '후킹 문장입니다. 사용 장면입니다. 변화 문장입니다. 지금 확인하세요.' } }] }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        )
      }
      return realFetch(url, init)
    }
    try {
      const response = await fetch(`${baseUrl}/api/script/generate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mode: 'coupang',
          productInfo: { productName: '접이식 선반', benefit: '수납 2배', painPoint: '좁은 주방' },
          method: 'api-gpt',
          apiKey: 'test-key',
          durationSec: 18,
        }),
      })
      const data = await response.json()
      expect(data.ok).toBe(true)
      expect(data.script.length).toBeGreaterThan(0)
      expect(prompts.some((prompt) => prompt.includes('커머스 쇼츠 카피라이터') && prompt.includes('접이식 선반'))).toBe(true)
    } finally {
      globalThis.fetch = realFetch
    }
  })

  it('story-pipeline이 상품 프로파일·참조 이미지·센터 자막 옵션을 전달한다', async () => {
    const calls = []
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: 'pipeline ok', stderr: '' }
    })
    const { mkdir: mkdirp, writeFile: write } = await import('node:fs/promises')
    const imagesDir = join(workspaceRoot, 'projects', 'coupang-pipe', 'images')
    await mkdirp(imagesDir, { recursive: true })
    await write(join(imagesDir, 'cap.png'), Buffer.from('fake'))

    const response = await fetch(`${baseUrl}/api/story-pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: 'coupang-pipe',
        script: '후킹 문장입니다. 사용 장면입니다.',
        imageProvider: 'mock',
        ttsProvider: 'mock',
        promptProfile: 'product',
        referenceImages: ['images/cap.png'],
        disclosure: '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.',
        captionPosition: 'center',
        captionMaxChars: 12,
        maxSceneChars: 20,
      }),
    })
    const data = await response.json()
    expect(data.ok).toBe(true)
    const args = calls[0].args
    expect(args).toContain('--caption-position')
    expect(args[args.indexOf('--caption-position') + 1]).toBe('center')
    expect(args).toContain('--caption-max-chars')
    expect(args[args.indexOf('--caption-max-chars') + 1]).toBe('12')

    const yaml = await readFile(join(workspaceRoot, 'projects', 'coupang-pipe', 'story-input.yaml'), 'utf8')
    expect(yaml).toContain('promptProfile: product')
    expect(yaml).toContain('cap.png')
    expect(yaml).toContain('쿠팡 파트너스')
  })

  it('proxies the typecast voice catalog with the api key header', async () => {
    const { createServer: createHttpServer } = await import('node:http')
    const upstream = createHttpServer((req, res) => {
      if (req.headers['x-api-key'] !== 'tc-key') {
        res.writeHead(401, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: 'unauthorized' }))
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify([{ voice_id: 'tc_abc', voice_name: '민준', model: 'ssfm-v30' }]))
    })
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
    process.env.TYPECAST_API_BASE = `http://127.0.0.1:${upstream.address().port}`
    try {
      await startServer()
      const response = await fetch(`${baseUrl}/api/typecast/voices`, {
        headers: { 'x-typecast-key': 'tc-key' },
      })
      const data = await response.json()
      expect(data.ok).toBe(true)
      expect(data.voices[0]).toMatchObject({ id: 'tc_abc', name: '민준' })

      const unauthorized = await fetch(`${baseUrl}/api/typecast/voices`, {
        headers: { 'x-typecast-key': 'wrong' },
      })
      const unauthorizedData = await unauthorized.json()
      expect(unauthorizedData.ok).toBe(false)
    } finally {
      delete process.env.TYPECAST_API_BASE
      await new Promise((resolve) => upstream.close(resolve))
    }
  })

  it('serves selectable narration styles to every UI', async () => {
    await startServer()
    const response = await fetch(`${baseUrl}/api/narration-styles`)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.styles.length).toBeGreaterThanOrEqual(22)
    expect(data.styles.map((style) => style.id)).toContain('shopping-host')
  })

  it('applies a selected narration style without requiring AI directing', async () => {
    const calls = []
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const response = await fetch(`${baseUrl}/api/voices/test`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        voice: '내목소리',
        text: '지금 확인하세요. 오늘만 이 가격입니다!',
        styleId: 'shopping-host',
        styleStrength: 3,
      }),
    })
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.style.id).toBe('shopping-host')
    const deliveryIndex = calls[0].args.indexOf('--delivery')
    expect(deliveryIndex).toBeGreaterThan(0)
    const plan = JSON.parse(await readFile(calls[0].args[deliveryIndex + 1], 'utf8'))
    expect(plan).toHaveLength(2)
    expect(plan[0]).toMatchObject({ ending: 'crisp' })
    expect(plan[0].gain).toBeGreaterThan(0)
  })

  it('serves script templates through the command runner', async () => {
    await startServer(async () => ({
      exitCode: 0,
      stdout: JSON.stringify({ ok: true, templates: [{ key: 'twist', label: '반전형' }] }),
      stderr: '',
    }))
    const response = await fetch(`${baseUrl}/api/script-templates`)
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.templates[0].key).toBe('twist')
  })

  it('writes pipeline input and dispatches story-pipeline with voice and providers', async () => {
    const calls = []
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: 'pipeline ok', stderr: '' }
    })
    const response = await fetch(`${baseUrl}/api/story-pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: 'wizard-test',
        title: '한밤의 택배',
        script: '첫 문장입니다. 둘째 문장입니다.',
        voice: 'me',
        narrationStyle: 'storyteller',
        narrationStrength: 3,
        imageProvider: 'mock',
        ttsProvider: 'mock',
      }),
    })
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.finalVideo).toContain('video_01.mp4')

    const input = await readFile(join(workspaceRoot, 'projects', 'wizard-test', 'story-input.yaml'), 'utf8')
    expect(input).toContain('한밤의 택배')
    expect(calls[0].args).toContain('story-pipeline')
    expect(calls[0].args).toContain('--voice')
    expect(calls[0].args).toContain('--tts-provider')
    expect(calls[0].args).toContain('mock')
    expect(calls[0].args).toContain('--delivery')
    const deliveryIndex = calls[0].args.indexOf('--delivery')
    const delivery = JSON.parse(await readFile(calls[0].args[deliveryIndex + 1], 'utf8'))
    expect(delivery.styleId).toBe('storyteller')
    expect(delivery.strength).toBe(3)
  })

  it('rejects story-pipeline without a script', async () => {
    await startServer()
    const response = await fetch(`${baseUrl}/api/story-pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectName: 'x' }),
    })
    expect(response.status).toBe(400)
  })

  it('creates shopping narration with the selected sales style before rendering', async () => {
    const calls = []
    await startServer(async (call) => {
      calls.push(call)
      return { exitCode: 0, stdout: 'ok', stderr: '' }
    })
    const response = await fetch(`${baseUrl}/api/product-pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: 'shopping-voice-test',
        productName: '접이식 선반',
        benefit: '수납공간이 늘어남',
        painPoint: '좁은 주방',
        clips: ['clips/a.mp4'],
        variants: 2,
        voice: 'me',
        narrationStyle: 'shopping-host',
        narrationStrength: 3,
      }),
    })
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(calls.map((call) => call.command)).toEqual(['narrate', 'product-render'])
    expect(calls[0].args).toContain('--delivery')
    const spec = JSON.parse(
      await readFile(join(workspaceRoot, 'projects', 'shopping-voice-test', 'product-spec.json'), 'utf8'),
    )
    expect(spec.narrationFile).toBe('narration/product-narration.wav')
    const delivery = JSON.parse(
      await readFile(join(workspaceRoot, 'projects', 'shopping-voice-test', 'narration-delivery.json'), 'utf8'),
    )
    expect(delivery.styleId).toBe('shopping-host')
    expect(delivery.strength).toBe(3)
  })

  it('runs story-pipeline as an async job and reports completion', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await startServer(async () => {
      await gate
      return { exitCode: 0, stdout: 'pipeline ok', stderr: '' }
    })

    const start = await fetch(`${baseUrl}/api/story-pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectName: 'async-job', script: '문장.', async: true }),
    })
    const startData = await start.json()
    expect(startData.ok).toBe(true)
    expect(startData.jobId).toBeTruthy()

    const runningData = await (await fetch(`${baseUrl}/api/jobs/${startData.jobId}`)).json()
    expect(runningData.status).toBe('running')

    release()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const doneData = await (await fetch(`${baseUrl}/api/jobs/${startData.jobId}`)).json()
    expect(doneData.status).toBe('done')
    expect(doneData.exitCode).toBe(0)
  })

  it('streams live log lines while an async job is running', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    await startServer(async (call) => {
      call.onOutput?.('이미지 3/11 생성 중...\n')
      call.onOutput?.('이미지 4/11 생성 중...\n')
      await gate
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const start = await fetch(`${baseUrl}/api/story-pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectName: 'log-job', script: '문장.', async: true }),
    })
    const { jobId } = await start.json()
    await new Promise((resolve) => setTimeout(resolve, 80))

    const jobData = await (await fetch(`${baseUrl}/api/jobs/${jobId}`)).json()
    expect(jobData.status).toBe('running')
    expect((jobData.logTail || []).join('\n')).toContain('이미지 4/11')
    release()
  })

  it('marks async job as error when the runner fails', async () => {
    await startServer(async () => ({ exitCode: 1, stdout: '', stderr: '이미지 생성 실패' }))
    const start = await fetch(`${baseUrl}/api/story-pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectName: 'async-fail', script: '문장.', async: true }),
    })
    const { jobId } = await start.json()
    await new Promise((resolve) => setTimeout(resolve, 50))
    const jobData = await (await fetch(`${baseUrl}/api/jobs/${jobId}`)).json()
    expect(jobData.status).toBe('error')
    expect(jobData.stderrTail).toContain('이미지 생성 실패')
  })

  it('saves a diagnostics report with recent CLI runs and job state', async () => {
    await startServer(async () => ({ exitCode: 1, stdout: '', stderr: '드롭샷 이미지 생성 실패: 150초 내 미발견' }))
    // 실패하는 파이프라인을 하나 돌려 진단 기록을 만든다.
    await fetch(`${baseUrl}/api/story-pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectName: 'diag-test', script: '문장.', async: true }),
    })
    await new Promise((resolve) => setTimeout(resolve, 80))

    const targetDir = join(workspaceRoot, 'diag-out')
    const response = await fetch(`${baseUrl}/api/diagnostics/save`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ targetDir }),
    })
    const data = await response.json()
    expect(data.ok).toBe(true)
    expect(data.file).toContain('진단로그')

    const report = await readFile(data.file, 'utf8')
    expect(report).toContain('쇼츠팩토리 진단 로그')
    expect(report).toContain('diag-test')
    expect(report).toContain('드롭샷 이미지 생성 실패')
  })

  it('renames a saved narration', async () => {
    await startServer()
    const { mkdir: mkdirp, writeFile: write } = await import('node:fs/promises')
    const dir = join(workspaceRoot, 'projects', 'narrations')
    await mkdirp(dir, { recursive: true })
    await write(join(dir, '옛이름.wav'), makeTestWav(), 'binary')

    const response = await fetch(`${baseUrl}/api/narrations/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '옛이름', to: '새이름' }),
    })
    const data = await response.json()
    expect(data.ok).toBe(true)

    const list = await (await fetch(`${baseUrl}/api/narrations`)).json()
    expect(list.narrations.map((n) => n.name)).toContain('새이름')
    expect(list.narrations.map((n) => n.name)).not.toContain('옛이름')
  })

  it('rejects renaming a narration onto an existing name', async () => {
    await startServer()
    const { mkdir: mkdirp, writeFile: write } = await import('node:fs/promises')
    const dir = join(workspaceRoot, 'projects', 'narrations')
    await mkdirp(dir, { recursive: true })
    await write(join(dir, 'a.wav'), makeTestWav(), 'binary')
    await write(join(dir, 'b.wav'), makeTestWav(), 'binary')

    const response = await fetch(`${baseUrl}/api/narrations/rename`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: 'a', to: 'b' }),
    })
    const data = await response.json()
    expect(data.ok).toBe(false)
  })

  it('lists previously generated images across projects for the gallery', async () => {
    await startServer()
    const { mkdir: mkdirp, writeFile: write } = await import('node:fs/promises')
    const imagesDir = join(workspaceRoot, 'projects', 'old-story', 'pipeline', 'images')
    await mkdirp(imagesDir, { recursive: true })
    await write(join(imagesDir, 'scene_01.png'), Buffer.from('fake-png'))
    await write(
      join(workspaceRoot, 'projects', 'old-story', 'story-input.yaml'),
      'projectName: old-story\ntitle: 옆집 아줌마의 비밀\nscript: 문장.\n',
      'utf8',
    )
    const legacyDir = join(workspaceRoot, 'projects', 'legacy', 'story-generated', 'images')
    await mkdirp(legacyDir, { recursive: true })
    await write(join(legacyDir, 'scene_02.png'), Buffer.from('fake-png'))

    // 영상(모션 클립·최종 렌더)도 보관함에 나온다
    const motionDir = join(workspaceRoot, 'projects', 'old-story', 'pipeline', 'motion')
    await mkdirp(motionDir, { recursive: true })
    await write(join(motionDir, 'scene_01.mp4'), Buffer.from('fake-mp4'))
    const outputDir = join(workspaceRoot, 'projects', 'old-story', 'pipeline', 'video', 'output')
    await mkdirp(outputDir, { recursive: true })
    await write(join(outputDir, 'video_01.mp4'), Buffer.from('fake-mp4'))

    const data = await (await fetch(`${baseUrl}/api/gallery/images`)).json()
    expect(data.ok).toBe(true)
    expect(data.images.length).toBe(4)
    const projects = data.images.map((img) => img.project)
    expect(projects).toContain('old-story')
    expect(projects).toContain('legacy')
    expect(data.images[0].url).toContain('/api/media/preview')
    expect(data.images.filter((img) => img.type === 'video').length).toBe(2)
    expect(data.images.filter((img) => img.type === 'image').length).toBe(2)
    // 대본 제목이 있으면 그걸 그룹 제목으로 쓴다 (없으면 프로젝트 이름)
    const titled = data.images.find((img) => img.project === 'old-story')
    expect(titled.title).toBe('옆집 아줌마의 비밀')
  })

  it('deletes a gallery image within allowed folders only', async () => {
    await startServer()
    const { mkdir: mkdirp, writeFile: write } = await import('node:fs/promises')
    const imagesDir = join(workspaceRoot, 'projects', 'old-story', 'pipeline', 'images')
    await mkdirp(imagesDir, { recursive: true })
    await write(join(imagesDir, 'scene_01.png'), Buffer.from('fake-png'))

    const del = await fetch(`${baseUrl}/api/gallery/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'old-story', file: 'pipeline/images/scene_01.png' }),
    })
    expect((await del.json()).ok).toBe(true)
    const data = await (await fetch(`${baseUrl}/api/gallery/images`)).json()
    expect(data.images.length).toBe(0)

    // 허용 폴더 밖(경로 조작)은 거부
    const bad = await fetch(`${baseUrl}/api/gallery/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'old-story', file: '../../voices/secret.png' }),
    })
    expect(bad.status).toBe(400)
  })

  it('deletes all gallery images of a project at once', async () => {
    await startServer()
    const { mkdir: mkdirp, writeFile: write } = await import('node:fs/promises')
    const imagesDir = join(workspaceRoot, 'projects', 'bulk-story', 'pipeline', 'images')
    await mkdirp(imagesDir, { recursive: true })
    await write(join(imagesDir, 'scene_01.png'), Buffer.from('a'))
    await write(join(imagesDir, 'scene_02.png'), Buffer.from('b'))
    // 이미지가 아닌 파일은 남아야 한다
    await write(join(imagesDir, 'notes.txt'), 'keep me', 'utf8')

    const del = await fetch(`${baseUrl}/api/gallery/delete-project`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ project: 'bulk-story' }),
    })
    const delData = await del.json()
    expect(delData.ok).toBe(true)
    expect(delData.deleted).toBe(2)

    const list = await (await fetch(`${baseUrl}/api/gallery/images`)).json()
    expect(list.images.length).toBe(0)
    await expect(readFile(join(imagesDir, 'notes.txt'), 'utf8')).resolves.toBe('keep me')
  })

  it('queues multiple pipeline jobs, runs them one at a time, and lists them all', async () => {
    let releaseFirst
    const firstGate = new Promise((resolve) => {
      releaseFirst = resolve
    })
    let calls = 0
    await startServer(async () => {
      calls += 1
      if (calls === 1) await firstGate
      return { exitCode: 0, stdout: '', stderr: '' }
    })

    const submit = (name) =>
      fetch(`${baseUrl}/api/story-pipeline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectName: name, script: '문장.', async: true }),
      }).then((res) => res.json())

    const first = await submit('multi-a')
    const second = await submit('multi-b')
    await new Promise((resolve) => setTimeout(resolve, 100))

    // 첫 번째는 실행 중, 두 번째는 대기(무거운 단계 충돌 방지를 위해 순차 실행)
    const list = await (await fetch(`${baseUrl}/api/jobs`)).json()
    expect(list.ok).toBe(true)
    const byId = new Map(list.jobs.map((job) => [job.id, job]))
    expect(byId.get(first.jobId)?.status).toBe('running')
    expect(byId.get(second.jobId)?.status).toBe('queued')

    releaseFirst()
    await new Promise((resolve) => setTimeout(resolve, 150))
    const after = await (await fetch(`${baseUrl}/api/jobs`)).json()
    const afterById = new Map(after.jobs.map((job) => [job.id, job]))
    expect(afterById.get(first.jobId)?.status).toBe('done')
    expect(afterById.get(second.jobId)?.status).toBe('done')
  })

  it('cancels a queued pipeline job before it runs', async () => {
    let release
    const gate = new Promise((resolve) => {
      release = resolve
    })
    let calls = 0
    await startServer(async () => {
      calls += 1
      if (calls === 1) await gate
      return { exitCode: 0, stdout: '', stderr: '' }
    })
    const submit = (name) =>
      fetch(`${baseUrl}/api/story-pipeline`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectName: name, script: '문장.', async: true }),
      }).then((res) => res.json())

    await submit('cq-a')
    const second = await submit('cq-b')
    const cancel = await (
      await fetch(`${baseUrl}/api/jobs/${second.jobId}/cancel`, { method: 'POST' })
    ).json()
    expect(cancel.ok).toBe(true)

    release()
    await new Promise((resolve) => setTimeout(resolve, 150))
    const list = await (await fetch(`${baseUrl}/api/jobs`)).json()
    const byId = new Map(list.jobs.map((job) => [job.id, job]))
    expect(byId.get(second.jobId)?.status).toBe('cancelled')
    expect(calls).toBe(1)
  })

  it('returns 404 for an unknown job id', async () => {
    await startServer()
    const response = await fetch(`${baseUrl}/api/jobs/none`)
    expect(response.status).toBe(404)
  })

  it('reports error when progress says error but the CLI process hangs (circuit breaker)', async () => {
    // 절대 끝나지 않는 CLI를 흉내 낸다 — progress.json에는 실패가 기록된 상황.
    await startServer(() => new Promise(() => {}))
    const start = await fetch(`${baseUrl}/api/story-pipeline`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectName: 'zombie-job', script: '문장.', async: true }),
    })
    const { jobId, pipelineDir } = await start.json()

    const { mkdir, writeFile: write } = await import('node:fs/promises')
    await mkdir(pipelineDir, { recursive: true })
    const staleProgress = {
      status: 'error',
      stages: ['images'],
      current: 'images',
      completed: [],
      updatedAt: new Date(Date.now() - 60_000).toISOString(),
    }
    await write(join(pipelineDir, 'progress.json'), JSON.stringify(staleProgress), 'utf8')

    const jobData = await (await fetch(`${baseUrl}/api/jobs/${jobId}`)).json()
    expect(jobData.status).toBe('error')
    expect(jobData.stderrTail).toContain('images 단계 실패')
  })
})
