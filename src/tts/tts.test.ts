import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildSilentWav, createMockProvider } from './mockProvider.js'
import { resolveVoice } from './voices.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sf-tts-test-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('buildSilentWav', () => {
  it('유효한 WAV 헤더를 만든다', () => {
    const wav = buildSilentWav(1, 24000)
    expect(wav.subarray(0, 4).toString()).toBe('RIFF')
    expect(wav.subarray(8, 12).toString()).toBe('WAVE')
    expect(wav.length).toBe(44 + 24000 * 2)
  })
})

describe('createMockProvider', () => {
  it('항목마다 wav를 만들고 길이를 돌려준다', async () => {
    const provider = createMockProvider()
    const out1 = join(dir, 'a', 'n1.wav')
    const out2 = join(dir, 'a', 'n2.wav')
    const result = await provider.synthesize({
      refAudio: 'x.wav',
      language: 'Korean',
      items: [
        { text: '좁은 주방에 딱 맞는 선반입니다', out: out1 },
        { text: '네', out: out2 },
      ],
    })
    expect(result.ok).toBe(true)
    expect(result.results).toHaveLength(2)
    expect((await readFile(out1)).subarray(0, 4).toString()).toBe('RIFF')
    // 긴 문장이 더 긴 음성
    expect(result.results[0]!.durationSec).toBeGreaterThan(result.results[1]!.durationSec)
  })
})

describe('resolveVoice', () => {
  it('voices/<이름>.wav 를 해석하고 .txt 전사를 같이 읽는다', async () => {
    await mkdir(join(dir, 'voices'), { recursive: true })
    await writeFile(join(dir, 'voices', 'me.wav'), buildSilentWav(3))
    await writeFile(join(dir, 'voices', 'me.txt'), '안녕하세요 테스트입니다', 'utf8')
    const voice = await resolveVoice(dir, 'me')
    expect(voice.refAudio).toBe(join(dir, 'voices', 'me.wav'))
    expect(voice.refText).toBe('안녕하세요 테스트입니다')
  })

  it('전사가 없으면 refText가 undefined', async () => {
    await mkdir(join(dir, 'voices'), { recursive: true })
    await writeFile(join(dir, 'voices', 'solo.wav'), buildSilentWav(3))
    const voice = await resolveVoice(dir, 'solo')
    expect(voice.refText).toBeUndefined()
  })

  it('없는 목소리는 안내 메시지와 함께 실패한다', async () => {
    await expect(resolveVoice(dir, 'ghost')).rejects.toThrow('voices/ghost.wav')
  })

  it('wav 경로를 직접 받을 수 있다', async () => {
    const p = join(dir, 'direct.wav')
    await writeFile(p, buildSilentWav(3))
    const voice = await resolveVoice(dir, p)
    expect(voice.refAudio).toBe(p)
  })
})
