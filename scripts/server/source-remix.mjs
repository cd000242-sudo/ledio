/**
 * 소스 짜집기 서버 헬퍼 — ffprobe/프레임 추출 인자와 plan.json 조립(순수 함수만).
 * 실행(spawn)·파일 IO는 local-server가 담당한다.
 */

export function buildProbeArgs(path) {
  return ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path]
}

/** ffprobe JSON에서 길이·해상도를 꺼낸다. 영상 스트림이 없으면 null. */
export function parseProbeOutput(raw) {
  try {
    const data = JSON.parse(String(raw ?? ''))
    const streams = Array.isArray(data.streams) ? data.streams : []
    const video = streams.find((stream) => stream.codec_type === 'video')
    if (!video) return null
    return {
      durationSec: Number(data.format?.duration ?? 0),
      width: Number(video.width ?? 0),
      height: Number(video.height ?? 0),
    }
  } catch {
    return null
  }
}

/** 소스 중간 지점의 대표 프레임 1장 추출 인자 — 비전 5MB 한도를 위해 가로 720px로 캡. */
export function buildFrameExtractArgs(src, midSec, outPng) {
  return [
    '-y',
    '-ss',
    String(Math.max(0, midSec)),
    '-i',
    src,
    '-frames:v',
    '1',
    '-vf',
    "scale=w='min(720,iw)':h=-2",
    outPng,
  ]
}

/** CLI source-remix가 소비하는 plan.json을 조립한다(remixPlanSchema 계약). */
export function buildRemixPlan({ projectName, title, sentences, sources, assignments, ratio, disclosure }) {
  return {
    projectName,
    ...(title ? { title } : {}),
    sentences,
    sources,
    assignments,
    ratio: ratio === '16:9' ? '16:9' : '9:16',
    ...(disclosure ? { disclosure } : {}),
  }
}
