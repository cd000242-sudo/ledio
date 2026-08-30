/**
 * 타임라인에 그릴 파형(소리 크기)을 뽑는다.
 *
 * 자를 곳을 눈으로 고르려면 파형이 있어야 한다 — 말 없는 구간이 납작하게 보여야
 * "여기를 자른다"가 납득이 된다. 소리를 아주 낮은 속도로 훑기만 하면 되므로 빠르다.
 */

/**
 * 파형용 표본 속도(Hz).
 *
 * 너무 낮추면 안 된다. 리샘플은 저역통과 필터를 거치므로 200Hz로 내리면 사람 목소리가
 * 통째로 걸러져 파형이 0으로 나온다(실측으로 확인한 사고). 8kHz면 음성이 그대로 남는다.
 */
export const PEAK_RATE = 8000

/** ffmpeg로 소리만 뽑아 표준출력으로 받는다(파일로 남기지 않는다). */
export function buildPeaksArgs(mediaPath) {
  return [
    '-v',
    'error',
    '-i',
    mediaPath,
    '-vn',
    '-ac',
    '1',
    '-ar',
    String(PEAK_RATE),
    '-f',
    's16le',
    '-',
  ]
}

/**
 * 표본을 칸 수만큼 묶어 각 칸의 **가장 큰 소리**를 0~1로 돌려준다.
 * 평균이 아니라 최대를 쓴다 — 짧게 튀는 소리가 평균에 묻히면 안 된다.
 */
export function bucketPeaks(samples, buckets) {
  if (!samples || samples.length === 0 || buckets <= 0) return []
  const out = new Array(buckets).fill(0)
  const per = samples.length / buckets
  for (let index = 0; index < buckets; index += 1) {
    const from = Math.floor(index * per)
    const to = Math.max(from + 1, Math.floor((index + 1) * per))
    let loudest = 0
    for (let at = from; at < to && at < samples.length; at += 1) {
      const value = Math.abs(samples[at])
      if (value > loudest) loudest = value
    }
    out[index] = Math.min(1, loudest / 32768)
  }
  return out
}
