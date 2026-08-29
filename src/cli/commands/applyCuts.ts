import { execa } from 'execa'
import { access, mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { logger } from '../../utils/logger.js'

export interface ApplyCutsOptions {
  /** 남길 구간 JSON 파일 — [{startMs,endMs}, ...] */
  keep: string
  out?: string
  json?: boolean
}

interface Range {
  startMs: number
  endMs: number
}

/** 남길 구간만 잘라내 이어 붙인다. concat demuxer를 쓰면 재인코딩이 한 번으로 끝난다. */
export function buildSegmentArgs(source: string, range: Range, outPath: string): string[] {
  const start = (range.startMs / 1000).toFixed(3)
  const duration = ((range.endMs - range.startMs) / 1000).toFixed(3)
  return [
    '-y',
    // -ss를 -i 앞에 두면 빠르지만 키프레임에 붙는다. 뒤에 두면 정확하다 — 편집은 정확도가 먼저다.
    '-i',
    source,
    '-ss',
    start,
    '-t',
    duration,
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '20',
    '-c:a',
    'aac',
    '-avoid_negative_ts',
    'make_zero',
    outPath,
  ]
}

export function buildConcatArgs(listPath: string, outPath: string): string[] {
  return ['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', outPath]
}

/** ffmpeg concat 목록 파일 내용 — 경로의 작은따옴표를 이스케이프한다. */
export function buildConcatList(files: string[]): string {
  return files.map((file) => `file '${file.split('\\').join('/').replace(/'/g, "'\\''")}'`).join('\n') + '\n'
}

export async function runApplyCuts(videoPath: string, options: ApplyCutsOptions): Promise<number> {
  const workDir = join(dirname(videoPath), '.cuts')
  try {
    await access(videoPath)
    const raw = await import('node:fs/promises').then((fs) => fs.readFile(options.keep, 'utf8'))
    const ranges = JSON.parse(raw) as Range[]
    if (!Array.isArray(ranges) || ranges.length === 0) throw new Error('남길 구간이 비어 있습니다.')

    const dot = videoPath.lastIndexOf('.')
    const stem = dot > 0 ? videoPath.slice(0, dot) : videoPath
    const ext = dot > 0 ? videoPath.slice(dot) : '.mp4'
    const outPath = options.out ?? `${stem}_편집${ext}`

    await mkdir(workDir, { recursive: true })
    const parts: string[] = []
    for (const [index, range] of ranges.entries()) {
      const partPath = join(workDir, `part-${String(index).padStart(3, '0')}${ext}`)
      const result = await execa('ffmpeg', buildSegmentArgs(videoPath, range, partPath), { reject: false })
      if (result.exitCode !== 0) {
        throw new Error(`구간 잘라내기 실패(${index + 1}번째):\n${String(result.stderr ?? '').split('\n').slice(-3).join('\n')}`)
      }
      parts.push(partPath)
    }

    const listPath = join(workDir, 'concat.txt')
    await writeFile(listPath, buildConcatList(parts), 'utf8')
    const joined = await execa('ffmpeg', buildConcatArgs(listPath, outPath), { reject: false })
    if (joined.exitCode !== 0) {
      throw new Error(`이어 붙이기 실패:\n${String(joined.stderr ?? '').split('\n').slice(-3).join('\n')}`)
    }

    await rm(workDir, { recursive: true, force: true })

    if (options.json) console.log(JSON.stringify({ ok: true, videoPath, outPath, parts: ranges.length }, null, 2))
    else logger.success(`편집본을 만들었습니다: ${outPath}`)
    return 0
  } catch (err) {
    await rm(workDir, { recursive: true, force: true }).catch(() => {})
    const message = err instanceof Error ? err.message : String(err)
    if (options.json) console.log(JSON.stringify({ ok: false, error: message }, null, 2))
    else logger.error(message)
    return 1
  }
}
