import { access } from 'node:fs/promises'
import { loadProject } from '../../config/loadProject.js'
import { resolveClipPath } from '../../utils/paths.js'
import { logger } from '../../utils/logger.js'
import { ProjectValidationError } from '../../utils/errors.js'
import { ESSENTIAL_ROLES } from '../../config/schema.js'
import { buildSourceRiskReport } from '../../package/sourceRisk.js'

export interface ValidateResult {
  ok: boolean
  errors: string[]
  warnings: string[]
}

/** 프로젝트를 검증하고, CLI와 테스트에서 재사용할 수 있는 결과 객체를 반환한다. */
export async function validateProject(projectPath: string): Promise<ValidateResult> {
  const errors: string[] = []
  const warnings: string[] = []

  let loaded
  try {
    loaded = await loadProject(projectPath)
  } catch (err) {
    if (err instanceof ProjectValidationError) {
      return { ok: false, errors: [err.message], warnings }
    }
    throw err
  }

  const { project, projectDir } = loaded

  for (const clip of project.clips) {
    const clipPath = resolveClipPath(projectDir, clip.file)
    try {
      await access(clipPath)
    } catch {
      errors.push(
        `클립 파일을 찾을 수 없습니다: ${clip.file} (role: ${clip.role}). project.yaml의 file 경로 또는 clips 폴더를 확인하세요.`,
      )
    }
  }

  const presentRoles = new Set(project.clips.map((clip) => clip.role))
  for (const role of ESSENTIAL_ROLES) {
    if (!presentRoles.has(role)) {
      warnings.push(
        `권장 역할이 없습니다: ${role}. hook/use/result가 모두 있으면 쇼츠 구조가 더 안정적입니다.`,
      )
    }
  }

  const riskReport = buildSourceRiskReport(project)
  for (const item of riskReport.items) {
    if (item.level === 'caution') {
      warnings.push(`소스 권리 확인 필요: ${item.title} - ${item.reason}`)
    }
    if (item.level === 'risk') {
      warnings.push(`위험 소스 설정: ${item.title} - ${item.reason}`)
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}

/** validate 명령의 실제 실행부. 결과를 출력하고 종료 코드를 반환한다. */
export async function runValidate(projectPath: string): Promise<number> {
  logger.step(`검증: ${projectPath}`)

  let result: ValidateResult
  try {
    result = await validateProject(projectPath)
  } catch (err) {
    logger.error(`예상하지 못한 오류: ${(err as Error).message}`)
    return 1
  }

  for (const warning of result.warnings) logger.warn(warning)
  for (const error of result.errors) logger.error(error)

  if (result.ok) {
    logger.success(result.warnings.length ? '검증 통과 (경고 있음)' : '검증 통과')
    return 0
  }

  logger.error(`검증 실패: 오류 ${result.errors.length}개`)
  return 1
}
