/* global TextDecoder, document, fetch, localStorage */
/**
 * 비서 패널 — 오른쪽에서 열리는 채팅창.
 * 서버(/api/assistant/chat)가 SSE로 흘려주는 이벤트를 화면에 그린다.
 * 앱 조작은 전부 서버 쪽 에이전트가 하고, 여기서는 보여주기와 승인만 담당한다.
 */

const EXAMPLES = [
  '프로젝트 목록 보여줘',
  '"접이식 주방 선반"으로 30초 쇼츠 대본 만들어줘',
  '마지막 프로젝트 검증하고 문제 있으면 알려줘',
]

const TOOL_LABELS = {
  app_health: '앱 상태 확인',
  list_projects: '프로젝트 목록 읽기',
  read_project: '프로젝트 읽기',
  write_project: '프로젝트 저장',
  generate_script: '대본 만들기',
  analyze_coupang: '쿠팡 캡처 분석',
  list_voices: '목소리 목록',
  narrate: '낭독 만들기',
  validate_project: '프로젝트 검증',
  render: '영상 렌더',
  list_jobs: '작업 목록',
  job_status: '작업 상태 확인',
  cancel_job: '작업 취소',
  list_scripts: '대본 보관함 읽기',
  save_script: '대본 저장',
  check_environment: '실행 환경 점검',
  analyze_silence: '무음 구간 분석',
  generate_captions: '자막 만들기(STT)',
  save_captions: '자막 저장',
  list_narrations: '낭독 목록',
  adjust_narration: '낭독 속도·음정 조정',
  source_remix: '소스 짜집기',
  WebSearch: '웹 검색',
  WebFetch: '웹 페이지 읽기',
  ToolSearch: '도구 찾기',
}

const toolLabel = (name) => TOOL_LABELS[name] ?? name

/** 승인 카드에 보여줄 인자 요약 — 전체 YAML 같은 건 접어서 보여준다. */
function describeInput(input) {
  const entries = Object.entries(input ?? {})
  if (entries.length === 0) return ''
  return entries
    .map(([key, value]) => {
      const text = typeof value === 'string' ? value : JSON.stringify(value)
      return `${key}: ${text.length > 120 ? `${text.slice(0, 120)}…` : text}`
    })
    .join('\n')
}

const STORE_KEY = 'shorts-assistant-log-v1'

/** 대화 보관 — 앱을 껐다 켜도 마지막 대화를 이어볼 수 있게 로컬에 남긴다(최근 40개만). */
function loadHistory() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && Array.isArray(parsed.entries) ? parsed : { sessionId: null, entries: [] }
  } catch {
    return { sessionId: null, entries: [] }
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ ...history, entries: history.entries.slice(-40) }))
  } catch {
    /* 저장 공간이 없으면 조용히 포기한다 — 대화 자체는 계속된다 */
  }
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

export function createAssistantPanel() {
  const history = loadHistory()
  let sessionId = history.sessionId
  let streaming = false
  let currentTextNode = null
  const toolNodes = new Map()

  const panel = el('aside', 'assistant-panel')
  panel.hidden = true
  panel.setAttribute('aria-label', '비서')

  const head = el('div', 'assistant-head')
  head.append(el('strong', null, '비서'))
  const status = el('span', 'assistant-status soft-badge', '준비 중')
  const closeBtn = el('button', 'ghost-button assistant-close', '닫기')
  closeBtn.type = 'button'
  head.append(status, closeBtn)

  const log = el('div', 'assistant-log')
  log.setAttribute('aria-live', 'polite')

  const form = el('form', 'assistant-form')
  const input = el('textarea', 'assistant-input')
  input.rows = 2
  input.placeholder = '무엇을 만들까요? (Enter 전송, Shift+Enter 줄바꿈)'
  const sendBtn = el('button', 'primary-button', '보내기')
  sendBtn.type = 'submit'
  const stopBtn = el('button', 'ghost-button', '중단')
  stopBtn.type = 'button'
  stopBtn.hidden = true
  const actions = el('div', 'assistant-form-actions')
  actions.append(sendBtn, stopBtn)
  form.append(input, actions)

  panel.append(head, log, form)

  function scrollToEnd() {
    log.scrollTop = log.scrollHeight
  }

  function addBubble(role, text) {
    const bubble = el('div', `assistant-bubble assistant-${role}`, text ?? '')
    log.append(bubble)
    scrollToEnd()
    return bubble
  }

  /** 화면에 그리면서 보관함에도 남긴다(복원은 말풍선만 — 도구 카드는 지난 실행이라 의미가 없다). */
  function recordBubble(role, text) {
    history.entries.push({ role, text })
    saveHistory({ ...history, sessionId })
  }

  function restoreHistory() {
    if (history.entries.length === 0) return false
    for (const entry of history.entries) addBubble(entry.role, entry.text)
    log.append(el('div', 'assistant-notice', '지난 대화입니다. 이어서 물어보면 그대로 이어집니다.'))
    return true
  }

  function addNotice(text, kind = 'info') {
    const notice = el('div', `assistant-notice assistant-notice-${kind}`, text)
    log.append(notice)
    scrollToEnd()
    return notice
  }

  function showWelcome() {
    const box = el('div', 'assistant-welcome')
    box.append(el('p', null, '앱을 대신 조작하는 비서입니다. 이렇게 시켜보세요.'))
    for (const example of EXAMPLES) {
      const button = el('button', 'assistant-example', example)
      button.type = 'button'
      button.addEventListener('click', () => {
        input.value = example
        input.focus()
      })
      box.append(button)
    }
    log.append(box)
  }

  function startToolCard(event) {
    const card = el('div', 'assistant-tool')
    card.append(el('span', 'assistant-tool-name', toolLabel(event.name)))
    const state = el('span', 'assistant-tool-state', '실행 중…')
    card.append(state)
    log.append(card)
    toolNodes.set(event.id, { card, state })
    currentTextNode = null
    scrollToEnd()
  }

  function endToolCard(event) {
    const node = toolNodes.get(event.id)
    if (!node) return
    node.state.textContent = event.ok ? '완료' : '실패'
    node.card.classList.add(event.ok ? 'is-ok' : 'is-failed')
    if (!event.ok && event.summary) {
      node.card.append(el('p', 'assistant-tool-detail', event.summary))
    }
    toolNodes.delete(event.id)
    scrollToEnd()
  }

  /** 승인 카드 — 사용자가 누를 때까지 에이전트 쪽 도구가 기다린다. */
  function showApproval(event) {
    const card = el('div', 'assistant-approval')
    card.append(el('strong', null, `${toolLabel(event.tool)} 실행할까요?`))
    const detail = describeInput(event.input)
    if (detail) card.append(el('pre', 'assistant-approval-detail', detail))

    const row = el('div', 'assistant-approval-actions')
    const yes = el('button', 'primary-button', '실행')
    const no = el('button', 'ghost-button', '취소')
    yes.type = 'button'
    no.type = 'button'
    const answer = async (approved) => {
      yes.disabled = true
      no.disabled = true
      row.replaceChildren(el('span', 'assistant-tool-state', approved ? '실행함' : '취소함'))
      try {
        await fetch('/api/assistant/approve', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: event.id, approved }),
        })
      } catch (error) {
        addNotice(`승인 전달 실패: ${error.message}`, 'error')
      }
    }
    yes.addEventListener('click', () => answer(true))
    no.addEventListener('click', () => answer(false))
    row.append(yes, no)
    card.append(row)
    log.append(card)
    currentTextNode = null
    scrollToEnd()
  }

  function handleEvent(event) {
    if (event.type === 'session') {
      sessionId = event.sessionId
      return
    }
    if (event.type === 'text') {
      if (!currentTextNode) currentTextNode = addBubble('agent', '')
      currentTextNode.textContent += event.delta
      scrollToEnd()
      return
    }
    if (event.type === 'tool') {
      startToolCard(event)
      return
    }
    if (event.type === 'tool_end') {
      endToolCard(event)
      return
    }
    if (event.type === 'approval') {
      showApproval(event)
      return
    }
    if (event.type === 'error') {
      addNotice(event.message, 'error')
      return
    }
    if (event.type === 'done') {
      const seconds = Math.round((event.durationMs ?? 0) / 1000)
      const cost = Number(event.costUsd ?? 0)
      status.textContent = cost > 0 ? `완료 · ${seconds}초 · $${cost.toFixed(3)}` : `완료 · ${seconds}초`
      if (event.sessionId) sessionId = event.sessionId
      if (currentTextNode?.textContent) recordBubble('agent', currentTextNode.textContent)
    }
  }

  /** SSE는 POST를 못 쓰므로 fetch 스트림을 직접 읽는다. */
  async function readStream(response) {
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const chunks = buffer.split('\n\n')
      buffer = chunks.pop() ?? ''
      for (const chunk of chunks) {
        const line = chunk.trim()
        if (!line.startsWith('data: ')) continue
        try {
          handleEvent(JSON.parse(line.slice(6)))
        } catch {
          /* 잘린 조각은 버린다 */
        }
      }
    }
  }

  async function send(message) {
    if (streaming || !message.trim()) return
    streaming = true
    sendBtn.disabled = true
    stopBtn.hidden = false
    status.textContent = '생각하는 중…'
    currentTextNode = null
    addBubble('user', message)
    recordBubble('user', message)

    try {
      const response = await fetch('/api/assistant/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, sessionId }),
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error ?? `요청 실패(${response.status})`)
      }
      await readStream(response)
    } catch (error) {
      addNotice(`대화 실패: ${error.message}`, 'error')
      status.textContent = '오류'
    } finally {
      streaming = false
      sendBtn.disabled = false
      stopBtn.hidden = true
      for (const [, node] of toolNodes) node.state.textContent = '중단됨'
      toolNodes.clear()
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const message = input.value
    input.value = ''
    send(message)
  })

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      form.requestSubmit()
    }
  })

  stopBtn.addEventListener('click', async () => {
    await fetch('/api/assistant/cancel', { method: 'POST' }).catch(() => {})
    status.textContent = '중단함'
  })

  closeBtn.addEventListener('click', () => {
    panel.hidden = true
    document.body.classList.remove('assistant-open')
  })

  /** CLI 설치·로그인 상태를 먼저 확인해서, 안 되는 이유를 미리 알려준다. */
  async function refreshStatus() {
    try {
      const data = await (await fetch('/api/assistant/status')).json()
      if (!data.installed) {
        status.textContent = '설치 필요'
        addNotice('Claude Code CLI가 없습니다. 터미널에서 npm install -g @anthropic-ai/claude-code 를 실행한 뒤 앱을 다시 켜주세요.', 'error')
        input.disabled = true
        sendBtn.disabled = true
        return
      }
      if (!data.loggedIn) {
        status.textContent = '로그인 필요'
        addNotice('Claude Code에 로그인되어 있지 않습니다. 터미널에서 claude 를 실행해 로그인한 뒤 다시 시도하세요.', 'error')
        return
      }
      // 상태 확인은 비동기라 늦게 끝난다 — 그 사이 대화가 진행됐으면 덮어쓰지 않는다.
      if (status.textContent === '준비 중') status.textContent = '준비됨'
    } catch {
      if (status.textContent === '준비 중') status.textContent = '연결 실패'
    }
  }

  let initialized = false
  function open() {
    panel.hidden = false
    document.body.classList.add('assistant-open')
    if (!initialized) {
      initialized = true
      if (!restoreHistory()) showWelcome()
      refreshStatus()
    }
    input.focus()
  }

  function toggle() {
    if (panel.hidden) open()
    else {
      panel.hidden = true
      document.body.classList.remove('assistant-open')
    }
  }

  return { panel, open, toggle, handleEvent, send }
}

/** 앱 시작 시 한 번 호출 — 패널을 붙이고 상단 버튼을 연결한다. */
export function mountAssistant({ root = document.body, trigger = null } = {}) {
  const assistant = createAssistantPanel()
  root.append(assistant.panel)
  if (trigger) trigger.addEventListener('click', () => assistant.toggle())
  return assistant
}
