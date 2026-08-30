import { describe, expect, it } from 'vitest'
import { resolveRoots } from './app-roots.mjs'

describe('프로그램 파일과 사용자 데이터 위치', () => {
  it('개발 실행에서는 저장소 한 곳을 그대로 쓴다 — 지금 쓰던 방식이 그대로 동작해야 한다', () => {
    const roots = resolveRoots({ isPackaged: false, appPath: 'C:/repo' })
    expect(roots.programRoot).toBe('C:/repo')
    expect(roots.dataRoot).toBe('C:/repo')
  })

  it('설치본에서는 데이터를 설치 폴더 **밖**에 둔다 — 업데이트 때 지워지면 안 된다', () => {
    const roots = resolveRoots({
      isPackaged: true,
      appPath: 'C:/Users/me/AppData/Local/Programs/shorts-factory/resources/app',
      localAppData: 'C:/Users/me/AppData/Local',
      userData: 'C:/Users/me/AppData/Roaming/shorts-factory',
    })
    expect(roots.programRoot).toBe('C:/Users/me/AppData/Local/Programs/shorts-factory/resources/app')
    expect(roots.dataRoot.startsWith('C:/Users/me/AppData/Local/Programs')).toBe(false)
    expect(roots.dataRoot).toContain('AppData/Local')
  })

  it('작업물과 5GB짜리 엔진이 들어가므로 Roaming이 아니라 Local에 둔다', () => {
    const roots = resolveRoots({
      isPackaged: true,
      appPath: 'C:/app',
      localAppData: 'C:/Users/me/AppData/Local',
      userData: 'C:/Users/me/AppData/Roaming/shorts-factory',
    })
    expect(roots.dataRoot).toBe('C:/Users/me/AppData/Local/shorts-factory-data')
  })

  it('Local을 못 찾으면 표준 사용자 데이터 폴더로 물러선다', () => {
    const roots = resolveRoots({
      isPackaged: true,
      appPath: 'C:/app',
      userData: 'C:/Users/me/AppData/Roaming/shorts-factory',
    })
    expect(roots.dataRoot).toBe('C:/Users/me/AppData/Roaming/shorts-factory')
  })
})
