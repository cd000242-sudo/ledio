import { packageProject } from '../../package/packageProject.js'
import { logger } from '../../utils/logger.js'

/** package 명령의 실제 실행부. 렌더 결과를 플랫폼별 업로드 패키지와 ZIP으로 묶는다. */
export async function runPackage(projectPath: string): Promise<number> {
  logger.step(`패키징: ${projectPath}`)

  try {
    const result = await packageProject(projectPath)
    logger.success(`패키지 생성: ${result.packageDir}`)
    logger.success(`ZIP 생성: ${result.zipPath}`)
    logger.dim(`  업로드 항목: ${result.manifest.items.length}개`)
    logger.dim(
      `  소스 위험도: 안전 ${result.sourceRiskReport.summary.safe}, 주의 ${result.sourceRiskReport.summary.caution}, 위험 ${result.sourceRiskReport.summary.risk}`,
    )
    return 0
  } catch (err) {
    logger.error(`패키징 실패: ${(err as Error).message}`)
    return 1
  }
}
