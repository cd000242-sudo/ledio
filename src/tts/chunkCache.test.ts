import { describe, expect, it } from 'vitest'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { chunkCacheKey, lookupChunk, pruneChunkCache, storeChunk } from './chunkCache.js'

describe('TTS 덩어리 캐시', () => {
  it('같은 목소리+문장은 같은 키, 문장이나 목소리가 다르면 다른 키', () => {
    const a = chunkCacheKey('voice.wav|100|1', '첫 문장입니다.')
    expect(chunkCacheKey('voice.wav|100|1', '첫 문장입니다.')).toBe(a)
    expect(chunkCacheKey('voice.wav|100|1', '다른 문장입니다.')).not.toBe(a)
    expect(chunkCacheKey('voice.wav|200|2', '첫 문장입니다.')).not.toBe(a)
  })

  it('저장한 덩어리를 다시 찾을 수 있고, 없는 키는 null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-cache-'))
    const wav = join(dir, 'src.wav')
    await writeFile(wav, Buffer.from('fake-wav-bytes'))

    const key = chunkCacheKey('v|1|1', '문장')
    expect(await lookupChunk(dir, key)).toBeNull()

    await storeChunk(dir, key, wav, 3.21)
    const hit = await lookupChunk(dir, key)
    expect(hit).not.toBeNull()
    expect(hit?.durationSec).toBe(3.21)
    expect(String(await readFile(hit?.wavPath ?? ''))).toBe('fake-wav-bytes')
  })

  it('상한을 넘으면 오래된 것부터 지운다', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'tts-cache-'))
    const wav = join(dir, 'src.wav')
    await writeFile(wav, Buffer.from('x'))
    for (let i = 0; i < 6; i++) {
      await storeChunk(dir, chunkCacheKey('v|1|1', `문장 ${i}`), wav, 1)
    }
    await pruneChunkCache(dir, 4)
    let remaining = 0
    for (let i = 0; i < 6; i++) {
      if (await lookupChunk(dir, chunkCacheKey('v|1|1', `문장 ${i}`))) remaining += 1
    }
    expect(remaining).toBeLessThanOrEqual(4)
    expect(remaining).toBeGreaterThan(0)
  })
})
