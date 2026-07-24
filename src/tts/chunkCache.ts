import { createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * TTS 덩어리 캐시.
 * 한 번 생성한 문장 덩어리 wav를 저장해 두고 재사용한다 —
 * 긴 낭독이 끝나기 직전에 실패해도, 재시도하면 없는 덩어리만 다시 만들면 된다.
 * 대본을 일부만 고친 재낭독도 바뀐 문장만 재생성한다.
 */

export interface ChunkCacheHit {
  wavPath: string
  durationSec: number
}

/** 캐시 키 — 목소리(파일 경로+크기+수정시각+전사)와 덩어리 텍스트로 만든다. */
export function chunkCacheKey(voiceSignature: string, text: string): string {
  return createHash('sha1').update(`${voiceSignature}\n${text}`).digest('hex')
}

export async function lookupChunk(cacheDir: string, key: string): Promise<ChunkCacheHit | null> {
  const wavPath = join(cacheDir, `${key}.wav`)
  const metaPath = join(cacheDir, `${key}.json`)
  try {
    const meta = JSON.parse(await readFile(metaPath, 'utf8')) as { durationSec?: number }
    await stat(wavPath)
    if (typeof meta.durationSec !== 'number') return null
    return { wavPath, durationSec: meta.durationSec }
  } catch {
    return null
  }
}

export async function storeChunk(
  cacheDir: string,
  key: string,
  wavPath: string,
  durationSec: number,
): Promise<void> {
  try {
    await mkdir(cacheDir, { recursive: true })
    await copyFile(wavPath, join(cacheDir, `${key}.wav`))
    await writeFile(
      join(cacheDir, `${key}.json`),
      JSON.stringify({ durationSec, savedAt: new Date().toISOString() }),
      'utf8',
    )
  } catch {
    // 캐시는 부가 기능 — 저장 실패가 낭독을 막으면 안 된다
  }
}

/** 캐시가 상한(wav 개수)을 넘으면 오래된 것부터 지운다. */
export async function pruneChunkCache(cacheDir: string, maxFiles = 600): Promise<void> {
  try {
    const files = (await readdir(cacheDir)).filter((file) => file.endsWith('.wav'))
    if (files.length <= maxFiles) return
    const withTime = await Promise.all(
      files.map(async (file) => {
        const info = await stat(join(cacheDir, file)).catch(() => null)
        return { file, mtime: info?.mtimeMs ?? 0 }
      }),
    )
    withTime.sort((a, b) => a.mtime - b.mtime)
    for (const { file } of withTime.slice(0, files.length - maxFiles)) {
      await rm(join(cacheDir, file), { force: true })
      await rm(join(cacheDir, file.replace(/\.wav$/, '.json')), { force: true })
    }
  } catch {
    // 정리 실패는 무시
  }
}
