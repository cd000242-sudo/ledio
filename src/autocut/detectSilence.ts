import { execa } from 'execa'
import { FFMPEG_BIN } from '../video/ffmpeg.js'
import { probeDuration } from '../video/ffprobe.js'
import { parseSilenceLog, type Interval } from './silence.js'

export interface DetectOptions {
  /** 무음으로 볼 음량 임계값(dB, 음수). 낮을수록(더 조용해야) 덜 잡음. */
  noiseDb?: number
  /** 감지 최소 무음 길이(초). 정책상 minSilence보다 작게 잡아 여지를 둔다. */
  minDetect?: number
}

export interface DetectResult {
  duration: number
  silences: Interval[]
}

/** ffmpeg silencedetect로 무음 구간과 총 길이를 얻는다. */
export async function detectSilence(input: string, opts: DetectOptions = {}): Promise<DetectResult> {
  const noise = opts.noiseDb ?? -30
  const d = opts.minDetect ?? 0.2

  const duration = await probeDuration(input)

  // silencedetect 로그는 stderr로 나온다. -f null - 는 정상 종료(exit 0).
  const { stderr } = await execa(
    FFMPEG_BIN,
    ['-hide_banner', '-i', input, '-af', `silencedetect=noise=${noise}dB:d=${d}`, '-f', 'null', '-'],
    { reject: false },
  )

  return { duration, silences: parseSilenceLog(stderr) }
}
