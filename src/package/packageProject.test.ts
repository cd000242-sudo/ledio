import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { packageProject } from './packageProject.js'

let dir: string

const PROJECT_YAML = `
projectName: package-test
product:
  name: 접이식 싱크대 선반
  category: 주방 수납
  priceRange: 10000-30000
  affiliateUrl: https://example.com/product
  painPoint: 좁은 주방에서 컵과 양념통 둘 곳이 없음
  benefit: 접으면 작고 펼치면 수납공간이 생김
disclosure:
  type: affiliate
  text: 이 콘텐츠는 제휴 활동의 일환으로 수수료를 제공받을 수 있습니다.
style:
  duration: 25
  ratio: 9:16
  resolution: 1080x1920
  tone: friend
  captionPosition: bottom
  bgmVolume: 0.18
clips:
  - file: clips/hook.mp4
    role: hook
    start: 0
    end: 2.5
variants:
  count: 1
publish:
  campaignName: package-campaign
  platforms:
    - youtube_shorts
    - instagram_reels
  hashtags:
    - 주방수납
  cta: 상세 정보는 링크에서 확인하세요.
sources:
  - title: 직접 촬영 클립
    file: clips/hook.mp4
    rights: owned
    usage: edit
`

const RENDER_REPORT = {
  projectName: 'package-test',
  generatedAt: '2026-06-23T00:00:00.000Z',
  resolution: '1080x1920',
  fps: 30,
  timelineDurationSec: 2.5,
  variantCount: 1,
  clips: [],
  variants: [{ file: 'video_01.mp4', hook: '좁은 주방 쓰면 바로 이해합니다' }],
}

beforeEach(async () => {
  dir = join(tmpdir(), `sf-package-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  await mkdir(join(dir, 'output'), { recursive: true })
  await writeFile(join(dir, 'project.yaml'), PROJECT_YAML, 'utf8')
  await writeFile(join(dir, 'output', 'render_report.json'), JSON.stringify(RENDER_REPORT), 'utf8')
  await writeFile(join(dir, 'output', 'video_01.mp4'), 'fake-video')
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('packageProject', () => {
  it('플랫폼별 업로드 패키지와 ZIP을 만든다', async () => {
    const result = await packageProject(dir, '2026-06-23T00:00:00.000Z')
    expect(result.manifest.items).toHaveLength(2)
    expect(result.sourceRiskReport.summary.safe).toBe(1)

    const manifest = await readFile(join(result.packageDir, 'manifest.json'), 'utf8')
    expect(manifest).toContain('package-campaign')

    const csv = await readFile(join(result.packageDir, 'performance_template.csv'), 'utf8')
    expect(csv).toContain('video_01.mp4,youtube_shorts')
    expect(csv).toContain('video_01.mp4,instagram_reels')

    const traceability = await readFile(join(result.packageDir, 'source_traceability.json'), 'utf8')
    expect(traceability).toContain('사용 가능')

    const zip = await readFile(result.zipPath)
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
  })
})
