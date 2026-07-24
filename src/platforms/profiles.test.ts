import { describe, expect, it } from 'vitest'
import { PLATFORM_IDS } from '../config/schema.js'
import { getDefaultPlatformIds, getPlatformProfile } from './profiles.js'

describe('platform profiles', () => {
  it('기본 플랫폼은 유튜브 쇼츠, 인스타 릴스, 틱톡을 모두 포함한다', () => {
    expect(getDefaultPlatformIds()).toEqual([...PLATFORM_IDS])
  })

  it('각 플랫폼은 패키징 폴더와 캡션 제한을 가진다', () => {
    for (const platform of PLATFORM_IDS) {
      const profile = getPlatformProfile(platform)
      expect(profile.folderName).toBeTruthy()
      expect(profile.captionMaxChars).toBeGreaterThan(0)
      expect(profile.recommendedAspectRatio).toBe('9:16')
    }
  })
})
