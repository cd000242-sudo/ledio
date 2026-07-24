import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import YAML from 'yaml'
import { logger } from '../../utils/logger.js'
import { ensureFfmpeg } from '../../video/ffmpeg.js'
import { probeDuration } from '../../video/ffprobe.js'
import { resolveClipPath } from '../../utils/paths.js'
import { buildProductProject, type ProductWizardInput } from '../../modes/productProject.js'
import { runRender } from './render.js'

/**
 * 쇼핑쇼츠 위저드 스펙(JSON)을 받아: 클립 길이 측정 → project.yaml 생성 → 렌더.
 * 스펙은 projectDir(프로젝트 폴더) 기준으로 clips 상대경로를 가진다.
 */
export async function runProductRender(specPath: string): Promise<number> {
  try {
    await ensureFfmpeg()
  } catch (err) {
    logger.error((err as Error).message)
    return 1
  }

  const resolvedSpec = resolve(specPath)
  let spec: ProductWizardInput & { projectDir?: string }
  try {
    spec = JSON.parse(await readFile(resolvedSpec, 'utf8'))
  } catch (err) {
    logger.error(`스펙을 읽을 수 없습니다: ${(err as Error).message}`)
    return 1
  }

  const projectDir = spec.projectDir ? resolve(spec.projectDir) : dirname(resolvedSpec)

  logger.step(`쇼핑쇼츠 렌더: ${spec.productName}`)
  const clipInfos = []
  for (const clip of spec.clips) {
    const clipPath = resolveClipPath(projectDir, clip)
    let durationSec: number
    try {
      durationSec = await probeDuration(clipPath)
    } catch (err) {
      logger.error(`클립 길이 측정 실패(${clip}): ${(err as Error).message}`)
      return 1
    }
    clipInfos.push({ file: clip, durationSec })
  }

  let project
  try {
    project = buildProductProject(spec, clipInfos)
  } catch (err) {
    logger.error((err as Error).message)
    return 1
  }

  await mkdir(projectDir, { recursive: true })
  const projectYaml = join(projectDir, 'project.yaml')
  await writeFile(projectYaml, YAML.stringify(project), 'utf8')
  logger.dim(`  project.yaml 생성: ${projectYaml}`)

  return runRender(projectDir)
}
