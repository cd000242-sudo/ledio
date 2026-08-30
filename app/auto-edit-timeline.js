/* global document, window, requestAnimationFrame */
/**
 * 자동 편집 타임라인 — 자를 구간을 눈으로 보고 끌어서 조절한다.
 *
 * 파형 위에 자를 구간을 이유별 색으로 얹는다. 말 없는 구간이 납작하게 보이므로
 * "여기를 자른다"가 납득이 된다. 양 끝을 끌면 범위가 바뀐다.
 *
 * 계산(확대·이동)은 timeline-window.js에 따로 두었다 — 그쪽만 따로 시험한다.
 */

import { clampWindow, fitAround, fromRatio, toRatio, zoomAround } from './timeline-window.js'

const REGION_CLASS = {
  silence: 'r-silence',
  filler: 'r-filler',
  duplicate: 'r-dup',
  stumble: 'r-filler',
  retake: 'r-retake',
}

const clock = (seconds) => {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`
}

const shortClock = (seconds) => {
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds - minutes * 60)
  return `${minutes}:${rest < 10 ? '0' : ''}${rest}`
}

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * 타임라인을 만든다.
 *
 * @param {object} options
 *   totalMs     영상 전체 길이
 *   cuts        [{ id, startMs, endMs, reason, on }]
 *   peaks       0~1 배열(없으면 파형 없이 그린다)
 *   onSeek      (초) 그 지점으로 이동
 *   onAdjust    (id, startMs, endMs) 구간을 끌어 조절함
 *   onSelect    (id) 구간을 고름
 */
export function createTimeline(options) {
  const total = Math.max(0.1, options.totalMs / 1000)
  let view = { offset: 0, span: total }
  let playhead = 0
  let selected = null

  const root = el('div', 'tl')
  const head = el('div', 'tl-head')
  const zoomLevel = el('span', 'tl-zoom-level', '1.0×')
  const zoomOut = el('button', 'tl-zoom-btn', '−')
  const zoomIn = el('button', 'tl-zoom-btn', '+')
  const zoomAll = el('button', 'tl-zoom-btn tl-zoom-all', '전체')
  for (const button of [zoomOut, zoomIn, zoomAll]) button.type = 'button'
  zoomOut.title = '축소'
  zoomIn.title = '확대'

  const legend = el('div', 'tl-legend')
  for (const [label, color] of [
    ['말 없음', 'var(--blue)'],
    ['군더더기', 'var(--berry)'],
    ['중복', 'var(--copper)'],
    ['다시 찍음', 'var(--green)'],
  ]) {
    const item = el('span')
    const dot = el('i')
    dot.style.background = color
    item.append(dot, el('span', null, label))
    legend.append(item)
  }
  head.append(el('span', 'tl-title', '타임라인'), zoomOut, zoomLevel, zoomIn, zoomAll, legend)

  const ruler = el('div', 'tl-ruler')
  const track = el('div', 'tl-track')
  const canvas = document.createElement('canvas')
  const cursor = el('div', 'tl-head-line')
  track.append(canvas, cursor)

  const minimap = el('div', 'tl-minimap')
  const windowBox = el('div', 'tl-minimap-win')
  minimap.append(windowBox)

  const hint = el('p', 'tl-hint')
  hint.append(
    el('b', null, 'Ctrl + 휠'),
    el('span', null, ' 확대·축소 · '),
    el('b', null, 'Shift + 휠'),
    el('span', null, ' 좌우 이동 · 구간 양 끝을 끌면 자를 범위가 바뀝니다'),
  )
  root.append(head, ruler, track, minimap, hint)

  function drawWave() {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (!width || !height) return
    canvas.width = width * 2
    canvas.height = height * 2
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const peaks = options.peaks ?? []
    if (peaks.length === 0) return

    // 조용히 녹음한 영상도 화면에서는 꽉 차 보이게 가장 큰 값에 맞춘다.
    const loudest = Math.max(0.05, ...peaks)
    const bars = Math.min(canvas.width / 4, 900)
    for (let index = 0; index < bars; index += 1) {
      const at = fromRatio(view, index / bars)
      const spot = Math.floor((at / total) * peaks.length)
      const value = (peaks[spot] ?? 0) / loudest
      const barHeight = Math.max(2, value * canvas.height * 0.92)
      ctx.fillStyle = value < 0.06 ? 'rgba(140,150,176,0.35)' : 'rgba(79,124,255,0.55)'
      const barWidth = canvas.width / bars
      ctx.fillRect(index * barWidth + barWidth * 0.2, (canvas.height - barHeight) / 2, barWidth * 0.6, barHeight)
    }
  }

  function drawRuler() {
    ruler.replaceChildren()
    for (let index = 0; index <= 6; index += 1) {
      const mark = el('span')
      mark.style.left = `${(index / 6) * 100}%`
      const at = fromRatio(view, index / 6)
      mark.textContent = view.span < 60 ? clock(at) : shortClock(at)
      ruler.append(mark)
    }
  }

  function startDrag(cut, side, event) {
    event.preventDefault()
    event.stopPropagation()
    const rect = track.getBoundingClientRect()
    const move = (moveEvent) => {
      const at = fromRatio(view, (moveEvent.clientX - rect.left) / rect.width) * 1000
      const startMs = side === 'start' ? Math.min(at, cut.endMs - 200) : cut.startMs
      const endMs = side === 'end' ? Math.max(at, cut.startMs + 200) : cut.endMs
      options.onAdjust?.(cut.id, Math.max(0, startMs), Math.min(options.totalMs, endMs))
    }
    const stop = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', stop)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', stop)
  }

  function drawRegions() {
    for (const node of track.querySelectorAll('.tl-region')) node.remove()
    for (const cut of options.cuts ?? []) {
      const left = toRatio(view, cut.startMs / 1000)
      const right = toRatio(view, cut.endMs / 1000)
      if (right < -0.05 || left > 1.05) continue
      const node = el('div', `tl-region ${REGION_CLASS[cut.reason] ?? 'r-silence'}`)
      if (!cut.on) node.classList.add('is-off')
      if (selected === cut.id) node.classList.add('is-selected')
      node.style.left = `${left * 100}%`
      node.style.width = `${Math.max(0.15, (right - left) * 100)}%`
      node.title = `${clock(cut.startMs / 1000)} – ${clock(cut.endMs / 1000)}`

      for (const side of ['start', 'end']) {
        const grip = el('span', `tl-grip ${side === 'start' ? 'is-start' : 'is-end'}`)
        grip.addEventListener('mousedown', (event) => startDrag(cut, side, event))
        node.append(grip)
      }
      node.addEventListener('click', (event) => {
        event.stopPropagation()
        options.onSelect?.(cut.id)
      })
      track.append(node)
    }
  }

  function paint() {
    zoomLevel.textContent = `${(total / view.span).toFixed(1)}×`
    cursor.style.left = `${toRatio(view, playhead) * 100}%`
    windowBox.style.left = `${(view.offset / total) * 100}%`
    windowBox.style.width = `${(view.span / total) * 100}%`
    drawWave()
    drawRuler()
    drawRegions()
  }

  track.addEventListener('click', (event) => {
    const rect = track.getBoundingClientRect()
    options.onSeek?.(fromRatio(view, (event.clientX - rect.left) / rect.width))
  })

  track.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey && !event.shiftKey) return
      event.preventDefault()
      const rect = track.getBoundingClientRect()
      const anchor = (event.clientX - rect.left) / rect.width
      view = event.ctrlKey
        ? zoomAround(view, anchor, event.deltaY < 0 ? 1.25 : 0.8, total)
        : clampWindow({ ...view, offset: view.offset + (event.deltaY > 0 ? 0.2 : -0.2) * view.span }, total)
      paint()
    },
    { passive: false },
  )

  minimap.addEventListener('click', (event) => {
    const rect = minimap.getBoundingClientRect()
    const middle = ((event.clientX - rect.left) / rect.width) * total
    view = clampWindow({ ...view, offset: middle - view.span / 2 }, total)
    paint()
  })
  zoomIn.addEventListener('click', () => {
    view = zoomAround(view, 0.5, 1.6, total)
    paint()
  })
  zoomOut.addEventListener('click', () => {
    view = zoomAround(view, 0.5, 1 / 1.6, total)
    paint()
  })
  zoomAll.addEventListener('click', () => {
    view = { offset: 0, span: total }
    paint()
  })

  requestAnimationFrame(paint)

  return {
    node: root,
    /** 재생 머리 위치를 옮긴다(다시 그리지 않고 선만 움직인다). */
    setPlayhead(seconds) {
      playhead = seconds
      cursor.style.left = `${toRatio(view, playhead) * 100}%`
    },
    /** 고른 구간에 맞춰 확대하고 강조한다. */
    focus(cut) {
      selected = cut?.id ?? null
      if (cut) view = fitAround(cut, total)
      paint()
    },
    refresh: paint,
  }
}
