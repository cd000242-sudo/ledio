import { resolve, join, extname } from 'node:path'

export interface ProjectPaths {
  projectDir: string
  projectFile: string
}

/**
 * 입력 경로를 프로젝트 폴더/파일로 해석한다.
 * - .yaml/.yml 파일을 직접 가리키면 그 파일을 쓴다.
 * - 그 외에는 폴더로 보고 그 안의 project.yaml을 쓴다.
 */
export function resolveProjectPaths(projectPath: string): ProjectPaths {
  const abs = resolve(projectPath)
  const ext = extname(abs).toLowerCase()
  if (ext === '.yaml' || ext === '.yml') {
    return { projectDir: resolve(abs, '..'), projectFile: abs }
  }
  return { projectDir: abs, projectFile: join(abs, 'project.yaml') }
}

/** 클립 파일 경로는 project.yaml 기준 상대경로로 해석한다. */
export function resolveClipPath(projectDir: string, clipFile: string): string {
  return resolve(projectDir, clipFile)
}
