import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateProject } from './validate.js'

const VALID_YAML = `
projectName: temp-test
product:
  name: 테스트 상품
  category: 테스트
  priceRange: 10000-30000
  affiliateUrl: https://example.com/p
  painPoint: 문제
  benefit: 장점
disclosure:
  type: affiliate
  text: 제휴 고지
style:
  duration: 25
  ratio: 9:16
  resolution: 1080x1920
  tone: friendly
  captionPosition: bottom
  bgmVolume: 0.18
clips:
  - file: clips/hook.mp4
    role: hook
    start: 0
    end: 2.5
  - file: clips/use.mp4
    role: use
    start: 0
    end: 8
  - file: clips/result.mp4
    role: result
    start: 0
    end: 5
variants:
  count: 5
`

let dir: string

async function writeProject(yaml: string, clipNames: string[]): Promise<void> {
  await writeFile(join(dir, 'project.yaml'), yaml, 'utf8')
  await mkdir(join(dir, 'clips'), { recursive: true })
  for (const name of clipNames) {
    await writeFile(join(dir, 'clips', name), '', 'utf8')
  }
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sf-validate-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('validateProject', () => {
  it('passes when every clip exists', async () => {
    await writeProject(VALID_YAML, ['hook.mp4', 'use.mp4', 'result.mp4'])
    const result = await validateProject(dir)
    expect(result.ok).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.warnings).toHaveLength(0)
  })

  it('returns a friendly error when a clip file is missing', async () => {
    await writeProject(VALID_YAML, ['hook.mp4', 'use.mp4'])
    const result = await validateProject(dir)
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('클립 파일을 찾을 수 없습니다'))).toBe(true)
    expect(result.errors.some((error) => error.includes('result.mp4'))).toBe(true)
  })

  it('warns but still passes when a recommended role is missing', async () => {
    const yamlNoUse = VALID_YAML.replace(
      `  - file: clips/use.mp4\n    role: use\n    start: 0\n    end: 8\n`,
      '',
    )
    await writeProject(yamlNoUse, ['hook.mp4', 'result.mp4'])
    const result = await validateProject(dir)
    expect(result.ok).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('권장 역할이 없습니다: use'))).toBe(true)
  })

  it('returns a friendly error when project.yaml is missing', async () => {
    const result = await validateProject(dir)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('project.yaml을 찾을 수 없습니다')
  })

  it('returns schema guidance when project.yaml is invalid', async () => {
    const badYaml = VALID_YAML.replace('end: 2.5', 'end: 0')
    await writeProject(badYaml, ['hook.mp4', 'use.mp4', 'result.mp4'])
    const result = await validateProject(dir)
    expect(result.ok).toBe(false)
    expect(result.errors[0]).toContain('project.yaml 형식 오류')
    expect(result.errors[0]).toContain('end는 start보다')
  })

  it('warns when editable source rights are unclear', async () => {
    const yamlWithSource = `${VALID_YAML}
sources:
  - title: 권리 미확인 쇼츠
    url: https://example.com/video
    rights: unknown
    usage: edit
`
    await writeProject(yamlWithSource, ['hook.mp4', 'use.mp4', 'result.mp4'])
    const result = await validateProject(dir)
    expect(result.ok).toBe(true)
    expect(result.warnings.some((warning) => warning.includes('소스 권리 확인 필요'))).toBe(true)
  })
})
