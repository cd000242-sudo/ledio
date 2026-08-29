/* global process */
/**
 * 자막 지우기 오케스트레이션.
 *
 * 원칙: **먼저 몇 초만 해보고 결과를 보여준다.** 전체는 오래 걸리니 확인 후에 돌린다.
 * 쇼츠(9:16)든 롱폼(16:9)이든 좌표 기반이라 비율을 가리지 않는다.
 */
import { basename, dirname, extname, join } from 'node:path'

export const ERASE_MODES = ['background', 'fast', 'blur']

export function erasePaths(mediaPath, preview = false) {
  const dir = dirname(mediaPath)
  const stem = basename(mediaPath, extname(mediaPath))
  const ext = extname(mediaPath) || '.mp4'
  const suffix = preview ? '_자막지움_미리보기' : '_자막지움'
  return {
    out: join(dir, `${stem}${suffix}${ext}`),
    temp: join(dir, `.erase-${stem}${preview ? '-preview' : ''}.mp4`),
  }
}

/** 파이썬 인자 조립 — box는 'auto' 또는 'x,y,w,h'. */
export function buildEraseArgs(options) {
  const args = [
    options.scriptPath,
    options.mediaPath,
    '--out',
    options.outPath,
    '--temp',
    options.tempPath,
    '--box',
    options.box ?? 'auto',
    '--mode',
    ERASE_MODES.includes(options.mode) ? options.mode : 'background',
  ]
  if (options.startSec) args.push('--start', String(options.startSec))
  if (options.durationSec) args.push('--duration', String(options.durationSec))
  return args
}

/** 진행 안내 문구에 쓸 예상 시간 — 실측(6초에 1.3초)을 바탕으로 어림잡는다. */
export function estimateSeconds(mediaSeconds, mode = 'background') {
  const perSecond = mode === 'blur' ? 0.12 : mode === 'fast' ? 0.35 : 0.25
  return Math.max(3, Math.round(mediaSeconds * perSecond))
}

/** 파이썬이 stderr로 알려준 자동 감지 영역을 읽는다. */
export function parseDetectedBox(stderr) {
  const match = /detected box=(\d+),(\d+),(\d+),(\d+)/.exec(String(stderr ?? ''))
  if (!match) return null
  return { x: Number(match[1]), y: Number(match[2]), w: Number(match[3]), h: Number(match[4]) }
}

/**
 * 자막 지우기 실행.
 * @param deps `{ runPython(args): Promise<{ok, stderr, error}>, pythonPath, scriptPath }`
 */
export async function eraseSubtitles(mediaPath, deps, options = {}) {
  const preview = options.preview === true
  const paths = erasePaths(mediaPath, preview)
  const args = buildEraseArgs({
    scriptPath: deps.scriptPath,
    mediaPath,
    outPath: paths.out,
    tempPath: paths.temp,
    box: options.box ?? 'auto',
    mode: options.mode ?? 'background',
    startSec: options.startSec ?? 0,
    // 미리보기는 기본 3초만 — 전체는 오래 걸린다.
    durationSec: preview ? (options.durationSec ?? 3) : (options.durationSec ?? 0),
  })

  const startedAt = Date.now()
  const result = await deps.runPython(args)
  if (!result.ok) return { ok: false, error: result.error ?? '자막 지우기에 실패했습니다.' }

  const elapsedSec = Math.round((Date.now() - startedAt) / 1000)
  // 미리보기에 걸린 시간으로 전체 예상 시간을 알려준다 — 사용자가 기다릴지 말지 정할 수 있게.
  const estimateFullSec =
    preview && options.mediaSeconds
      ? estimateSeconds(options.mediaSeconds, options.mode ?? 'background')
      : null

  return {
    ok: true,
    outPath: paths.out,
    preview,
    elapsedSec,
    estimateFullSec,
    detectedBox: parseDetectedBox(result.stderr),
    mode: options.mode ?? 'background',
  }
}
