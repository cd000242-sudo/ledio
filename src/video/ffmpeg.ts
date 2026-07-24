import { execa } from 'execa'
import { existsSync } from 'node:fs'

/** ffmpeg/ffprobe 바이너리. PATH에 없으면 환경변수로 절대경로를 지정할 수 있다. */
export const FFMPEG_BIN = process.env.FFMPEG_PATH ?? 'ffmpeg'
export const FFPROBE_BIN = process.env.FFPROBE_PATH ?? 'ffprobe'

export interface RunOptions {
  cwd?: string
}

function tail(s: string, n: number): string {
  return s.split(/\r?\n/).slice(-n).join('\n')
}

/** ffmpeg를 실행한다. 실패 시 stderr 마지막 줄들을 담은 명확한 에러를 던진다. */
export async function runFfmpeg(args: string[], opts: RunOptions = {}): Promise<void> {
  try {
    await execa(FFMPEG_BIN, args, { cwd: opts.cwd })
  } catch (err) {
    const e = err as { stderr?: string; shortMessage?: string }
    throw new Error(`ffmpeg 실행 실패: ${e.shortMessage ?? ''}\n${tail(e.stderr ?? '', 12)}`)
  }
}

/** ffmpeg가 사용 가능한지 확인한다. */
export async function ensureFfmpeg(): Promise<void> {
  try {
    await execa(FFMPEG_BIN, ['-version'])
    await execa(FFPROBE_BIN, ['-version'])
  } catch {
    throw new Error(
      'ffmpeg/ffprobe를 찾을 수 없습니다. FFmpeg를 설치하고 PATH에 추가하거나 ' +
        'FFMPEG_PATH / FFPROBE_PATH 환경변수로 경로를 지정하세요.',
    )
  }
}

/**
 * drawtext 등 필터 안에 들어가는 Windows 절대경로를 안전하게 만든다.
 * 역슬래시 -> 슬래시, 콜론 -> \: (필터 옵션 구분자와 충돌 방지)
 */
export function escapeFilterPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:')
}

/** 자막 폰트 경로. 기본은 맑은 고딕(Windows). SF_FONT_PATH로 덮어쓸 수 있다. */
export function resolveFontPath(): string {
  const custom = process.env.SF_FONT_PATH
  if (custom && existsSync(custom)) return custom
  return 'C:/Windows/Fonts/malgun.ttf'
}
