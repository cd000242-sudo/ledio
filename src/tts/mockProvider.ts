import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TtsProvider, TtsRequest, TtsResult } from './provider.js'

/** 최소 유효 WAV(무음)를 만든다. 테스트/드라이런용. */
export function buildSilentWav(durationSec: number, sampleRate = 24000): Buffer {
  const numSamples = Math.max(1, Math.round(durationSec * sampleRate))
  const dataSize = numSamples * 2 // 16-bit mono
  const buf = Buffer.alloc(44 + dataSize)
  buf.write('RIFF', 0)
  buf.writeUInt32LE(36 + dataSize, 4)
  buf.write('WAVE', 8)
  buf.write('fmt ', 12)
  buf.writeUInt32LE(16, 16)
  buf.writeUInt16LE(1, 20) // PCM
  buf.writeUInt16LE(1, 22) // mono
  buf.writeUInt32LE(sampleRate, 24)
  buf.writeUInt32LE(sampleRate * 2, 28)
  buf.writeUInt16LE(2, 32)
  buf.writeUInt16LE(16, 34)
  buf.write('data', 36)
  buf.writeUInt32LE(dataSize, 40)
  return buf
}

/** 글자 수 기반으로 대략의 발화 길이를 흉내 낸다(한국어 ≈ 초당 5자). */
function estimateDuration(text: string): number {
  return Math.max(0.5, [...text].length / 5)
}

/** GPU/모델 없이 무음 wav를 만드는 목 프로바이더. 파이프라인 테스트용. */
export function createMockProvider(): TtsProvider {
  return {
    name: 'mock',
    async synthesize(request: TtsRequest): Promise<TtsResult> {
      const results = []
      for (const [index, item] of request.items.entries()) {
        const durationSec = estimateDuration(item.text)
        await mkdir(dirname(item.out), { recursive: true })
        await writeFile(item.out, buildSilentWav(durationSec))
        results.push({ out: item.out, durationSec: Number(durationSec.toFixed(3)) })
        request.onProgress?.(index + 1, request.items.length)
      }
      return { ok: true, device: 'mock', results }
    },
  }
}
