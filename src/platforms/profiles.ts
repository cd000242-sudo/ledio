import { PLATFORM_IDS, type PlatformId } from '../config/schema.js'

export interface PlatformProfile {
  id: PlatformId
  label: string
  folderName: string
  titleMaxChars: number
  captionMaxChars: number
  hashtagLimit: number
  recommendedAspectRatio: '9:16'
  recommendedLengthSec: number
}

export const PLATFORM_PROFILES: Record<PlatformId, PlatformProfile> = {
  youtube_shorts: {
    id: 'youtube_shorts',
    label: 'YouTube Shorts',
    folderName: 'youtube-shorts',
    titleMaxChars: 100,
    captionMaxChars: 5000,
    hashtagLimit: 15,
    recommendedAspectRatio: '9:16',
    recommendedLengthSec: 60,
  },
  instagram_reels: {
    id: 'instagram_reels',
    label: 'Instagram Reels',
    folderName: 'instagram-reels',
    titleMaxChars: 125,
    captionMaxChars: 2200,
    hashtagLimit: 20,
    recommendedAspectRatio: '9:16',
    recommendedLengthSec: 90,
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    folderName: 'tiktok',
    titleMaxChars: 150,
    captionMaxChars: 2200,
    hashtagLimit: 20,
    recommendedAspectRatio: '9:16',
    recommendedLengthSec: 60,
  },
}

export function getPlatformProfile(platform: PlatformId): PlatformProfile {
  return PLATFORM_PROFILES[platform]
}

export function getDefaultPlatformIds(): PlatformId[] {
  return [...PLATFORM_IDS]
}
