import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  buildUploadJobs,
  InstagramReelsProvider,
  MockUploadProvider,
  TikTokDirectPostProvider,
  uploadPublishPackage,
  YouTubeUploadProvider,
  type UploadResult,
} from './platformUpload.js'
import { type PublishPlan } from '../package/publishPlan.js'

let dir: string

const MANIFEST: PublishPlan = {
  projectName: 'upload-test',
  campaignName: 'upload-campaign',
  productName: 'Shelf Box',
  affiliateUrl: 'https://example.com/product',
  disclosure: 'Affiliate disclosure',
  generatedAt: '2026-06-23T00:00:00.000Z',
  platforms: ['youtube_shorts', 'instagram_reels', 'tiktok'],
  items: [
    {
      platform: 'youtube_shorts',
      platformLabel: 'YouTube Shorts',
      videoFile: 'video 01.mp4',
      title: 'Shelf Box | Hook',
      caption: 'AI-assisted product clip',
      fixedComment: 'Details: https://example.com/product',
      affiliateUrl: 'https://example.com/product',
      hashtags: ['#ShelfBox', '#Review'],
      hook: 'Hook',
    },
    {
      platform: 'instagram_reels',
      platformLabel: 'Instagram Reels',
      videoFile: 'video 01.mp4',
      title: 'Shelf Box | Hook',
      caption: 'Clean shelf in seconds',
      fixedComment: 'Details: https://example.com/product',
      affiliateUrl: 'https://example.com/product',
      hashtags: ['#ShelfBox'],
      hook: 'Hook',
    },
    {
      platform: 'tiktok',
      platformLabel: 'TikTok',
      videoFile: 'video 01.mp4',
      title: 'Shelf Box | Hook',
      caption: 'Clean shelf in seconds',
      fixedComment: 'Details: https://example.com/product',
      affiliateUrl: 'https://example.com/product',
      hashtags: ['#ShelfBox'],
      hook: 'Hook',
    },
  ],
}

beforeEach(async () => {
  dir = join(tmpdir(), `sf-upload-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(join(dir, 'videos'), { recursive: true })
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(MANIFEST), 'utf8')
  await writeFile(join(dir, 'videos', 'video 01.mp4'), 'fake-video')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('platform uploads', () => {
  it('builds upload jobs with local video paths and public pull URLs', () => {
    const jobs = buildUploadJobs(dir, MANIFEST, 'https://cdn.example.com/videos/')

    expect(jobs).toHaveLength(3)
    expect(jobs[0]).toMatchObject({
      platform: 'youtube_shorts',
      videoPath: join(dir, 'videos', 'video 01.mp4'),
      publicVideoUrl: 'https://cdn.example.com/videos/video%2001.mp4',
    })
  })

  it('uploads a package with mock providers', async () => {
    const result = await uploadPublishPackage(dir, {
      youtube_shorts: new MockUploadProvider('youtube_shorts'),
      instagram_reels: new MockUploadProvider('instagram_reels'),
      tiktok: new MockUploadProvider('tiktok'),
    })

    expect(result.results).toHaveLength(3)
    expect(result.results.every((item) => item.ok && item.mode === 'mock')).toBe(true)
  })

  it('creates a YouTube multipart upload request', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: Buffer | string }> = []
    const provider = new YouTubeUploadProvider({
      accessToken: 'yt-token',
      fetchImpl: async (url, init) => {
        calls.push({ url, headers: init.headers ?? {}, body: init.body ?? '' })
        return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'yt123' }) }
      },
    })

    const result = await provider.upload(buildUploadJobs(dir, MANIFEST)[0]!)

    expect(result).toMatchObject<Partial<UploadResult>>({
      ok: true,
      remoteId: 'yt123',
      remoteUrl: 'https://www.youtube.com/watch?v=yt123',
    })
    expect(calls[0]?.url).toContain('https://www.googleapis.com/upload/youtube/v3/videos')
    expect(calls[0]?.headers.authorization).toBe('Bearer yt-token')
    expect(calls[0]?.body.toString()).toContain('"title":"Shelf Box | Hook"')
    expect(calls[0]?.body.toString()).toContain('"containsSyntheticMedia":true')
  })

  it('creates and publishes an Instagram Reels media container', async () => {
    const calls: Array<{ url: string; body: string | Buffer }> = []
    const provider = new InstagramReelsProvider({
      accessToken: 'ig-token',
      igUserId: 'ig-user',
      fetchImpl: async (url, init) => {
        calls.push({ url, body: init.body ?? '' })
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: calls.length === 1 ? 'container123' : 'media123' }),
        }
      },
    })

    const result = await provider.upload(buildUploadJobs(dir, MANIFEST, 'https://cdn.example.com')[1]!)

    expect(result).toMatchObject<Partial<UploadResult>>({
      ok: true,
      remoteId: 'media123',
      status: 'published',
    })
    expect(calls[0]?.url).toBe('https://graph.facebook.com/v20.0/ig-user/media')
    expect(calls[0]?.body.toString()).toContain('media_type=REELS')
    expect(calls[0]?.body.toString()).toContain('video_url=https%3A%2F%2Fcdn.example.com%2Fvideo%252001.mp4')
    expect(calls[1]?.url).toBe('https://graph.facebook.com/v20.0/ig-user/media_publish')
    expect(calls[1]?.body.toString()).toContain('creation_id=container123')
  })

  it('initializes TikTok direct post and uploads the video bytes', async () => {
    const calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string | Buffer }> = []
    const provider = new TikTokDirectPostProvider({
      accessToken: 'tt-token',
      chunkSize: 10,
      fetchImpl: async (url, init) => {
        calls.push({
          url,
          method: init.method,
          headers: init.headers ?? {},
          body: init.body ?? '',
        })
        if (calls.length === 1) {
          return {
            ok: true,
            status: 200,
            text: async () =>
              JSON.stringify({
                data: { publish_id: 'tt123', upload_url: 'https://upload.tiktok.test/video' },
                error: { code: 'ok' },
              }),
          }
        }
        return { ok: true, status: 200, text: async () => '' }
      },
    })

    const result = await provider.upload(buildUploadJobs(dir, MANIFEST)[2]!)

    expect(result).toMatchObject<Partial<UploadResult>>({
      ok: true,
      remoteId: 'tt123',
      status: 'uploaded',
    })
    expect(calls[0]?.url).toBe('https://open.tiktokapis.com/v2/post/publish/video/init/')
    expect(JSON.parse(calls[0]?.body.toString() ?? '{}')).toMatchObject({
      source_info: { source: 'FILE_UPLOAD', total_chunk_count: 1 },
    })
    expect(calls[1]?.url).toBe('https://upload.tiktok.test/video')
    expect(calls[1]?.headers['content-range']).toBe('bytes 0-9/10')
    await expect(readFile(join(dir, 'videos', 'video 01.mp4'), 'utf8')).resolves.toBe('fake-video')
  })
})
