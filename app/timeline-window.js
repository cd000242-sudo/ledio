/**
 * 타임라인에서 **지금 보이는 구간**을 다루는 계산.
 *
 * 14분 영상을 한 화면에 펼치면 0.9초짜리 무음이 1픽셀이라 끌어서 조절할 수가 없다.
 * 그래서 확대·이동이 필요하고, 그 계산만 따로 떼어 시험할 수 있게 두었다.
 *
 * 구간은 `{ offset, span }`(둘 다 초)로 나타낸다. offset이 화면 왼쪽 끝의 시각이다.
 */

/** 이보다 잘게 확대하지 않는다 — 더 들어가면 파형이 계단처럼 보이고 조작만 어려워진다. */
const MIN_SPAN = 0.5

/** 시각(초) → 화면 가로 비율(0~1). 화면 밖이면 0 미만이거나 1 초과다. */
export function toRatio(view, seconds) {
  return (seconds - view.offset) / view.span
}

/** 화면 가로 비율(0~1) → 시각(초). */
export function fromRatio(view, ratio) {
  return view.offset + ratio * view.span
}

/** 영상 밖으로 나가거나 전체보다 넓어지지 않게 붙잡는다. */
export function clampWindow(view, totalSeconds) {
  const span = Math.min(totalSeconds, Math.max(MIN_SPAN, view.span))
  const offset = Math.min(totalSeconds - span, Math.max(0, view.offset))
  return { offset, span }
}

/**
 * 가리킨 지점을 제자리에 두고 확대·축소한다.
 * 화면 가운데를 기준으로 하면 보던 곳이 밖으로 밀려나 다시 찾아야 한다.
 */
export function zoomAround(view, anchorRatio, factor, totalSeconds) {
  const anchorTime = fromRatio(view, anchorRatio)
  const span = Math.min(totalSeconds, Math.max(MIN_SPAN, view.span / factor))
  return clampWindow({ offset: anchorTime - anchorRatio * span, span }, totalSeconds)
}

/** 고른 구간이 화면의 3분의 1쯤 차지하도록 맞춘다 — 끌어서 조절하기 좋은 크기다. */
export function fitAround(range, totalSeconds) {
  const seconds = (range.endMs - range.startMs) / 1000
  const span = Math.max(2, seconds * 3)
  const middle = (range.startMs + range.endMs) / 2000
  return clampWindow({ offset: middle - span / 2, span }, totalSeconds)
}
