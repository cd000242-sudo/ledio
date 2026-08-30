/* global document, fetch */
/**
 * 자동 편집 탭 — 넣어두면 알아서 다듬는다.
 *
 * 흐름: 파일 넣기 → 분석(받아쓰기 + 자를 후보) → **사람이 확인** → 자르기.
 * 자동으로 자르지 않는 것이 핵심이다. 무엇을 왜 자르는지 보여주고 체크된 것만 실행한다.
 * 상태는 모듈 수준에 둔다 — 탭을 옮겨도 분석 결과가 날아가면 안 된다(몇 분씩 걸리는 작업).
 */

import { ownsTab } from './tab-owner.js'

const REASON_LABELS = {
  silence: '무음',
  filler: '군더더기',
  duplicate: '중복',
  stumble: '말 끊김',
}

const STRENGTHS = [
  { value: 'light', label: '약하게 (확실한 것만)' },
  { value: 'normal', label: '보통 (권장)' },
  { value: 'strong', label: '세게 (많이 다듬기)' },
]

const state = {
  mediaPath: '',
  mediaName: '',
  strength: 'normal',
  busy: false,
  phase: 'idle',
  status: '',
  analysis: null,
  checked: new Set(),
  result: null,
  error: '',
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const fileNameOf = (path) => String(path).split(/[/\\]/).pop() || path
const seconds = (ms) => `${Math.floor(ms / 1000 / 60)}분 ${Math.round((ms / 1000) % 60)}초`

let repaint = () => {}

async function analyze(deps) {
  if (state.busy || !state.mediaPath) return
  state.busy = true
  state.phase = 'analyzing'
  state.error = ''
  state.result = null
  state.status = '받아쓰고 자를 곳을 고르는 중… 영상 길이의 1/5쯤 걸립니다.'
  repaint()

  try {
    const response = await fetch('/api/auto-edit/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mediaPath: state.mediaPath, strength: state.strength }),
    })
    const data = await response.json()
    if (!data.ok) throw new Error(data.error ?? '분석에 실패했습니다.')
    state.analysis = data
    // 확실한 것만 미리 체크해 둔다(중복은 오판이 있을 수 있어 빼둔다).
    state.checked = new Set(data.candidates.filter((item) => item.suggested).map((item) => item.id))
    state.phase = 'review'
    state.status = `자를 후보 ${data.candidates.length}곳을 찾았습니다. 확인하고 넘기세요.`
  } catch (error) {
    state.error = error.message
    state.phase = 'idle'
    state.status = ''
  } finally {
    state.busy = false
    repaint()
  }
}

async function applyCuts() {
  if (state.busy || !state.analysis) return
  const selected = state.analysis.candidates.filter((item) => state.checked.has(item.id))
  if (selected.length === 0) {
    state.error = '자를 구간을 하나도 고르지 않았습니다.'
    repaint()
    return
  }

  state.busy = true
  state.error = ''
  state.status = '자르고 이어 붙이는 중…'
  repaint()

  try {
    const response = await fetch('/api/auto-edit/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mediaPath: state.mediaPath,
        totalMs: state.analysis.totalMs,
        selected: selected.map((item) => ({ startMs: item.startMs, endMs: item.endMs })),
      }),
    })
    const data = await response.json()
    if (!data.ok) throw new Error(data.error ?? '컷 적용에 실패했습니다.')
    state.result = data
    state.phase = 'done'
    state.status = `완성됐습니다 — ${seconds(data.removedMs)} 잘라냈습니다.`
  } catch (error) {
    state.error = error.message
    state.status = '실패'
  } finally {
    state.busy = false
    repaint()
  }
}

function buildCandidateRow(item) {
  const row = el('label', `auto-cut${state.checked.has(item.id) ? ' is-on' : ''}`)
  const box = el('input')
  box.type = 'checkbox'
  box.checked = state.checked.has(item.id)
  box.addEventListener('change', () => {
    if (box.checked) state.checked.add(item.id)
    else state.checked.delete(item.id)
    repaint()
  })
  row.append(
    box,
    el('span', 'auto-cut-time', item.time),
    el('span', 'auto-cut-text', item.text || '(말 없음)'),
    el('span', `auto-cut-why reason-${item.reason}`, item.label || REASON_LABELS[item.reason] || ''),
  )
  return row
}

function buildTab(deps) {
  const root = el('div', 'auto-tab')
  root.append(
    el('p', 'longform-intro', '영상을 넣으면 말 없는 구간·군더더기·같은 말 반복을 찾아 줍니다. 자를지는 확인하고 정하세요.'),
  )

  // 파일 넣기
  const drop = el('div', 'longform-drop')
  if (state.mediaPath) drop.classList.add('is-set')
  drop.append(
    el('strong', null, state.mediaPath ? state.mediaName : '영상을 여기에 끌어다 놓으세요'),
    el('span', 'longform-path', state.mediaPath || '또는 클릭해서 고르기'),
  )
  const setMedia = (path) => {
    if (!path) return
    state.mediaPath = path
    state.mediaName = fileNameOf(path)
    state.analysis = null
    state.phase = 'idle'
    repaint()
  }
  drop.addEventListener('click', async () => setMedia(await deps.pickMedia?.()))
  drop.addEventListener('dragover', (event) => {
    event.preventDefault()
    drop.classList.add('is-over')
  })
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'))
  drop.addEventListener('drop', (event) => {
    event.preventDefault()
    const file = event.dataTransfer?.files?.[0]
    setMedia(deps.pathOf?.(file) ?? file?.path)
  })
  root.append(drop)

  // 강도 + 실행
  const strength = el('select', 'auto-strength')
  for (const option of STRENGTHS) {
    const node = el('option', null, option.label)
    node.value = option.value
    strength.append(node)
  }
  strength.value = state.strength
  strength.addEventListener('change', () => {
    state.strength = strength.value
  })

  const analyzeBtn = el('button', 'primary-button', state.busy && state.phase === 'analyzing' ? '분석 중…' : '자를 곳 찾기')
  analyzeBtn.type = 'button'
  analyzeBtn.disabled = state.busy || !state.mediaPath
  analyzeBtn.addEventListener('click', () => analyze(deps))

  const controls = el('div', 'auto-controls')
  const label = el('label', 'longform-field')
  label.append(el('span', null, '다듬기 강도'), strength)
  controls.append(label, analyzeBtn)
  root.append(controls)

  if (state.status) root.append(el('p', 'longform-status', state.status))
  if (state.error) root.append(el('p', 'longform-error', state.error))

  // 후보 목록
  if (state.analysis) {
    const summary = el('div', 'auto-summary')
    const picked = state.analysis.candidates.filter((item) => state.checked.has(item.id))
    const pickedMs = picked.reduce((sum, item) => sum + (item.endMs - item.startMs), 0)
    summary.append(
      el('strong', null, `자를 후보 ${state.analysis.candidates.length}곳`),
      el('span', 'muted', `고른 것 ${picked.length}곳 · ${seconds(pickedMs)} 단축 예정`),
      el('span', 'muted', `${seconds(state.analysis.totalMs)} → ${seconds(state.analysis.totalMs - pickedMs)}`),
    )
    root.append(summary)

    const list = el('div', 'auto-cutlist')
    for (const item of state.analysis.candidates) list.append(buildCandidateRow(item))
    root.append(list)

    const applyBtn = el('button', 'primary-button', state.busy ? '자르는 중…' : '고른 대로 자르기')
    applyBtn.type = 'button'
    applyBtn.disabled = state.busy
    applyBtn.addEventListener('click', () => applyCuts())
    root.append(applyBtn)
  }

  if (state.result?.outPath) {
    const done = el('div', 'longform-result')
    done.append(el('h3', null, '편집본이 만들어졌습니다'))
    done.append(el('p', null, state.result.outPath))
    done.append(
      el('p', 'longform-stats', `${state.result.pieces}조각을 이어 붙였습니다 · ${seconds(state.result.removedMs)} 잘라냄`),
    )
    root.append(done)
  }

  return root
}

export function renderAutoEditTab(container, deps = {}) {
  const paint = () => {
    // 다른 탭으로 넘어갔으면 그리지 않는다. 탭들이 같은 자리를 쓰기 때문에,
    // 늦게 돌아온 응답이 남의 화면을 덮어쓴다(실측으로 확인한 사고).
    if (!ownsTab(container, 'autoedit')) return
    container.replaceChildren(buildTab(deps))
  }
  repaint = paint
  paint()
  return { state }
}
