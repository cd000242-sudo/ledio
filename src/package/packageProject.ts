import { access, copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { loadProject } from '../config/loadProject.js'
import { ProjectValidationError } from '../utils/errors.js'
import { getPlatformProfile } from '../platforms/profiles.js'
import {
  buildPerformanceRows,
  buildPublishPlan,
  serializePerformanceCsv,
  type PublishPlan,
  type RenderReport,
} from './publishPlan.js'
import { buildSourceRiskReport, type SourceRiskReport } from './sourceRisk.js'
import { writeZip, type ZipEntry } from './zip.js'
import { traceSource } from '../sources/sourceBoard.js'

export interface PackageResult {
  packageDir: string
  zipPath: string
  manifest: PublishPlan
  sourceRiskReport: SourceRiskReport
}

function stripExt(file: string): string {
  return basename(file, extname(file))
}

function parseRenderReport(raw: string): RenderReport {
  const data = JSON.parse(raw) as Partial<RenderReport>
  if (!data.projectName || !Array.isArray(data.variants)) {
    throw new ProjectValidationError('render_report.json 형식이 올바르지 않습니다.')
  }
  return data as RenderReport
}

async function readRenderReport(outputDir: string): Promise<RenderReport> {
  const reportPath = join(outputDir, 'render_report.json')
  try {
    return parseRenderReport(await readFile(reportPath, 'utf8'))
  } catch (err) {
    if (err instanceof ProjectValidationError) throw err
    throw new ProjectValidationError(`render_report.json을 읽을 수 없습니다: ${reportPath}`)
  }
}

export async function packageProject(
  projectPath: string,
  generatedAt = new Date().toISOString(),
): Promise<PackageResult> {
  const { project, projectDir } = await loadProject(projectPath)
  const outputDir = join(projectDir, 'output')
  const report = await readRenderReport(outputDir)
  const packageDir = join(outputDir, 'publish_package')
  const zipPath = join(outputDir, `${project.projectName}_publish_package.zip`)
  const manifest = buildPublishPlan(project, report, generatedAt)
  const sourceRiskReport = buildSourceRiskReport(project)
  const sourceTraceability = project.sources.map((source) => traceSource(source))
  const entries: ZipEntry[] = []

  async function writeText(relPath: string, content: string): Promise<void> {
    const out = join(packageDir, ...relPath.split('/'))
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, content, 'utf8')
    entries.push({ path: relPath, data: content })
  }

  async function copyVideo(file: string): Promise<void> {
    const source = join(outputDir, file)
    try {
      await access(source)
    } catch {
      throw new ProjectValidationError(`패키징할 렌더 영상이 없습니다: ${source}`)
    }
    const relPath = `videos/${file}`
    const target = join(packageDir, ...relPath.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target)
    entries.push({ path: relPath, data: await readFile(source) })
  }

  await rm(packageDir, { recursive: true, force: true })
  await mkdir(packageDir, { recursive: true })

  await writeText('manifest.json', JSON.stringify(manifest, null, 2))
  await writeText('source_risk_report.json', JSON.stringify(sourceRiskReport, null, 2))
  await writeText('source_traceability.json', JSON.stringify(sourceTraceability, null, 2))
  await writeText(
    'performance_template.csv',
    serializePerformanceCsv(buildPerformanceRows(manifest)),
  )

  for (const variant of report.variants) {
    await copyVideo(variant.file)
  }

  for (const item of manifest.items) {
    const profile = getPlatformProfile(item.platform)
    const stem = stripExt(item.videoFile)
    const folder = `platforms/${profile.folderName}`
    await writeText(`${folder}/${stem}.caption.txt`, item.caption)
    await writeText(`${folder}/${stem}.fixed-comment.txt`, item.fixedComment)
    await writeText(`${folder}/${stem}.metadata.json`, JSON.stringify(item, null, 2))
  }

  await writeZip(zipPath, entries)

  return {
    packageDir,
    zipPath,
    manifest,
    sourceRiskReport,
  }
}
