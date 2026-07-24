import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTypecastProvider, typecastVoiceId, wavDurationSec } from './typecastProvider.js'

/** 24kHz 모노 16bit PCM wav 버퍼를 만든다(durationSec 길이). */
function makeWav(durationSec: number): Buffer {
  const sampleRate = 24000
  const bytesPerSample = 2
  const dataSize = Math.round(sampleRate * durationSec) * bytesPerSample
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(sampleRate * bytesPerSample, 28)
  header.writeUInt16LE(bytesPerSample, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, Buffer.alloc(dataSize)])
}

describe('typecastVoiceId', () => {
  it('strips the typecast: prefix', () => {
    expect(typecastVoiceId('typecast:tc_abc123')).toBe('tc_abc123')
    expect(typecastVoiceId('tc_abc123')).toBe('tc_abc123')
  })
})

describe('wavDurationSec', () => {
  it('reads duration from the wav header', () => {
    expect(wavDurationSec(makeWav(0.5))).toBeCloseTo(0.5, 2)
    expect(wavDurationSec(makeWav(2))).toBeCloseTo(2, 2)
  })
})

describe('createTypecastProvider', () => {
  let server: Server
  let baseUrl: string
  let workDir: string
  let requests: Array<{ path: string; headers: Record<string, string | string[] | undefined>; body: string }>

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'sf-typecast-'))
    requests = []
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (chunk) => {
        body += String(chunk)
      })
      req.on('end', () => {
        requests.push({ path: req.url ?? '', headers: req.headers, body })
        if (req.headers['x-api-key'] !== 'good-key') {
          res.writeHead(401, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ message: 'unauthorized' }))
          return
        }
        res.writeHead(200, { 'content-type': 'audio/wav' })
        res.end(makeWav(1.5))
      })
    })
    await new Promise<void>((resolveListen) => {
      server.listen(0, '127.0.0.1', () => resolveListen())
    })
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('server address unavailable')
    baseUrl = `http://127.0.0.1:${address.port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    await rm(workDir, { recursive: true, force: true })
  })

  it('synthesizes each item to a wav file with durations', async () => {
    const provider = createTypecastProvider({ apiKey: 'good-key', apiBase: baseUrl })
    const out1 = join(workDir, 'part1.wav')
    const out2 = join(workDir, 'nested', 'part2.wav')
    const progress: Array<[number, number]> = []
    const result = await provider.synthesize({
      refAudio: 'typecast:tc_abc123',
      language: 'Korean',
      items: [
        { text: '첫 문장입니다.', out: out1 },
        { text: '두 번째 문장입니다.', out: out2 },
      ],
      onProgress: (done, total) => {
        progress.push([done, total])
      },
    })

    expect(result.ok).toBe(true)
    expect(result.results).toHaveLength(2)
    expect(result.results[0]?.durationSec).toBeCloseTo(1.5, 1)
    await expect(readFile(out1)).resolves.toBeInstanceOf(Buffer)
    await expect(readFile(out2)).resolves.toBeInstanceOf(Buffer)
    expect(progress).toEqual([
      [1, 2],
      [2, 2],
    ])

    const first = JSON.parse(requests[0]?.body ?? '{}') as Record<string, unknown>
    expect(requests[0]?.path).toBe('/v1/text-to-speech')
    expect(first.voice_id).toBe('tc_abc123')
    expect(first.language).toBe('kor')
    expect(first.text).toBe('첫 문장입니다.')
    const output = first.output as Record<string, unknown>
    expect(output.audio_format).toBe('wav')
  })

  it('fails with a friendly message when the api key is missing', async () => {
    const provider = createTypecastProvider({ apiKey: '', apiBase: baseUrl })
    await expect(
      provider.synthesize({
        refAudio: 'typecast:tc_abc123',
        language: 'Korean',
        items: [{ text: '문장', out: join(workDir, 'x.wav') }],
      }),
    ).rejects.toThrow(/API 키/)
  })

  it('fails with a friendly message on 401', async () => {
    const provider = createTypecastProvider({ apiKey: 'bad-key', apiBase: baseUrl })
    await expect(
      provider.synthesize({
        refAudio: 'typecast:tc_abc123',
        language: 'Korean',
        items: [{ text: '문장', out: join(workDir, 'x.wav') }],
      }),
    ).rejects.toThrow(/키가 올바르지/)
  })

  it('rejects a non-typecast voice reference', async () => {
    const provider = createTypecastProvider({ apiKey: 'good-key', apiBase: baseUrl })
    await expect(
      provider.synthesize({
        refAudio: 'C:/voices/me.wav',
        language: 'Korean',
        items: [{ text: '문장', out: join(workDir, 'x.wav') }],
      }),
    ).rejects.toThrow(/타입캐스트 목소리/)
  })
})
