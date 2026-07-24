import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { PLATFORM_IDS, type PlatformId } from '../../config/schema.js'
import { logger } from '../../utils/logger.js'
import {
  DryRunUploadProvider,
  InstagramReelsProvider,
  MockUploadProvider,
  TikTokDirectPostProvider,
  uploadModeSchema,
  uploadPublishPackage,
  YouTubeUploadProvider,
  type UploadMode,
  type UploadProvider,
} from '../../uploads/platformUpload.js'

interface UploadPackageCliOptions {
  mode?: string
  platform?: PlatformId[]
  publicBaseUrl?: string
  out?: string
}

function parsePlatforms(platforms?: PlatformId[]): PlatformId[] | undefined {
  if (platforms === undefined || platforms.length === 0) return undefined
  const allowed = new Set<string>(PLATFORM_IDS)
  for (const platform of platforms) {
    if (!allowed.has(platform)) {
      throw new Error(`Unsupported platform: ${platform}`)
    }
  }
  return platforms
}

function providersForMode(mode: UploadMode): Partial<Record<PlatformId, UploadProvider>> {
  if (mode === 'dry_run') {
    return Object.fromEntries(PLATFORM_IDS.map((platform) => [platform, new DryRunUploadProvider(platform)]))
  }
  if (mode === 'mock') {
    return Object.fromEntries(PLATFORM_IDS.map((platform) => [platform, new MockUploadProvider(platform)]))
  }

  const providers: Partial<Record<PlatformId, UploadProvider>> = {}
  if (process.env.YOUTUBE_ACCESS_TOKEN) {
    providers.youtube_shorts = new YouTubeUploadProvider({
      accessToken: process.env.YOUTUBE_ACCESS_TOKEN,
      privacyStatus:
        process.env.YOUTUBE_PRIVACY_STATUS === 'public' ||
        process.env.YOUTUBE_PRIVACY_STATUS === 'unlisted'
          ? process.env.YOUTUBE_PRIVACY_STATUS
          : 'private',
    })
  }
  if (process.env.INSTAGRAM_ACCESS_TOKEN && process.env.INSTAGRAM_USER_ID) {
    providers.instagram_reels = new InstagramReelsProvider({
      accessToken: process.env.INSTAGRAM_ACCESS_TOKEN,
      igUserId: process.env.INSTAGRAM_USER_ID,
    })
  }
  if (process.env.TIKTOK_ACCESS_TOKEN) {
    providers.tiktok = new TikTokDirectPostProvider({
      accessToken: process.env.TIKTOK_ACCESS_TOKEN,
      privacyLevel: process.env.TIKTOK_PRIVACY_LEVEL ?? 'SELF_ONLY',
      isAiGenerated: process.env.TIKTOK_IS_AIGC === 'true',
    })
  }
  return providers
}

/** Uploads a prepared publish_package through dry-run, mock, or credential-backed live providers. */
export async function runUploadPackage(
  packageDir: string,
  options: UploadPackageCliOptions,
): Promise<number> {
  const mode = uploadModeSchema.parse(options.mode ?? 'dry_run')
  const outFile = options.out ?? join(packageDir, 'upload_results.json')

  logger.step(`upload package ${packageDir} (${mode})`)

  try {
    const result = await uploadPublishPackage(packageDir, providersForMode(mode), {
      platforms: parsePlatforms(options.platform),
      publicBaseUrl: options.publicBaseUrl,
    })
    await mkdir(dirname(outFile), { recursive: true })
    await writeFile(outFile, JSON.stringify(result, null, 2), 'utf8')

    const okCount = result.results.filter((item) => item.ok).length
    const failedCount = result.results.length - okCount
    logger.success(`upload results written: ${outFile}`)
    logger.dim(`  ok ${okCount}, failed ${failedCount}`)

    return mode === 'live' && failedCount > 0 ? 1 : 0
  } catch (err) {
    logger.error(`upload package failed: ${(err as Error).message}`)
    return 1
  }
}
