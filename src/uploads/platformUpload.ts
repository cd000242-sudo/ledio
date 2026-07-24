import { readFile, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { z } from 'zod'
import { type PlatformId } from '../config/schema.js'
import {
  platformPublishItemSchema,
  publishPlanSchema,
  type PlatformPublishItem,
  type PublishPlan,
} from '../package/publishPlan.js'

export const uploadModeSchema = z.enum(['dry_run', 'mock', 'live'])
export type UploadMode = z.infer<typeof uploadModeSchema>

export interface UploadJob {
  platform: PlatformId
  item: PlatformPublishItem
  videoPath: string
  publicVideoUrl?: string
}

export interface UploadResult {
  platform: PlatformId
  videoFile: string
  ok: boolean
  mode: UploadMode
  status: string
  remoteId?: string
  remoteUrl?: string
  request?: {
    method: string
    url: string
    bodyPreview?: unknown
  }
  error?: string
}

export interface UploadProvider {
  platform: PlatformId
  mode: UploadMode
  upload(job: UploadJob): Promise<UploadResult>
}

export interface UploadPackageResult {
  manifest: PublishPlan
  results: UploadResult[]
}

interface FetchResponseLike {
  ok: boolean
  status: number
  text(): Promise<string>
}

type FetchLike = (
  url: string,
  init: {
    method: string
    headers?: Record<string, string>
    body?: string | Buffer
  },
) => Promise<FetchResponseLike>

function cleanHashtag(tag: string): string {
  return tag.replace(/^#/, '').trim()
}

function captionWithFixedComment(item: PlatformPublishItem): string {
  return [item.caption, item.fixedComment].filter(Boolean).join('\n\n')
}

function ensurePublicUrl(job: UploadJob, platform: PlatformId): string {
  if (!job.publicVideoUrl) {
    throw new Error(`${platform} upload requires a public video URL for this provider.`)
  }
  return job.publicVideoUrl
}

function parseJsonResponse(raw: string): unknown {
  try {
    return raw ? JSON.parse(raw) : {}
  } catch {
    return { raw }
  }
}

export function buildUploadJobs(
  packageDir: string,
  manifest: PublishPlan,
  publicBaseUrl?: string,
): UploadJob[] {
  return manifest.items.map((item) => {
    const parsed = platformPublishItemSchema.parse(item)
    const publicVideoUrl = publicBaseUrl
      ? `${publicBaseUrl.replace(/\/+$/, '')}/${encodeURIComponent(parsed.videoFile)}`
      : undefined
    return {
      platform: parsed.platform,
      item: parsed,
      videoPath: join(packageDir, 'videos', parsed.videoFile),
      publicVideoUrl,
    }
  })
}

export async function readPublishManifest(packageDir: string): Promise<PublishPlan> {
  const raw = JSON.parse(await readFile(join(packageDir, 'manifest.json'), 'utf8')) as unknown
  return publishPlanSchema.parse(raw)
}

export class MockUploadProvider implements UploadProvider {
  readonly mode = 'mock' as const

  constructor(readonly platform: PlatformId) {}

  async upload(job: UploadJob): Promise<UploadResult> {
    return {
      platform: this.platform,
      videoFile: job.item.videoFile,
      ok: true,
      mode: this.mode,
      status: 'mock_uploaded',
      remoteId: `mock-${this.platform}-${basename(job.item.videoFile)}`,
      remoteUrl: `https://example.com/${this.platform}/${encodeURIComponent(job.item.videoFile)}`,
    }
  }
}

export class DryRunUploadProvider implements UploadProvider {
  readonly mode = 'dry_run' as const

  constructor(readonly platform: PlatformId) {}

  async upload(job: UploadJob): Promise<UploadResult> {
    return {
      platform: this.platform,
      videoFile: job.item.videoFile,
      ok: true,
      mode: this.mode,
      status: 'ready_for_upload',
      request: {
        method: 'POST',
        url: `${this.platform}:upload`,
        bodyPreview: {
          title: job.item.title,
          caption: job.item.caption,
          videoPath: job.videoPath,
          publicVideoUrl: job.publicVideoUrl,
        },
      },
    }
  }
}

export interface YouTubeUploadProviderOptions {
  accessToken: string
  fetchImpl?: FetchLike
  privacyStatus?: 'private' | 'unlisted' | 'public'
  categoryId?: string
}

export class YouTubeUploadProvider implements UploadProvider {
  readonly platform = 'youtube_shorts' as const
  readonly mode = 'live' as const
  readonly #accessToken: string
  readonly #fetchImpl: FetchLike
  readonly #privacyStatus: 'private' | 'unlisted' | 'public'
  readonly #categoryId: string

  constructor(options: YouTubeUploadProviderOptions) {
    if (!options.accessToken.trim()) throw new Error('YOUTUBE_ACCESS_TOKEN is required.')
    this.#accessToken = options.accessToken
    this.#fetchImpl = options.fetchImpl ?? fetch
    this.#privacyStatus = options.privacyStatus ?? 'private'
    this.#categoryId = options.categoryId ?? '22'
  }

  async upload(job: UploadJob): Promise<UploadResult> {
    const video = await readFile(job.videoPath)
    const boundary = `shorts-factory-${Date.now()}`
    const metadata = {
      snippet: {
        title: job.item.title,
        description: captionWithFixedComment(job.item),
        tags: job.item.hashtags.map(cleanHashtag),
        categoryId: this.#categoryId,
      },
      status: {
        privacyStatus: this.#privacyStatus,
        selfDeclaredMadeForKids: false,
        containsSyntheticMedia: job.item.caption.toLowerCase().includes('ai'),
      },
    }
    const head = Buffer.from(
      [
        `--${boundary}`,
        'Content-Type: application/json; charset=UTF-8',
        '',
        JSON.stringify(metadata),
        `--${boundary}`,
        'Content-Type: video/mp4',
        '',
      ].join('\r\n'),
    )
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
    const body = Buffer.concat([head, video, tail])
    const url =
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=multipart&part=snippet,status'
    const response = await this.#fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#accessToken}`,
        'content-type': `multipart/related; boundary=${boundary}`,
      },
      body,
    })
    const raw = await response.text()
    if (!response.ok) {
      return {
        platform: this.platform,
        videoFile: job.item.videoFile,
        ok: false,
        mode: this.mode,
        status: 'upload_failed',
        error: raw,
      }
    }
    const parsed = parseJsonResponse(raw) as { id?: string }
    return {
      platform: this.platform,
      videoFile: job.item.videoFile,
      ok: true,
      mode: this.mode,
      status: 'uploaded',
      remoteId: parsed.id,
      remoteUrl: parsed.id ? `https://www.youtube.com/watch?v=${parsed.id}` : undefined,
    }
  }
}

export interface InstagramReelsProviderOptions {
  accessToken: string
  igUserId: string
  fetchImpl?: FetchLike
}

export class InstagramReelsProvider implements UploadProvider {
  readonly platform = 'instagram_reels' as const
  readonly mode = 'live' as const
  readonly #accessToken: string
  readonly #igUserId: string
  readonly #fetchImpl: FetchLike

  constructor(options: InstagramReelsProviderOptions) {
    if (!options.accessToken.trim()) throw new Error('INSTAGRAM_ACCESS_TOKEN is required.')
    if (!options.igUserId.trim()) throw new Error('INSTAGRAM_USER_ID is required.')
    this.#accessToken = options.accessToken
    this.#igUserId = options.igUserId
    this.#fetchImpl = options.fetchImpl ?? fetch
  }

  async upload(job: UploadJob): Promise<UploadResult> {
    const videoUrl = ensurePublicUrl(job, this.platform)
    const createUrl = `https://graph.facebook.com/v20.0/${this.#igUserId}/media`
    const createBody = new URLSearchParams({
      media_type: 'REELS',
      video_url: videoUrl,
      caption: captionWithFixedComment(job.item),
      access_token: this.#accessToken,
    }).toString()
    const createResponse = await this.#fetchImpl(createUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: createBody,
    })
    const createRaw = await createResponse.text()
    if (!createResponse.ok) {
      return {
        platform: this.platform,
        videoFile: job.item.videoFile,
        ok: false,
        mode: this.mode,
        status: 'container_failed',
        error: createRaw,
      }
    }
    const container = parseJsonResponse(createRaw) as { id?: string }
    const publishUrl = `https://graph.facebook.com/v20.0/${this.#igUserId}/media_publish`
    const publishBody = new URLSearchParams({
      creation_id: container.id ?? '',
      access_token: this.#accessToken,
    }).toString()
    const publishResponse = await this.#fetchImpl(publishUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: publishBody,
    })
    const publishRaw = await publishResponse.text()
    if (!publishResponse.ok) {
      return {
        platform: this.platform,
        videoFile: job.item.videoFile,
        ok: false,
        mode: this.mode,
        status: 'publish_failed',
        remoteId: container.id,
        error: publishRaw,
      }
    }
    const published = parseJsonResponse(publishRaw) as { id?: string }
    return {
      platform: this.platform,
      videoFile: job.item.videoFile,
      ok: true,
      mode: this.mode,
      status: 'published',
      remoteId: published.id,
    }
  }
}

export interface TikTokDirectPostProviderOptions {
  accessToken: string
  fetchImpl?: FetchLike
  privacyLevel?: string
  chunkSize?: number
  isAiGenerated?: boolean
}

export class TikTokDirectPostProvider implements UploadProvider {
  readonly platform = 'tiktok' as const
  readonly mode = 'live' as const
  readonly #accessToken: string
  readonly #fetchImpl: FetchLike
  readonly #privacyLevel: string
  readonly #chunkSize: number | undefined
  readonly #isAiGenerated: boolean

  constructor(options: TikTokDirectPostProviderOptions) {
    if (!options.accessToken.trim()) throw new Error('TIKTOK_ACCESS_TOKEN is required.')
    this.#accessToken = options.accessToken
    this.#fetchImpl = options.fetchImpl ?? fetch
    this.#privacyLevel = options.privacyLevel ?? 'SELF_ONLY'
    if (options.chunkSize !== undefined && options.chunkSize <= 0) {
      throw new Error('TikTok chunkSize must be greater than 0.')
    }
    this.#chunkSize = options.chunkSize
    this.#isAiGenerated = options.isAiGenerated ?? false
  }

  async upload(job: UploadJob): Promise<UploadResult> {
    const info = await stat(job.videoPath)
    const chunkSize = this.#chunkSize ?? info.size
    const initBody = {
      post_info: {
        title: captionWithFixedComment(job.item),
        privacy_level: this.#privacyLevel,
        disable_duet: false,
        disable_comment: false,
        disable_stitch: false,
        brand_content_toggle: true,
        brand_organic_toggle: false,
        is_aigc: this.#isAiGenerated,
      },
      source_info: {
        source: 'FILE_UPLOAD',
        video_size: info.size,
        chunk_size: chunkSize,
        total_chunk_count: Math.ceil(info.size / chunkSize),
      },
    }
    const initUrl = 'https://open.tiktokapis.com/v2/post/publish/video/init/'
    const initResponse = await this.#fetchImpl(initUrl, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.#accessToken}`,
        'content-type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(initBody),
    })
    const initRaw = await initResponse.text()
    if (!initResponse.ok) {
      return {
        platform: this.platform,
        videoFile: job.item.videoFile,
        ok: false,
        mode: this.mode,
        status: 'init_failed',
        error: initRaw,
      }
    }
    const init = parseJsonResponse(initRaw) as {
      data?: { publish_id?: string; upload_url?: string }
      error?: { code?: string; message?: string }
    }
    if (init.error?.code && init.error.code !== 'ok') {
      return {
        platform: this.platform,
        videoFile: job.item.videoFile,
        ok: false,
        mode: this.mode,
        status: 'init_rejected',
        error: init.error.message ?? init.error.code,
      }
    }
    if (!init.data?.upload_url) {
      return {
        platform: this.platform,
        videoFile: job.item.videoFile,
        ok: false,
        mode: this.mode,
        status: 'missing_upload_url',
        remoteId: init.data?.publish_id,
      }
    }

    const video = await readFile(job.videoPath)
    const uploadResponse = await this.#fetchImpl(init.data.upload_url, {
      method: 'PUT',
      headers: {
        'content-type': 'video/mp4',
        'content-range': `bytes 0-${info.size - 1}/${info.size}`,
      },
      body: video,
    })
    const uploadRaw = await uploadResponse.text()
    if (!uploadResponse.ok) {
      return {
        platform: this.platform,
        videoFile: job.item.videoFile,
        ok: false,
        mode: this.mode,
        status: 'upload_failed',
        remoteId: init.data.publish_id,
        error: uploadRaw,
      }
    }
    return {
      platform: this.platform,
      videoFile: job.item.videoFile,
      ok: true,
      mode: this.mode,
      status: 'uploaded',
      remoteId: init.data.publish_id,
    }
  }
}

export async function uploadPublishPackage(
  packageDir: string,
  providers: Partial<Record<PlatformId, UploadProvider>>,
  options: { platforms?: PlatformId[]; publicBaseUrl?: string } = {},
): Promise<UploadPackageResult> {
  const manifest = await readPublishManifest(packageDir)
  const jobs = buildUploadJobs(packageDir, manifest, options.publicBaseUrl).filter(
    (job) => options.platforms === undefined || options.platforms.includes(job.platform),
  )
  const results: UploadResult[] = []

  for (const job of jobs) {
    const provider = providers[job.platform]
    if (!provider) {
      results.push({
        platform: job.platform,
        videoFile: job.item.videoFile,
        ok: false,
        mode: 'dry_run',
        status: 'missing_provider',
        error: `No upload provider configured for ${job.platform}.`,
      })
      continue
    }
    results.push(await provider.upload(job))
  }

  return { manifest, results }
}
