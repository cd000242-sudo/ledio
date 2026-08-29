import { describe, expect, it } from 'vitest'
import { projectKind, resolutionFor, withEditDefaults } from './editProject.js'
import { projectSchema } from './schema.js'

describe('프로젝트 종류 판별', () => {
  it('kind를 적어두면 그대로 쓴다', () => {
    expect(projectKind({ kind: 'edit' })).toBe('edit')
    expect(projectKind({ kind: 'shopping' })).toBe('shopping')
  })

  it('kind가 없던 기존 파일은 상품 정보 유무로 가른다 — 호환을 깨지 않는다', () => {
    expect(projectKind({ product: { name: '상품' }, clips: [] })).toBe('shopping')
    expect(projectKind({ clips: [] })).toBe('edit')
  })
})

describe('편집 프로젝트 기본값 채우기', () => {
  const minimal = {
    kind: 'edit',
    projectName: 'my-edit',
    clips: [{ file: 'clips/a.mp4', start: 0, end: 30 }],
  }

  it('영상만 있는 문서가 스키마를 통과한다 — 이게 이번 작업의 핵심이다', () => {
    const filled = withEditDefaults(minimal)
    const result = projectSchema.safeParse(filled)
    expect(result.success).toBe(true)
  })

  it('클립 역할을 안 적어도 채워 준다', () => {
    const filled = withEditDefaults({
      ...minimal,
      clips: [
        { file: 'a.mp4', start: 0, end: 10 },
        { file: 'b.mp4', start: 0, end: 10 },
      ],
    }) as { clips: { role: string }[] }
    expect(filled.clips.map((clip) => clip.role)).toEqual(['hook', 'use'])
  })

  it('길이를 안 적으면 클립 길이 합으로 채운다', () => {
    const filled = withEditDefaults({
      ...minimal,
      clips: [
        { file: 'a.mp4', start: 0, end: 12 },
        { file: 'b.mp4', start: 2, end: 10 },
      ],
    }) as { style: { duration: number } }
    expect(filled.style.duration).toBe(20)
  })

  it('세로 영상이면 세로 해상도를 넣는다', () => {
    const filled = withEditDefaults({ ...minimal, style: { ratio: '9:16' } }) as {
      style: { resolution: string }
    }
    expect(filled.style.resolution).toBe('1080x1920')
    expect(resolutionFor('1:1')).toBe('1080x1080')
  })

  it('사용자가 적은 값은 덮어쓰지 않는다', () => {
    const filled = withEditDefaults({
      ...minimal,
      style: { ratio: '16:9', tone: '차분하게', bgmVolume: 0.4 },
      product: { name: '내가 적은 이름' },
    }) as { style: { tone: string; bgmVolume: number }; product: { name: string } }
    expect(filled.style.tone).toBe('차분하게')
    expect(filled.style.bgmVolume).toBe(0.4)
    expect(filled.product.name).toBe('내가 적은 이름')
  })

  it('쇼핑 프로젝트는 손대지 않는다', () => {
    const shopping = { kind: 'shopping', projectName: 'x', product: { name: '상품' }, clips: [] }
    expect(withEditDefaults(shopping)).toBe(shopping)
  })
})
