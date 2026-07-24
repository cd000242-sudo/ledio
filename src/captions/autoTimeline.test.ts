import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { Project } from '../config/schema.js'
import { autoCaptionFileForClip, loadAutoCaptionTimeline } from './autoTimeline.js'

const tempRoots: string[] = []

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'auto-caption-timeline-'))
  tempRoots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

function project(): Project {
  return {
    projectName: 'caption-render-project',
    product: {
      name: 'Product',
      category: 'Category',
      priceRange: '10000-30000',
      affiliateUrl: 'https://example.com/product',
      painPoint: 'Messy shelf',
      benefit: 'Clean shelf',
    },
    disclosure: {
      type: 'affiliate',
      text: 'Affiliate disclosure',
    },
    style: {
      duration: 8,
      ratio: '9:16',
      resolution: '1080x1920',
      tone: 'friendly',
      captionPosition: 'bottom',
      bgmVolume: 0.1,
    },
    clips: [
      { file: 'clips/hook.mp4', role: 'hook', start: 1, end: 4 },
      { file: 'clips/use.mp4', role: 'use', start: 0, end: 3 },
    ],
    variants: { count: 1 },
    publish: {
      platforms: ['youtube_shorts'],
      hashtags: [],
    },
    sources: [],
  }
}

describe('auto caption timeline', () => {
  it('loads clip SRT files and offsets them onto the rendered timeline', async () => {
    const root = await makeTempRoot()
    await mkdir(join(root, 'captions'), { recursive: true })
    await writeFile(
      autoCaptionFileForClip(root, 'clips/hook.mp4'),
      [
        '1',
        '00:00:00,000 --> 00:00:01,200',
        'trimmed out',
        '',
        '2',
        '00:00:01,500 --> 00:00:03,000',
        'first kept line',
      ].join('\n'),
      'utf8',
    )
    await writeFile(
      autoCaptionFileForClip(root, 'clips/use.mp4'),
      ['1', '00:00:00,500 --> 00:00:02,000', 'second clip line'].join('\n'),
      'utf8',
    )

    const timeline = await loadAutoCaptionTimeline(root, project())

    expect(timeline.files).toHaveLength(2)
    expect(timeline.segments.map((segment) => segment.text)).toEqual([
      'first kept line',
      'second clip line',
      'Affiliate disclosure',
    ])
    expect(timeline.segments[0]).toMatchObject({ start: 0.5, end: 2 })
    expect(timeline.segments[1]).toMatchObject({ start: 3.5, end: 5 })
  })
})
