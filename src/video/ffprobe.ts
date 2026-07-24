import { execa } from 'execa'
import { FFPROBE_BIN } from './ffmpeg.js'

export interface ClipInfo {
  duration: number
  width: number
  height: number
  hasAudio: boolean
}

interface FfprobeStream {
  codec_type?: string
  width?: number
  height?: number
}

interface FfprobeOutput {
  streams?: FfprobeStream[]
  format?: { duration?: string }
}

/** ffprobe로 클립의 길이/해상도/오디오 유무를 읽는다. */
export async function probeClip(path: string): Promise<ClipInfo> {
  let stdout: string
  try {
    ;({ stdout } = await execa(FFPROBE_BIN, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      path,
    ]))
  } catch (err) {
    const e = err as { stderr?: string }
    throw new Error(`ffprobe 실패 (${path}): ${e.stderr ?? '읽을 수 없는 파일'}`)
  }

  const data = JSON.parse(stdout) as FfprobeOutput
  const streams = data.streams ?? []
  const video = streams.find((s) => s.codec_type === 'video')
  if (!video) throw new Error(`영상 스트림이 없습니다: ${path}`)

  return {
    duration: Number(data.format?.duration ?? 0),
    width: video.width ?? 0,
    height: video.height ?? 0,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
  }
}

/** 영상 스트림 없이도(오디오 전용 포함) 총 길이(초)만 읽는다. */
export async function probeDuration(path: string): Promise<number> {
  try {
    const { stdout } = await execa(FFPROBE_BIN, [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=nokey=1:noprint_wrappers=1',
      path,
    ])
    return Number(stdout.trim())
  } catch (err) {
    const e = err as { stderr?: string }
    throw new Error(`ffprobe 실패 (${path}): ${e.stderr ?? '읽을 수 없는 파일'}`)
  }
}
