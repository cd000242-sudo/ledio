/* global document, fetch */
/**
 * 롱폼 자막 탭 — 영상/음성 하나를 넣으면 자막 두 개와 대본, 자막 넣은 완성 영상까지 만든다.
 * 순서: 세밀 STT(WhisperX) → 대본 대조 보정(선택) → 롱폼 재편성 → 공백 메움 → 검수 → 영상에 넣기.
 *
 * 상태는 **모듈 수준**에 둔다. 탭을 옮기면 화면을 새로 그리는데,
 * 상태가 화면 안에 있으면 고른 파일·진행 상황·결과가 통째로 날아간다(실제로 겪은 사고).
 * 작업은 몇 분씩 걸리므로 탭을 옮겼다 와도 이어서 보여야 한다.
 */

const STEPS = [
  { id: 'stt', label: '받아쓰기' },
  { id: 'correct', label: '대본 대조 보정' },
  { id: 'format', label: '자막 정리' },
  { id: 'audit', label: '검수' },
  { id: 'burn', label: '영상에 넣기' },
]

const MODEL_OPTIONS = [
  { value: 'large-v3', label: '정확도 우선 (large-v3)' },
  { value: 'large-v3-turbo', label: '속도 우선 (turbo)' },
]

const ENGINE_OPTIONS = [
  { value: '', label: '환경설정 기본 엔진' },
  { value: 'agent-claude', label: '클로드코드 (구독)' },
  { value: 'agent-codex', label: 'Codex (구독)' },
  { value: 'api-claude', label: 'Claude API 키' },
  { value: 'api-gpt', label: 'GPT API 키' },
  { value: 'api-gemini', label: 'Gemini API 키' },
]

const BURN_OPTIONS = [
  { value: 'burn', label: '영상에 자막 태워넣기 (어디서나 보임 · 재인코딩)' },
  { value: 'mux', label: '자막 트랙으로 넣기 (빠름 · 켜야 보임)' },
  { value: 'none', label: '넣지 않기 (SRT 파일만)' },
]

/** 탭을 옮겨도 살아남는 상태. 실행 중인 작업도 여기에 매달아 둔다. */
const state = {
  mediaPath: '',
  mediaName: '',
  scriptText: '',
  model: 'large-v3',
  engine: '',
  language: 'ko',
  minChars: 18,
  maxChars: 44,
  burn: 'burn',
  makeScript: true,
  polishScript: false,
  busy: false,
  activeStep: null,
  finished: false,
  status: '',
  result: null,
  notes: [],
  startedAt: 0,
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

function field(labelText, control) {
  const label = el('label', 'longform-field')
  label.append(el('span', null, labelText), control)
  return label
}

function select(className, options, value) {
  const node = el('select', className)
  for (const option of options) {
    const item = el('option', null, option.label)
    item.value = option.value
    node.append(item)
  }
  node.value = value
  return node
}

function fileNameOf(path) {
  const parts = String(path).split(/[/\\]/)
  return parts[parts.length - 1] || path
}

/** 화면을 다시 그려야 할 때 부르는 콜백 — 현재 붙어 있는 탭이 등록한다. */
let repaint = () => {}

function setStatus(text) {
  state.status = text
  repaint()
}

function markStep(id) {
  state.activeStep = id
  repaint()
}

function addNote(text) {
  if (!state.notes.includes(text)) state.notes.push(text)
  repaint()
}

/**
 * 실제 작업 — 화면과 분리해 둔다. 탭을 옮겨도 계속 돌고, 끝나면 상태에 결과가 남는다.
 */
async function runCaptions(deps) {
  if (state.busy || !state.mediaPath) return
  state.busy = true
  state.finished = false
  state.result = null
  state.notes = []
  state.startedAt = Date.now()
  markStep('stt')
  setStatus('받아쓰는 중… 영상 길이의 1/5쯤 걸립니다(16분 영상이면 3분 남짓).')

  // 기본 엔진은 클로드코드(구독) — API 키가 필요한 엔진을 고른 경우에만 키를 싣는다.
  const method = state.engine || 'agent-claude'
  const apiKey = method.startsWith('api-') ? (deps.apiKeyFor?.(method) ?? '') : ''

  // 서버가 단계별 신호를 주지 않으므로 시간으로 어림잡아 표시한다.
  const stepTimer = deps.setTimer?.(() => markStep(state.scriptText.trim() ? 'correct' : 'format'), 60000)
  const burnTimer = state.burn === 'burn' ? deps.setTimer?.(() => markStep('burn'), 180000) : null

  try {
    const response = await fetch('/api/longform-captions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mediaPath: state.mediaPath,
        script: state.scriptText,
        method,
        apiKey,
        model: state.model,
        burn: state.burn,
        makeScript: state.makeScript,
        polishScript: state.polishScript,
        language: state.language.trim() || 'ko',
        minChars: state.minChars,
        maxChars: state.maxChars,
      }),
    })
    const data = await response.json()
    state.result = data
    if (data.ok) {
      state.finished = true
      state.activeStep = null
      const seconds = Math.round((Date.now() - state.startedAt) / 1000)
      setStatus(`완료 · ${Math.floor(seconds / 60)}분 ${seconds % 60}초 걸렸습니다`)
    } else {
      setStatus('실패')
    }
  } catch (error) {
    state.result = { ok: false, error: `요청 실패: ${error.message}` }
    setStatus('실패')
  } finally {
    deps.clearTimer?.(stepTimer)
    if (burnTimer) deps.clearTimer?.(burnTimer)
    state.busy = false
    repaint()
  }
}

/**
 * @param {object} deps 앱 셸이 넘겨주는 것들
 *  - pickMedia() / pickScript(): 파일 선택 다이얼로그
 *  - apiKeyFor(method): 엔진별 API 키
 *  - setTimer/clearTimer: 진행 표시용 타이머
 */
export function renderLongformCaptionsTab(container, deps = {}) {
  const paint = () => {
    // 탭이 이미 다른 화면으로 바뀌었으면 그리지 않는다(떨어져 나간 DOM에 그리는 낭비 방지).
    if (!container.isConnected) return
    container.replaceChildren(buildTab(deps))
  }
  repaint = paint
  paint()
  return { state }
}

function buildTab(deps) {
  const root = el('div', 'longform-tab')
  root.append(
    el(
      'p',
      'longform-intro',
      '영상 하나만 넣으면 끝납니다 — 받아쓰기부터 자막 파일, 대본, 자막 넣은 완성 영상까지 한 번에 만듭니다.',
    ),
  )

  // ── 입력 파일: 클릭 또는 드래그&드롭 ──
  const drop = el('div', 'longform-drop')
  if (state.mediaPath) drop.classList.add('is-set')
  drop.append(
    el('strong', null, state.mediaPath ? state.mediaName : '영상 또는 음성 파일을 여기에 끌어다 놓으세요'),
    el('span', 'longform-path', state.mediaPath || '또는 클릭해서 고르기 · mp4 mov mkv mp3 wav m4a'),
  )

  const setMedia = (path) => {
    if (!path) return
    state.mediaPath = path
    state.mediaName = fileNameOf(path)
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
    const path = deps.pathOf?.(file) ?? file?.path
    if (path) setMedia(path)
    else addNote('이 파일의 경로를 읽지 못했습니다. 클릭해서 골라주세요.')
  })
  root.append(drop)

  // ── 대본(선택) ──
  const scriptArea = el('textarea', 'longform-script')
  scriptArea.rows = 5
  scriptArea.placeholder =
    '대본이 있으면 붙여넣으세요 — 고유명사·숫자·영어를 정확히 받아씁니다. 없으면 비워두면 음성으로 대본을 만들어 드립니다.'
  scriptArea.value = state.scriptText
  scriptArea.addEventListener('input', () => {
    state.scriptText = scriptArea.value
  })
  const scriptBtn = el('button', 'ghost-button longform-inline-btn', '대본 파일 불러오기')
  scriptBtn.type = 'button'
  scriptBtn.addEventListener('click', async () => {
    const picked = await deps.pickScript?.()
    if (!picked?.text) return
    state.scriptText = picked.text
    repaint()
  })
  const scriptField = field('대본 (선택)', scriptArea)
  scriptField.append(scriptBtn)
  root.append(scriptField)

  // ── 대본 만들기 옵션 ──
  const makeScript = el('input')
  makeScript.type = 'checkbox'
  makeScript.checked = state.makeScript
  makeScript.addEventListener('change', () => {
    state.makeScript = makeScript.checked
  })
  const polishScript = el('input')
  polishScript.type = 'checkbox'
  polishScript.checked = state.polishScript
  polishScript.addEventListener('change', () => {
    state.polishScript = polishScript.checked
  })
  const makeLabel = el('label', 'longform-check')
  makeLabel.append(makeScript, el('span', null, '음성으로 대본 파일도 만들기'))
  const polishLabel = el('label', 'longform-check')
  polishLabel.append(polishScript, el('span', null, 'AI로 대본 다듬기 (군더더기·오타 정리)'))
  const checks = el('div', 'longform-checks')
  checks.append(makeLabel, polishLabel)

  const burnSelect = select('longform-burn', BURN_OPTIONS, state.burn)
  burnSelect.addEventListener('change', () => {
    state.burn = burnSelect.value
  })
  root.append(checks, field('완성 영상', burnSelect))

  // ── 세부 설정 ──
  const modelSelect = select('longform-model', MODEL_OPTIONS, state.model)
  modelSelect.addEventListener('change', () => {
    state.model = modelSelect.value
  })
  const engineSelect = select('longform-engine', ENGINE_OPTIONS, state.engine)
  engineSelect.addEventListener('change', () => {
    state.engine = engineSelect.value
  })
  const langInput = el('input', 'longform-lang')
  langInput.value = state.language
  langInput.addEventListener('input', () => {
    state.language = langInput.value
  })
  const minInput = el('input', 'longform-num')
  minInput.type = 'number'
  minInput.value = String(state.minChars)
  minInput.addEventListener('input', () => {
    state.minChars = Number(minInput.value) || 18
  })
  const maxInput = el('input', 'longform-num')
  maxInput.type = 'number'
  maxInput.value = String(state.maxChars)
  maxInput.addEventListener('input', () => {
    state.maxChars = Number(maxInput.value) || 44
  })

  const advanced = el('details', 'longform-advanced')
  const summary = document.createElement('summary')
  summary.textContent = '세부 설정'
  const optionGrid = el('div', 'longform-options')
  optionGrid.append(
    field('받아쓰기 모델', modelSelect),
    field('보정 엔진', engineSelect),
    field('언어', langInput),
    field('최소 글자', minInput),
    field('최대 글자', maxInput),
  )
  advanced.append(summary, optionGrid)
  root.append(advanced)

  // ── 실행 ──
  const runBtn = el('button', 'primary-button longform-run', state.busy ? '만드는 중…' : '자막 만들기')
  runBtn.type = 'button'
  runBtn.disabled = state.busy || !state.mediaPath
  runBtn.addEventListener('click', () => runCaptions(deps))
  root.append(runBtn)

  // ── 진행 단계 ──
  const steps = el('ol', 'longform-steps')
  steps.hidden = !state.busy && !state.finished && !state.result
  let reachedActive = false
  for (const step of STEPS) {
    const node = el('li', 'longform-step', step.label)
    if (state.finished) node.classList.add('is-done')
    else if (step.id === state.activeStep) {
      node.classList.add('is-active')
      reachedActive = true
    } else if (!reachedActive && state.activeStep) node.classList.add('is-done')
    steps.append(node)
  }
  root.append(steps)

  if (state.status) root.append(el('p', 'longform-status', state.status))
  const notes = el('div', 'longform-notes')
  for (const note of state.notes) notes.append(el('p', 'longform-note', note))
  root.append(notes)

  if (state.result) root.append(buildResult(state.result))
  return root
}

function buildResult(data) {
  const result = el('div', 'longform-result')
  if (!data.ok) {
    result.append(el('p', 'longform-error', data.error ?? '알 수 없는 오류'))
    return result
  }

  result.append(el('h3', null, '완성됐습니다'))
  const files = el('ul', 'longform-files')
  const rows = [
    ['정렬 자막', data.files.aligned],
    ['공백메움 자막', data.files.filled],
  ]
  if (data.scriptFile) rows.push([data.scriptFile.polished ? '대본 (AI 다듬음)' : '대본', data.scriptFile.path])
  if (data.burned?.path) rows.push([data.burned.mode === 'mux' ? '자막 트랙 영상' : '자막 넣은 영상', data.burned.path])
  for (const [label, path] of rows) files.append(el('li', null, `${label}: ${path}`))
  result.append(files)

  const stats = [`받아쓴 단어 ${data.sttCueCount}개 → 자막 ${data.cueCount}줄`]
  if (data.correction) {
    const failed = data.correction.failedBatches
    stats.push(
      failed > 0
        ? `대본 보정 ${data.correction.batches}묶음 중 ${failed}묶음 실패(그 구간은 원본 유지)`
        : `대본 보정 ${data.correction.batches}묶음 완료`,
    )
  } else {
    stats.push('대본이 없어 보정은 건너뛰었습니다')
  }
  result.append(el('p', 'longform-stats', stats.join(' · ')))
  if (data.burned?.error) result.append(el('p', 'longform-error', `자막 넣기 실패: ${data.burned.error}`))

  const audit = el('div', 'longform-audit')
  audit.append(el('h4', null, '검수 결과'))
  audit.append(el('p', null, `정렬본 — ${data.audit.aligned.summary}`))
  audit.append(el('p', null, `공백메움본 — ${data.audit.filled.summary}`))
  result.append(audit)
  return result
}
