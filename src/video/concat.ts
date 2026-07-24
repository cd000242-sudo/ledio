import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { runFfmpeg } from './ffmpeg.js'

/**
 * 정규화된(=동일 파라미터) 클립들을 concat 디먹서로 무손실 결합한다.
 * 모든 입력이 같은 코덱/해상도여야 -c copy가 안전하다.
 */
export async function concatClips(
  clipPaths: string[],
  outPath: string,
  workDir: string,
): Promise<void> {
  const listPath = join(workDir, 'concat.txt')
  const lines = clipPaths.map((p) => {
    const safe = p.replace(/\\/g, '/').replace(/'/g, "'\\''")
    return `file '${safe}'`
  })
  await writeFile(listPath, lines.join('\n'), 'utf8')

  await runFfmpeg([
    '-y',
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listPath,
    '-c',
    'copy',
    '-movflags',
    '+faststart',
    outPath,
  ])
}
