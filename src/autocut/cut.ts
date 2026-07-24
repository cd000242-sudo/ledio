import { join } from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'
import { runFfmpeg } from '../video/ffmpeg.js'
import type { Segment } from './silence.js'

/**
 * 유지 구간들을 trim + concat 하는 filter_complex 문자열을 만든다.
 * 각 구간을 잘라 setpts로 시간 원점을 맞춘 뒤 이어 붙인다.
 */
export function buildCutFilter(segments: Segment[]): string {
  const parts: string[] = []
  const labels: string[] = []
  segments.forEach((s, i) => {
    parts.push(`[0:v]trim=start=${s.start}:end=${s.end},setpts=PTS-STARTPTS[v${i}]`)
    parts.push(`[0:a]atrim=start=${s.start}:end=${s.end},asetpts=PTS-STARTPTS[a${i}]`)
    labels.push(`[v${i}][a${i}]`)
  })
  parts.push(`${labels.join('')}concat=n=${segments.length}:v=1:a=1[v][a]`)
  return parts.join(';')
}

export interface CutVideoOptions {
  input: string
  segments: Segment[]
  outPath: string
  workDir: string
}

/**
 * 유지 구간만 남긴 영상을 만든다.
 * 필터는 길어질 수 있어 파일로 저장하고 -filter_complex_script로 전달한다
 * (명령줄 길이 제한/경로 이스케이프 회피).
 */
export async function cutVideo(opts: CutVideoOptions): Promise<void> {
  if (opts.segments.length === 0) {
    throw new Error('유지할 구간이 없습니다(전부 무음으로 판정됨).')
  }
  await mkdir(opts.workDir, { recursive: true })
  const filterFile = 'cut_filter.txt'
  await writeFile(join(opts.workDir, filterFile), buildCutFilter(opts.segments), 'utf8')

  await runFfmpeg(
    [
      '-y',
      '-i',
      opts.input,
      '-/filter_complex',
      filterFile,
      '-map',
      '[v]',
      '-map',
      '[a]',
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      opts.outPath,
    ],
    { cwd: opts.workDir },
  )
}
