/* global Buffer, process */
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { findVideoUrl, jobSetStatus, makeHiggsfieldVideo } from './higgsfield-generator.mjs'

describe('findVideoUrl / jobSetStatus', () => {
  it('중첩 응답 어디서든 첫 영상 URL을 찾는다', () => {
    expect(
      findVideoUrl({ jobs: [{ status: 'completed', results: { raw: { url: 'https://cdn.x/video.mp4?sig=1' } } }] }),
    ).toBe('https://cdn.x/video.mp4?sig=1')
    expect(findVideoUrl({ jobs: [{ results: { url: 'https://cdn.x/img.png' } }] })).toBeNull()
  })

  it('job 상태를 종합한다', () => {
    expect(jobSetStatus({ jobs: [{ status: 'completed' }, { status: 'completed' }] })).toBe('completed')
    expect(jobSetStatus({ jobs: [{ status: 'in_progress' }] })).toBeNull()
    expect(jobSetStatus({ jobs: [{ status: 'failed' }] })).toBe('failed')
    expect(jobSetStatus({ jobs: [{ status: 'nsfw' }] })).toBe('nsfw')
    expect(jobSetStatus({})).toBeNull()
  })
})

describe('makeHiggsfieldVideo', () => {
  let server
  let workDir
  const requests = []

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'sf-higgsfield-'))
    requests.length = 0
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += String(chunk)
      })
      req.on('end', () => {
        requests.push({ url: req.url, headers: req.headers, body })
        if (req.url === '/v1/image2video/dop') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ id: 'js_123', jobs: [{ status: 'queued' }] }))
          return
        }
        if (req.url === '/v1/job-sets/js_123') {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'js_123',
              jobs: [{ status: 'completed', results: { raw: { url: `http://127.0.0.1:${server.address().port}/video.mp4` } } }],
            }),
          )
          return
        }
        if (req.url === '/video.mp4') {
          res.writeHead(200, { 'content-type': 'video/mp4' })
          res.end(Buffer.from('fake-mp4-bytes'))
          return
        }
        res.writeHead(404)
        res.end('{}')
      })
    })
    await new Promise((resolveListen) => server.listen(0, '127.0.0.1', resolveListen))
    process.env.HIGGSFIELD_API_BASE = `http://127.0.0.1:${server.address().port}`
  })

  afterEach(async () => {
    delete process.env.HIGGSFIELD_API_BASE
    await new Promise((resolveClose) => server.close(resolveClose))
    await rm(workDir, { recursive: true, force: true })
  })

  it('등록→폴링→다운로드 흐름으로 mp4를 저장한다', async () => {
    const imagePath = join(workDir, 'scene.png')
    await writeFile(imagePath, Buffer.from('fake-png'))
    const outPath = join(workDir, 'scene_01.mp4')

    const result = await makeHiggsfieldVideo(
      '부드러운 카메라 이동',
      { apiKey: 'hf-key', apiSecret: 'hf-secret', imagePath, outPath },
      () => {},
    )

    expect(result.ok).toBe(true)
    await expect(readFile(outPath, 'utf8')).resolves.toBe('fake-mp4-bytes')

    const submit = requests.find((request) => request.url === '/v1/image2video/dop')
    expect(submit.headers['hf-api-key']).toBe('hf-key')
    expect(submit.headers['hf-secret']).toBe('hf-secret')
    const body = JSON.parse(submit.body)
    expect(body.params.model).toBe('dop-turbo')
    expect(body.params.prompt).toContain('카메라')
    expect(body.params.input_images[0].image_url).toMatch(/^data:image\/png;base64,/)
  }, 20000)

  it('키가 없으면 친절한 오류를 낸다', async () => {
    const result = await makeHiggsfieldVideo('x', { apiKey: '', apiSecret: '', imagePath: 'x', outPath: 'y' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('API 키')
  })
})
