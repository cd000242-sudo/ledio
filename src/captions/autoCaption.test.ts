import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { generateAutoCaptions, normalizeAutoCaptionProvider } from './autoCaption.js'
import { parseSrt } from '../subtitles/srt.js'

const tempRoots: string[] = []

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'auto-caption-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('auto captions', () => {
  it('normalizes unknown providers to local Whisper', () => {
    expect(normalizeAutoCaptionProvider('mock')).toBe('mock')
    expect(normalizeAutoCaptionProvider('anything-else')).toBe('local-whisper')
  })

  it('creates a formatted SRT file with the mock provider', async () => {
    const root = await makeTempRoot()
    const clipDir = join(root, 'clips')
    const clipPath = join(clipDir, 'hook.mp4')
    await mkdir(clipDir, { recursive: true })
    await writeFile(clipPath, 'fake video bytes')

    const report = await generateAutoCaptions({
      projectName: 'caption-project',
      clipFile: 'clips/hook.mp4',
      clipPath,
      durationSec: 8,
      provider: 'mock',
      language: 'ko',
      outputDir: join(root, 'captions'),
      minChars: 8,
      maxChars: 32,
    })

    const srt = await readFile(report.srtFile, 'utf8')
    const cues = parseSrt(srt)

    expect(report.projectName).toBe('caption-project')
    expect(report.provider).toBe('mock')
    expect(report.srtFile).toBe(join(root, 'captions', 'hook.auto.srt'))
    expect(report.cueCount).toBeGreaterThan(0)
    expect(report.warnings[0]).toContain('테스트 자막')
    expect(cues).toHaveLength(report.cueCount)
    expect(srt).toContain('-->')
  })
})
