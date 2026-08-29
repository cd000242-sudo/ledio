/* global document, fetch */
/**
 * 롱폼 자막 탭 — 영상/음성 하나를 넣으면 정렬 SRT와 공백메움 SRT를 만든다.
 * 순서: 세밀 STT(WhisperX) → 대본 대조 보정(선택) → 롱폼 재편성 → 공백 메움 → 검수.
 */

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

  // ── 입력 파일 ──
  const mediaRow = el('div', 'longform-row')
  const mediaLabel = el('span', 'longform-path', '선택된 파일 없음')
  const mediaBtn = el('button', 'primary-button', '영상·음성 선택')
  mediaBtn.type = 'button'
  mediaBtn.addEventListener('click', async () => {
    const path = await deps.pickMedia?.()
    if (!path) return
    state.mediaPath = path
    mediaLabel.textContent = path
    updateRunnable()
  })
  mediaRow.append(mediaBtn, mediaLabel)
  root.append(mediaRow)

  // ── 대본(선택) ──
  const scriptArea = el('textarea', 'longform-script')
  scriptArea.rows = 6
  scriptArea.placeholder = '대본을 붙여넣으세요. 없으면 비워두셔도 됩니다(보정 단계만 건너뜁니다).'
  scriptArea.addEventListener('input', () => {
    state.scriptText = scriptArea.value
  })
  const scriptBtn = el('button', 'ghost-button', '대본 파일 불러오기')
  scriptBtn.type = 'button'
  scriptBtn.addEventListener('click', async () => {
    const picked = await deps.pickScript?.()
    if (!picked?.text) return
    scriptArea.value = picked.text
    state.scriptText = picked.text
  })
  root.append(field('대본 (선택)', scriptArea), scriptBtn)

  // ── 옵션 ──
  const engineSelect = el('select', 'longform-engine')
  for (const option of ENGINE_OPTIONS) {
    const node = el('option', null, option.label)
    node.value = option.value
    engineSelect.append(node)
  }
  const langInput = el('input', 'longform-lang')
  langInput.value = 'ko'
  langInput.size = 6
  const minInput = el('input', 'longform-num')
  minInput.type = 'number'
  minInput.value = '18'
  const maxInput = el('input', 'longform-num')
  maxInput.type = 'number'
  maxInput.value = '44'

  const options = el('div', 'longform-options')
  options.append(
    field('보정 엔진', engineSelect),
    field('언어', langInput),
    field('최소 글자', minInput),
    field('최대 글자', maxInput),
  )
  root.append(options)

  // ── 실행 ──
  const runBtn = el('button', 'primary-button', '자막 만들기')
  runBtn.type = 'button'
  runBtn.disabled = true
  const status = el('p', 'longform-status', '')
  const result = el('div', 'longform-result')
  root.append(runBtn, status, result)

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
    for (const [label, path] of [
      ['정렬 자막', data.files.aligned],
      ['공백메움 자막', data.files.filled],
    ]) {
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
    status.textContent = '받아쓰는 중… 영상 길이에 따라 몇 분 걸립니다.'
    // 기본 엔진은 클로드코드(구독) — API 키가 필요한 엔진을 고른 경우에만 키를 싣는다.
    const method = engineSelect.value || 'agent-claude'
    const apiKey = method.startsWith('api-') ? (deps.apiKeyFor?.(method) ?? '') : ''
    try {
      const response = await fetch('/api/longform-captions', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          mediaPath: state.mediaPath,
          script: state.scriptText,
          method,
          apiKey,
          language: langInput.value.trim() || 'ko',
          minChars: Number(minInput.value) || 18,
          maxChars: Number(maxInput.value) || 44,
        }),
      })
      const data = await response.json()
      renderResult(data)
      status.textContent = data.ok ? '완료' : '실패'
    } catch (error) {
      renderResult({ ok: false, error: `요청 실패: ${error.message}` })
      status.textContent = '실패'
    } finally {
      state.busy = false
      updateRunnable()
    }
  })

  container.append(root)
  return { root, state }
}
