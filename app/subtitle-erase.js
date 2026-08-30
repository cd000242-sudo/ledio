/* global document, fetch */
/**
 * 자막 지우기 탭 — 영상에 박힌 자막을 배경으로 메운다.
 *
 * 원칙: **먼저 3초만 해보고 결과를 본 뒤** 전체를 돌린다. 전체는 오래 걸린다.
 * 쇼츠(9:16)든 롱폼(16:9)이든 좌표 기반이라 비율을 가리지 않는다.
 */

import { ownsTab } from './tab-owner.js'

const MODES = [
  { value: 'background', label: '배경 복원 (권장 · 무늬 있는 배경에 강함)' },
  { value: 'fast', label: '빠른 채우기 (단순한 배경·움직이는 물체에 강함)' },
  { value: 'blur', label: '흐리게 가리기 (가장 빠름 · 티가 남음)' },
]

const TARGETS = [
  { value: 'subtitle', label: '자막 (화면 아래쪽에서 바뀌는 글자)' },
  { value: 'watermark', label: '워터마크 (늘 같은 자리의 로고·채널명)' },
  { value: 'both', label: '둘 다 (화면 안의 모든 글자)' },
]

const state = {
  mediaPath: '',
  mediaName: '',
  mode: 'background',
  target: 'subtitle',
  box: 'auto',
  busy: false,
  status: '',
  error: '',
  preview: null,
  final: null,
}

function el(tag, className, text) {
  const node = document.createElement(tag)
  if (className) node.className = className
  if (text !== undefined) node.textContent = text
  return node
}

const fileNameOf = (path) => String(path).split(/[/\\]/).pop() || path

let repaint = () => {}

async function run(preview) {
  if (state.busy || !state.mediaPath) return
  state.busy = true
  state.error = ''
  state.status = preview
    ? '앞 3초만 지워보는 중… 잠깐이면 됩니다.'
    : '전체를 지우는 중… 영상 길이에 따라 몇 분 걸립니다.'
  repaint()

  try {
    const response = await fetch('/api/subtitle-erase', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mediaPath: state.mediaPath,
        mode: state.mode,
        target: state.target,
        box: state.box,
        preview,
        durationSec: preview ? 3 : 0,
      }),
    })
    const data = await response.json()
    if (!data.ok) throw new Error(data.error ?? '자막 지우기에 실패했습니다.')
    if (data.foundNothing) {
      // 못 찾았으면 원본 그대로다. 억지로 지우면 영상이 상한다.
      state.status = '지울 글자를 찾지 못했습니다. 영상은 그대로 두었습니다. 지울 영역을 직접 지정해 보세요.'
    } else if (preview) {
      state.preview = data
      state.status = '미리보기가 만들어졌습니다. 결과를 확인하고 전체를 돌리세요.'
    } else {
      state.final = data
      state.status = '전체 처리가 끝났습니다.'
    }
  } catch (error) {
    state.error = error.message
    state.status = '실패'
  } finally {
    state.busy = false
    repaint()
  }
}

function buildTab(deps) {
  const root = el('div', 'erase-tab')
  root.append(
    el(
      'p',
      'longform-intro',
      '영상에 박힌 자막·워터마크를 지웁니다. 글자를 찾아 그 자리만 메우므로 나머지 화면은 그대로 남습니다.',
    ),
  )

  const drop = el('div', 'longform-drop')
  if (state.mediaPath) drop.classList.add('is-set')
  drop.append(
    el('strong', null, state.mediaPath ? state.mediaName : '자막이 박힌 영상을 끌어다 놓으세요'),
    el('span', 'longform-path', state.mediaPath || '또는 클릭해서 고르기 · 쇼츠·롱폼 모두 됩니다'),
  )
  const setMedia = (path) => {
    if (!path) return
    state.mediaPath = path
    state.mediaName = fileNameOf(path)
    state.preview = null
    state.final = null
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

  const targetSelect = el('select', 'erase-mode')
  for (const option of TARGETS) {
    const node = el('option', null, option.label)
    node.value = option.value
    targetSelect.append(node)
  }
  targetSelect.value = state.target
  targetSelect.addEventListener('change', () => {
    state.target = targetSelect.value
  })

  const modeSelect = el('select', 'erase-mode')
  for (const option of MODES) {
    const node = el('option', null, option.label)
    node.value = option.value
    modeSelect.append(node)
  }
  modeSelect.value = state.mode
  modeSelect.addEventListener('change', () => {
    state.mode = modeSelect.value
  })

  const boxInput = el('input', 'erase-box')
  boxInput.value = state.box
  boxInput.placeholder = 'auto (자동 감지) 또는 x,y,너비,높이'
  boxInput.addEventListener('input', () => {
    state.box = boxInput.value.trim() || 'auto'
  })

  const options = el('div', 'longform-options')
  const targetField = el('label', 'longform-field')
  targetField.append(el('span', null, '지울 대상'), targetSelect)
  const modeField = el('label', 'longform-field')
  modeField.append(el('span', null, '지우는 방식'), modeSelect)
  const boxField = el('label', 'longform-field')
  boxField.append(el('span', null, '지울 영역'), boxInput)
  options.append(targetField, modeField, boxField)
  root.append(options)

  const previewBtn = el('button', 'primary-button', state.busy ? '처리 중…' : '3초만 먼저 해보기')
  previewBtn.type = 'button'
  previewBtn.disabled = state.busy || !state.mediaPath
  previewBtn.addEventListener('click', () => run(true))

  const fullBtn = el('button', 'ghost-button', '전체 지우기')
  fullBtn.type = 'button'
  fullBtn.disabled = state.busy || !state.mediaPath
  fullBtn.addEventListener('click', () => run(false))

  const buttons = el('div', 'erase-buttons')
  buttons.append(previewBtn, fullBtn)
  root.append(buttons)
  root.append(
    el('p', 'longform-note', '먼저 3초를 돌려 결과를 확인하세요. 자막 뒤 배경이 복잡하게 움직이면 얼룩이 남을 수 있습니다.'),
  )

  if (state.status) root.append(el('p', 'longform-status', state.status))
  if (state.error) root.append(el('p', 'longform-error', state.error))

  for (const [label, result] of [
    ['미리보기 (3초)', state.preview],
    ['전체 결과', state.final],
  ]) {
    if (!result?.outPath) continue
    const box = el('div', 'longform-result')
    box.append(el('h3', null, label))
    box.append(el('p', null, result.outPath))
    if (result.detectedBox) {
      const found = result.detectedBox
      box.append(
        el('p', 'longform-stats', `자동으로 찾은 자막 영역: 가로 ${found.w} × 세로 ${found.h} (x ${found.x}, y ${found.y})`),
      )
    }
    root.append(box)
  }

  return root
}

export function renderSubtitleEraseTab(container, deps = {}) {
  const paint = () => {
    // 다른 탭으로 넘어갔으면 그리지 않는다. 탭들이 같은 자리를 쓰기 때문에,
    // 늦게 돌아온 응답이 남의 화면을 덮어쓴다(실측으로 확인한 사고).
    if (!ownsTab(container, 'erase')) return
    container.replaceChildren(buildTab(deps))
  }
  repaint = paint
  paint()
  return { state }
}
