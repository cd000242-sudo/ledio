import type { DeliveryEnding } from './delivery.js'

export interface StyledAudioInput {
  pace?: number
  pitch?: number
  gain?: number
  ending?: DeliveryEnding
}

export interface StyledAudioFilter {
  kind: 'simple' | 'complex'
  filter: string
}

const ENDING_PROFILE: Record<Exclude<DeliveryEnding, 'neutral'>, { tailSec: number; semitones: number; fadeSec: number }> = {
  fall: { tailSec: 0.4, semitones: -0.7, fadeSec: 0.04 },
  'soft-fall': { tailSec: 0.32, semitones: -0.35, fadeSec: 0.08 },
  rise: { tailSec: 0.35, semitones: 0.65, fadeSec: 0.02 },
  crisp: { tailSec: 0.14, semitones: 0, fadeSec: 0.05 },
  linger: { tailSec: 0.55, semitones: -0.25, fadeSec: 0.14 },
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? (value as number) : fallback))
}

function pitchFilters(semitones: number): string[] {
  if (Math.abs(semitones) < 0.01) return []
  const factor = Math.pow(2, semitones / 12)
  return [
    'aresample=24000',
    `asetrate=24000*${factor.toFixed(6)}`,
    'aresample=24000',
    `atempo=${(1 / factor).toFixed(6)}`,
  ]
}

/**
 * 문장 전체 스타일과 마지막 음절의 끝음 변형을 FFmpeg 필터로 변환한다.
 * 끝음은 짧은 꼬리 구간만 분리해 피치를 바꾸고 15ms 크로스페이드로 이음새를 숨긴다.
 */
export function buildStyledAudioFilter(input: StyledAudioInput, sourceDurationSec: number): StyledAudioFilter {
  const pace = clamp(input.pace, 0.8, 1.25, 1)
  const pitch = clamp(input.pitch, -2, 2, 0)
  const gain = clamp(input.gain, -3, 3, 0)
  const base = [...pitchFilters(pitch)]
  if (Math.abs(pace - 1) >= 0.005) base.push(`atempo=${Number(pace.toFixed(3))}`)
  if (Math.abs(gain) >= 0.01) base.push(`volume=${Number(gain.toFixed(2))}dB`)

  const ending = input.ending ?? 'neutral'
  if (ending === 'neutral' || !ENDING_PROFILE[ending]) {
    return { kind: 'simple', filter: base.length > 0 ? base.join(',') : 'anull' }
  }

  const styledDuration = Math.max(0, Number(sourceDurationSec) || 0) / pace
  const profile = ENDING_PROFILE[ending]
  if (styledDuration < profile.tailSec + 0.15) {
    return { kind: 'simple', filter: base.length > 0 ? base.join(',') : 'anull' }
  }

  const tailSec = Math.min(profile.tailSec, styledDuration * 0.35)
  const tailStart = styledDuration - tailSec
  const tailFilters = pitchFilters(profile.semitones)
  if (profile.fadeSec > 0) {
    const fadeStart = Math.max(0, tailSec - profile.fadeSec)
    tailFilters.push(`afade=t=out:st=${fadeStart.toFixed(3)}:d=${profile.fadeSec.toFixed(3)}`)
  }
  if (tailFilters.length === 0) tailFilters.push('anull')

  const baseFilter = base.length > 0 ? base.join(',') : 'anull'
  return {
    kind: 'complex',
    filter:
      `[0:a]${baseFilter}[styled];` +
      '[styled]asplit=2[headsrc][tailsrc];' +
      `[headsrc]atrim=end=${tailStart.toFixed(3)},asetpts=PTS-STARTPTS[head];` +
      `[tailsrc]atrim=start=${tailStart.toFixed(3)},asetpts=PTS-STARTPTS,${tailFilters.join(',')}[tail];` +
      '[head][tail]acrossfade=d=0.015:c1=tri:c2=tri[out]',
  }
}
