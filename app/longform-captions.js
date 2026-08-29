/* global document, fetch */
/**
 * 롱폼 자막 탭 — 영상/음성 하나를 넣으면 정렬 SRT와 공백메움 SRT를 만든다.
 * 순서: 세밀 STT(WhisperX) → 대본 대조 보정(선택) → 롱폼 재편성 → 공백 메움 → 검수.
 */

const STEPS = [
  { id: 'stt', label: '받아쓰기' },
  { id: 'correct', label: '대본 대조 보정' },
  { id: 'format', label: '자막 정리' },
  { id: 'audit', label: '검수' },
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

/**
 * @param {object} deps 앱 셸이 넘겨주는 것들
 *  - pickMedia(): 파일 선택 다이얼로그 → 절대 경로
 *  - pickScript(): 대본 파일 선택 → { path, text }
 *  - getSettings(): 환경설정(기본 엔진·API 키)
 */
export function renderLongformCaptionsTab(container, deps = {}) {
  const state = { mediaPath: '', scriptText: '', busy: false }

  container.replaceChildren()
  const root = el('div', 'longform-tab')

  root.append(
    el('p', 'longform-intro', '컷 편집이 끝난 영상이나 음성을 넣으면 롱폼용 자막 두 개를 만듭니다. 대본을 함께 주면 오타·고유명사·숫자를 문맥에 맞게 고칩니다.'),
  )

  // ── 입력 파일: 클릭 또는 드래그&드롭 ──
  const drop = el('div', 'longform-drop')
  const dropTitle = el('strong', null, '영상 또는 음성 파일을 여기에 끌어다 놓으세요')
  const dropHint = el('span', 'longform-path', '또는 클릭해서 고르기 · mp4 mov mkv mp3 wav m4a')
  drop.append(dropTitle, dropHint)

  function setMedia(path) {
    if (!path) return
    state.mediaPath = path
    dropTitle.textContent = path.split(/[/\\]/).pop()
    dropHint.textContent = path
    drop.classList.add('is-set')
    updateRunnable()
  }

  drop.addEventListener('click', async () => setMedia(await deps.pickMedia?.()))
  drop.addEventListener('dragover', (event) => {
    event.preventDefault()
    drop.classList.add('is-over')
  })
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'))
  drop.addEventListener('drop', (event) => {
    event.preventDefault()
    drop.classList.remove('is-over')
    // Electron에서는 끌어온 파일의 실제 경로를 그대로 쓸 수 있다.
    const file = event.dataTransfer?.files?.[0]
    const path = deps.pathOf?.(file) ?? file?.path
    if (path) setMedia(path)
    else addNoteOnce('이 파일의 경로를 읽지 못했습니다. 클릭해서 골라주세요.')
  })
  root.append(drop)

  // ── 대본(선택) ──
  const scriptArea = el('textarea', 'longform-script')
  scriptArea.rows = 5
  scriptArea.placeholder = '대본이 있으면 붙여넣으세요 — 고유명사·숫자·영어를 정확히 받아씁니다. 없으면 비워두면 음성으로 대본을 만들어 드립니다.'
  scriptArea.addEventListener('input', () => {
    state.scriptText = scriptArea.value
  })
  const scriptBtn = el('button', 'ghost-button longform-inline-btn', '대본 파일 불러오기')
  scriptBtn.type = 'button'
  scriptBtn.addEventListener('click', async () => {
    const picked = await deps.pickScript?.()
    if (!picked?.text) return
    scriptArea.value = picked.text
    state.scriptText = picked.text
  })
  const scriptField = field('대본 (선택)', scriptArea)
  scriptField.append(scriptBtn)
  root.append(scriptField)

  // 대본이 없으면 음성에서 만들어 준다 — 이 체크가 그 스위치다.
  const makeScript = el('input')
  makeScript.type = 'checkbox'
  makeScript.checked = true
  const polishScript = el('input')
  polishScript.type = 'checkbox'
  const makeLabel = el('label', 'longform-check')
  makeLabel.append(makeScript, el('span', null, '음성으로 대본 파일도 만들기'))
  const polishLabel = el('label', 'longform-check')
  polishLabel.append(polishScript, el('span', null, 'AI로 대본 다듬기 (군더더기·오타 정리)'))
  const checks = el('div', 'longform-checks')
  checks.append(makeLabel, polishLabel)
  root.append(checks)

  // ── 옵션 ──
  const modelSelect = el('select', 'longform-model')
  for (const option of MODEL_OPTIONS) {
    const node = el('option', null, option.label)
    node.value = option.value
    modelSelect.append(node)
  }
  const engineSelect = el('select', 'longform-engine')
  for (const option of ENGINE_OPTIONS) {
    const node = el('option', null, option.label)
    node.value = option.value
    engineSelect.append(node)
  }
  const langInput = el('input', 'longform-lang')
  langInput.value = 'ko'
  const minInput = el('input', 'longform-num')
  minInput.type = 'number'
  minInput.value = '18'
  const maxInput = el('input', 'longform-num')
  maxInput.type = 'number'
  maxInput.value = '44'

  const options = el('details', 'longform-advanced')
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
  options.append(summary, optionGrid)
  root.append(options)

  // ── 실행 ──
  const runBtn = el('button', 'primary-button longform-run', '자막 만들기')
  runBtn.type = 'button'
  runBtn.disabled = true

  const steps = el('ol', 'longform-steps')
  const stepNodes = new Map()
  for (const step of STEPS) {
    const node = el('li', 'longform-step', step.label)
    steps.append(node)
    stepNodes.set(step.id, node)
  }
  steps.hidden = true

  const status = el('p', 'longform-status', '')
  const result = el('div', 'longform-result')
  const notes = el('div', 'longform-notes')
  root.append(runBtn, steps, status, notes, result)

  function addNoteOnce(text) {
    if (notes.textContent.includes(text)) return
    notes.append(el('p', 'longform-note', text))
  }

  /** 단계 표시 — 지난 단계는 완료, 현재 단계는 진행 중으로 칠한다. */
  function markStep(current) {
    steps.hidden = false
    let passed = true
    for (const step of STEPS) {
      const node = stepNodes.get(step.id)
      node.classList.remove('is-active', 'is-done')
      if (step.id === current) {
        node.classList.add('is-active')
        passed = false
      } else if (passed) {
        node.classList.add('is-done')
      }
    }
  }

  function finishSteps() {
    steps.hidden = false
    for (const node of stepNodes.values()) {
      node.classList.remove('is-active')
      node.classList.add('is-done')
    }
  }

  function updateRunnable() {
    runBtn.disabled = state.busy || !state.mediaPath
  }

  function renderResult(data) {
    result.replaceChildren()
    if (!data.ok) {
      result.append(el('p', 'longform-error', data.error ?? '알 수 없는 오류'))
      return
    }
    result.append(el('h3', null, '완성됐습니다'))
    const files = el('ul', 'longform-files')
    const rows = [
      ['정렬 자막', data.files.aligned],
      ['공백메움 자막', data.files.filled],
    ]
    if (data.scriptFile) rows.push([data.scriptFile.polished ? '대본 (AI 다듬음)' : '대본', data.scriptFile.path])
    for (const [label, path] of rows) {
      files.append(el('li', null, `${label}: ${path}`))
    }
    result.append(files)

    const stats = [`받아쓴 단어 ${data.sttCueCount}개 → 자막 ${data.cueCount}줄`]
    if (data.correction) {
      const failed = data.correction.failedBatches
      stats.push(failed > 0 ? `대본 보정 ${data.correction.batches}묶음 중 ${failed}묶음 실패(그 구간은 원본 유지)` : `대본 보정 ${data.correction.batches}묶음 완료`)
    } else {
      stats.push('대본이 없어 보정은 건너뛰었습니다')
    }
    result.append(el('p', 'longform-stats', stats.join(' · ')))

    const audit = el('div', 'longform-audit')
    audit.append(el('h4', null, '검수 결과'))
    audit.append(el('p', null, `정렬본 — ${data.audit.aligned.summary}`))
    audit.append(el('p', null, `공백메움본 — ${data.audit.filled.summary}`))
    result.append(audit)
  }

  runBtn.addEventListener('click', async () => {
    if (!state.mediaPath) return
    state.busy = true
    updateRunnable()
    result.replaceChildren()
    notes.replaceChildren()
    markStep('stt')
    // 실측: 16분 오디오 → 3분 19초. 대략 영상 길이의 1/5.
    status.textContent = '받아쓰는 중… 영상 길이의 1/5쯤 걸립니다(16분 영상이면 3분 남짓).'

    // 기본 엔진은 클로드코드(구독) — API 키가 필요한 엔진을 고른 경우에만 키를 싣는다.
    const method = engineSelect.value || 'agent-claude'
    const apiKey = method.startsWith('api-') ? (deps.apiKeyFor?.(method) ?? '') : ''
    const startedAt = Date.now()

    // 받아쓰기가 끝나는 시점을 알 수 없으므로, 대본이 있으면 보정 단계로 넘어간 것처럼 표시한다.
    const stepTimer = deps.setTimer?.(() => markStep(state.scriptText.trim() ? 'correct' : 'format'), 60000)

    try {
      const response = await fetch('/api/longform-captions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mediaPath: state.mediaPath,
          script: state.scriptText,
          method,
          apiKey,
          model: modelSelect.value,
          makeScript: makeScript.checked,
          polishScript: polishScript.checked,
          language: langInput.value.trim() || 'ko',
          minChars: Number(minInput.value) || 18,
          maxChars: Number(maxInput.value) || 44,
        }),
      })
      const data = await response.json()
      renderResult(data)
      if (data.ok) {
        finishSteps()
        const seconds = Math.round((Date.now() - startedAt) / 1000)
        status.textContent = `완료 · ${Math.floor(seconds / 60)}분 ${seconds % 60}초 걸렸습니다`
      } else {
        status.textContent = '실패'
      }
    } catch (error) {
      renderResult({ ok: false, error: `요청 실패: ${error.message}` })
      status.textContent = '실패'
    } finally {
      deps.clearTimer?.(stepTimer)
      state.busy = false
      updateRunnable()
    }
  })

  container.append(root)
  return { root, state }
}
