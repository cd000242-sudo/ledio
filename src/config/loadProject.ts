import { readFile } from 'node:fs/promises'
import YAML from 'yaml'
import { projectSchema, type Project } from './schema.js'
import { resolveProjectPaths } from '../utils/paths.js'
import { ProjectValidationError } from '../utils/errors.js'

export interface LoadedProject {
  project: Project
  projectDir: string
  projectFile: string
}

/** project.yaml을 읽고 스키마 검증까지 마친 Project를 반환한다. */
export async function loadProject(projectPath: string): Promise<LoadedProject> {
  const { projectDir, projectFile } = resolveProjectPaths(projectPath)

  let raw: string
  try {
    raw = await readFile(projectFile, 'utf8')
  } catch {
    throw new ProjectValidationError(
      `project.yaml을 찾을 수 없습니다: ${projectFile}\n프로젝트 폴더 안에 project.yaml이 있는지 확인하세요.`,
    )
  }

  let data: unknown
  try {
    data = YAML.parse(raw)
  } catch (err) {
    throw new ProjectValidationError(
      `YAML을 읽는 중 오류가 발생했습니다: ${(err as Error).message}\n들여쓰기, 콜론(:), 따옴표가 깨졌는지 확인하세요.`,
    )
  }

  const result = projectSchema.safeParse(data)
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)'
      return `  - ${path}: ${issue.message}`
    })
    throw new ProjectValidationError(
      `project.yaml 형식 오류:\n${issues.join('\n')}\n앱의 초안 검증 또는 README의 project.yaml 필드 설명을 기준으로 수정하세요.`,
    )
  }

  return { project: result.data, projectDir, projectFile }
}
