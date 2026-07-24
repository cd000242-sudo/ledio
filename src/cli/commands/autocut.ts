import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join, basename, extname, resolve } from 'node:path'
import { logger } from '../../utils/logger.js'
import { ensureFfmpeg } from '../../video/ffmpeg.js'
import { detectSilence } from '../../autocut/detectSilence.js'
import { computeKeepSegments, summarizeCut } from '../../autocut/silence.js'
import { cutVideo } from '../../autocut/cut.js'

export interface AutocutOptions {
  minSilence?: number
  padding?: number
  minKeep?: number
  noiseDb?: number
  out?: string
}

function defaultOutPath(input: string): string {
  const ext = extname(input) || '.mp4'
  return join(dirname(input), `${basename(input, ext)}_cut.mp4`)
}

/** 무음 구간을 자동으로 잘라내 편집 시간을 줄인다. */
export async function runAutocut(input: string, options: AutocutOptions = {}): Promise<number> {
  logger.step(`무음 자동컷: ${input}`)

  // ffmpeg를 작업폴더 cwd로 실행하므로 입력/출력은 절대경로로 고정한다.
  const inputAbs = resolve(input)

  try {
    await ensureFfmpeg()
  } catch (err) {
    logger.error((err as Error).message)
    return 1
  }

  try {
    await access(inputAbs)
  } catch {
    logger.error(`파일을 찾을 수 없습니다: ${input}`)
    return 1
  }

  let detect
  try {
    logger.dim('  무음 감지(silencedetect)')
    detect = await detectSilence(inputAbs, {
      noiseDb: options.noiseDb,
      minDetect: Math.min(0.2, options.minSilence ?? 0.6),
    })
  } catch (err) {
    logger.error((err as Error).message)
    return 1
  }

  const keep = computeKeepSegments(detect.duration, detect.silences, {
    minSilence: options.minSilence,
    padding: options.padding,
    minKeep: options.minKeep,
  })
  const summary = summarizeCut(detect.duration, keep)

  if (summary.removedDuration < 0.05 || keep.length === 0) {
    logger.warn('잘라낼 무음이 거의 없습니다. 출력을 만들지 않았습니다.')
    return 0
  }

  const outPath = options.out ? resolve(options.out) : defaultOutPath(inputAbs)
  const workDir = join(dirname(outPath), '.autocut-work')

  try {
    await rm(workDir, { recursive: true, force: true })
    await mkdir(workDir, { recursive: true })

    logger.dim(`  ${summary.cutCount}개 구간 제거, ${summary.segmentCount}개 유지 → 결합`)
    await cutVideo({ input: inputAbs, segments: keep, outPath, workDir })

    const reportPath = join(dirname(outPath), `${basename(outPath, extname(outPath))}_autocut.json`)
    await writeFile(
      reportPath,
      JSON.stringify({ input: inputAbs, output: outPath, ...summary, segments: keep }, null, 2),
      'utf8',
    )

    await rm(workDir, { recursive: true, force: true })

    const pct = ((summary.removedDuration / summary.originalDuration) * 100).toFixed(0)
    logger.success(
      `완료: ${summary.originalDuration}s → ${summary.keptDuration}s ` +
        `(${summary.removedDuration}s / ${pct}% 제거) → ${outPath}`,
    )
    return 0
  } catch (err) {
    logger.error(`자동컷 실패: ${(err as Error).message}`)
    logger.dim(`  작업 폴더 보존(디버그용): ${workDir}`)
    return 1
  }
}
