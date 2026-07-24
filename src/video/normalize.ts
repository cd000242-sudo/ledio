import { runFfmpeg } from './ffmpeg.js'
import { transitionFadeFilters } from './transition.js'
import type { ClipInfo } from './ffprobe.js'
import type { Transition } from '../config/schema.js'

export interface NormalizeOptions {
  input: string
  start: number
  end: number
  outPath: string
  width: number
  height: number
  fps: number
  info: ClipInfo
  speed?: number
  /** true면 이 클립의 원본 음성을 무음 처리한다. */
  mute?: boolean
  /** 클립 경계 페이드. 첫/마지막 클립 여부는 호출부에서 fadeIn/fadeOut으로 지정한다. */
  transition?: { type: Transition; fadeIn: boolean; fadeOut: boolean }
}

/** 9:16 정규화 비디오 필터. 원본 비율 유지 후 검은 여백으로 패딩한다. */
function normalizeSpeed(speed = 1): number {
  return Math.min(4, Math.max(0.25, Number.isFinite(speed) ? speed : 1))
}

export function buildNormalizeVf(width: number, height: number, fps: number, speed = 1): string {
  const safeSpeed = normalizeSpeed(speed)
  return [
    `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
    `pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    'setsar=1',
    safeSpeed === 1 ? '' : `setpts=${(1 / safeSpeed).toFixed(6)}*PTS`,
    `fps=${fps}`,
  ]
    .filter(Boolean)
    .join(',')
}

export function buildAtempoFilter(speed = 1): string {
  let remaining = normalizeSpeed(speed)
  const filters: string[] = []
  while (remaining > 2) {
    filters.push('atempo=2')
    remaining /= 2
  }
  while (remaining < 0.5) {
    filters.push('atempo=0.5')
    remaining /= 0.5
  }
  filters.push(`atempo=${Number(remaining.toFixed(3))}`)
  return filters.join(',')
}

/** 모든 클립을 동일한 코덱/해상도/프레임레이트/오디오로 정규화한다(concat 호환). */
export async function normalizeClip(opts: NormalizeOptions): Promise<void> {
  const dur = opts.end - opts.start
  const speed = normalizeSpeed(opts.speed)
  const outputDur = dur / speed
  const fade = transitionFadeFilters({
    transition: opts.transition?.type ?? 'none',
    outputDurationSec: outputDur,
    fadeIn: opts.transition?.fadeIn ?? false,
    fadeOut: opts.transition?.fadeOut ?? false,
  })
  const vf = [buildNormalizeVf(opts.width, opts.height, opts.fps, speed), ...fade.video].join(',')
  const af = [buildAtempoFilter(speed), ...(opts.mute ? ['volume=0'] : []), ...fade.audio].join(',')
  const encode = [
    '-r',
    String(opts.fps),
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '44100',
    '-ac',
    '2',
    '-video_track_timescale',
    '30000',
    '-movflags',
    '+faststart',
  ]

  const args = opts.info.hasAudio
    ? [
        '-y',
        '-ss',
        String(opts.start),
        '-i',
        opts.input,
        '-t',
        String(dur),
        '-vf',
        vf,
        '-filter:a',
        af,
        ...encode,
        opts.outPath,
      ]
    : [
        '-y',
        '-ss',
        String(opts.start),
        '-i',
        opts.input,
        '-f',
        'lavfi',
        '-i',
        'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-t',
        String(outputDur),
        '-map',
        '0:v:0',
        '-map',
        '1:a:0',
        '-shortest',
        '-vf',
        vf,
        ...encode,
        opts.outPath,
      ]

  await runFfmpeg(args)
}
