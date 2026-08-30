/* global document, window */
/**
 * 자동 편집 검수 화면 — 보고 듣고 조절한 뒤 자른다.
 *
 * 수동편집과 같은 감각으로 만든다: 위에 미리보기, 아래에 타임라인, 옆에 자를 곳 목록.
 * 세 가지가 서로 붙어 있다 — 목록에서 고르면 그 자리로 가고 타임라인이 확대된다.
 *
 * "자를 곳 건너뛰고 보기"를 켜면 자를 구간을 뛰어넘어 재생한다. **편집 결과 미리보기**다.
 */

import { createTimeline } from './auto-edit-timeline.js'

const REASON_LABELS = {
  silence: '말 없음',
  filler: '군더더기',
  duplicate: '중복',
  stumble: '말 끊김',
  retake: '다시 찍음',
}

const CHIP_CLASS = {
  silence: 'chip-silence',
  filler: 'chip-filler',
  duplicate: 'chip-dup',
  stumble: 'chip-filler',
  retake: 'chip-retake',
}

const clock = (seconds) => {
  const minutes = Math.floor(seconds / 60)
  const rest = seconds - minutes * 60
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`
}

const el = (tag, className, text) => {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

/**
 * @param {object} options
 *   mediaPath  영상 경로
 *   totalMs    전체 길이
 *   cuts       [{ id, startMs, endMs, reason, label, text, keep, on }]
 *   peaks      파형(0~1 배열)
 *   onToggle   (id, on)
 *   onAdjust   (id, startMs, endMs)
 */
export function buildReview(options) {
  const root = el('div', 'auto-review')
  let selected = null
  let skipCuts = true

  const video = document.createElement('video')
  video.className = 'auto-review-video'
  video.src = `/api/auto-edit/media?mediaPath=${encodeURIComponent(options.mediaPath)}`
  video.preload = 'metadata'
  video.controls = false

  const badge = el('span', 'auto-review-badge', '그대로 두는 구간')
  const time = el('span', 'auto-review-time', '0:00.0')
  const stage = el('div', 'auto-review-stage')
  stage.append(video, badge, time)

  const cutAt = (seconds) => options.cuts.find((cut) => cut.on && seconds >= cut.startMs / 1000 && seconds < cut.endMs / 1000)

  const playBtn = el('button', 'mini-button is-accent', '▶ 재생')
  const prevBtn = el('button', 'mini-button', '◀ 이전')
  const nextBtn = el('button', 'mini-button', '다음 자를 곳 ▶')
  for (const button of [playBtn, prevBtn, nextBtn]) button.type = 'button'

  const skipBox = document.createElement('input')
  skipBox.type = 'checkbox'
  skipBox.checked = skipCuts
  const skipLabel = el('label', 'auto-review-skip')
  skipLabel.append(skipBox, el('span', null, '자를 곳 건너뛰고 보기 (편집 결과 미리보기)'))
  skipBox.addEventListener('change', () => {
    skipCuts = skipBox.checked
  })

  const info = el('span', 'auto-review-sel', '고른 구간: 없음')
  const transport = el('div', 'auto-review-transport')
  transport.append(playBtn, prevBtn, nextBtn, info, skipLabel)

  const timeline = createTimeline({
    totalMs: options.totalMs,
    cuts: options.cuts,
    peaks: options.peaks,
    onSeek: (seconds) => {
      video.currentTime = seconds
    },
    onSelect: (id) => select(id),
    onAdjust: (id, startMs, endMs) => {
      options.onAdjust?.(id, startMs, endMs)
      timeline.refresh()
      paintRows()
    },
  })

  const rows = el('div', 'auto-review-rows')
  const listHead = el('div', 'auto-review-listhead')
  const pickAll = el('button', 'auto-review-pickall', '전부 체크')
  pickAll.type = 'button'
  listHead.append(el('strong', null, '자를 곳'), el('span', 'muted', `${options.cuts.length}곳`), pickAll)
  const list = el('div', 'auto-review-list')
  list.append(listHead, rows)

  pickAll.addEventListener('click', () => {
    const allOn = options.cuts.every((cut) => cut.on)
    for (const cut of options.cuts) options.onToggle?.(cut.id, !allOn)
    timeline.refresh()
    paintRows()
  })

  function select(id) {
    selected = id
    const cut = options.cuts.find((item) => item.id === id)
    if (cut) {
      info.textContent = `고른 구간: ${clock(cut.startMs / 1000)} – ${clock(cut.endMs / 1000)} (${REASON_LABELS[cut.reason] ?? ''})`
      video.currentTime = Math.max(0, cut.startMs / 1000 - 1)
      timeline.focus(cut)
    }
    paintRows()
  }

  function paintRows() {
    rows.replaceChildren()
    for (const cut of options.cuts) {
      const row = el('div', 'auto-review-row')
      if (selected === cut.id) row.classList.add('is-selected')

      const box = document.createElement('input')
      box.type = 'checkbox'
      box.checked = cut.on
      box.addEventListener('change', () => {
        options.onToggle?.(cut.id, box.checked)
        timeline.refresh()
      })

      const body = el('div')
      const top = el('div', 'auto-review-rowtop')
      top.append(
        el('span', 'auto-review-rowtime', `${clock(cut.startMs / 1000)} – ${clock(cut.endMs / 1000)}`),
        el('span', `chip ${CHIP_CLASS[cut.reason] ?? ''}`, REASON_LABELS[cut.reason] ?? cut.reason),
      )
      body.append(top)

      if (cut.keep) {
        // 다시 찍은 부분은 앞뒤를 나란히 보여준다 — 어느 쪽이 남는지 한눈에 보여야 한다.
        const takes = el('div', 'auto-review-takes')
        const before = el('div', 'auto-review-take is-cut')
        before.append(el('b', null, '✕ 앞 것 — 자릅니다'), el('span', null, cut.text || '…'))
        const after = el('div', 'auto-review-take is-keep')
        after.append(el('b', null, '✓ 뒤 것 — 남깁니다'), el('span', null, cut.keep.text || '…'))
        takes.append(before, after)
        body.append(takes)
      } else if (cut.text) {
        body.append(el('p', 'auto-review-rowtext', cut.text))
      }
      body.append(el('p', 'auto-review-rowwhy', `${cut.label ?? ''} · ${((cut.endMs - cut.startMs) / 1000).toFixed(1)}초`))

      row.append(box, body)
      row.addEventListener('click', (event) => {
        if (event.target === box) return
        select(cut.id)
      })
      rows.append(row)
    }
  }

  video.addEventListener('timeupdate', () => {
    const at = video.currentTime
    const inside = cutAt(at)
    if (inside && skipCuts && !video.paused) {
      video.currentTime = inside.endMs / 1000 + 0.02
      return
    }
    time.textContent = clock(at)
    badge.textContent = inside ? `자를 구간 · ${REASON_LABELS[inside.reason] ?? ''}` : '그대로 두는 구간'
    badge.classList.toggle('is-cut', Boolean(inside))
    timeline.setPlayhead(at)
  })

  playBtn.addEventListener('click', () => {
    if (video.paused) {
      video.play().catch(() => {})
      playBtn.textContent = '❚❚ 멈춤'
    } else {
      video.pause()
      playBtn.textContent = '▶ 재생'
    }
  })
  nextBtn.addEventListener('click', () => {
    const next = options.cuts.find((cut) => cut.startMs / 1000 > video.currentTime) ?? options.cuts[0]
    if (next) select(next.id)
  })
  prevBtn.addEventListener('click', () => {
    const before = [...options.cuts].reverse().find((cut) => cut.endMs / 1000 < video.currentTime)
    if (before) select(before.id)
  })

  const left = el('div', 'auto-review-left')
  left.append(stage, transport, timeline.node)
  root.append(left, list)
  paintRows()
  return root
}
