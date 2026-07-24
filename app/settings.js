/* global clearInterval, document, fetch, localStorage, setInterval, window */
/**
 * 환경설정 탭. 기본값 + 로컬 도구 상태(ffmpeg/whisper 등) 표시.
 * 설정은 브라우저 localStorage에 저장(로컬 전용).
 */

const SETTINGS_KEY = 'shortsFactorySettings';

const defaults = {
  openaiApiKey: '',
  geminiApiKey: '',
  anthropicApiKey: '',
  falApiKey: '',
  typecastApiKey: '',
  defaultVoice: '',
  // 채널 주인공 — 모든 쇼츠에서 같은 인물이 나오게 하는 고정 설정
  characterGender: '남성',
  characterDesc: '',
};

function load() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { ...defaults };
  }
}

function save(settings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

/** 다른 모듈에서 저장된 기본값을 읽을 수 있게 노출. */
export function getSettings() {
  return load();
}

/** 일부 설정만 갱신해 저장한다(예: 기본 목소리 지정). */
export function updateSettings(partial) {
  save({ ...load(), ...partial });
}

const state = { settings: load(), tools: null, status: '', agents: null, dropshot: null };
let agentPollTimer = null;
let agentsLoadedOnce = false;

function agentBadgeText(agent) {
  if (!agent) return '미확인';
  if (!agent.installed) return '없음';
  return agent.loggedIn ? '로그인됨' : '로그인 필요';
}

async function refreshAgents(container, silent = false) {
  if (!silent) {
    state.status = '에이전트 상태 확인 중...';
    render(container);
  }
  try {
    const response = await fetch('/api/agents/status');
    state.agents = (await response.json()).agents || {};
    if (!silent) state.status = '에이전트 상태 갱신됨';
  } catch (error) {
    if (!silent) state.status = `확인 실패: ${error.message}`;
  }
  render(container);
}

/** 로그인 창을 연 뒤 상태를 3초마다 확인해서 로그인되면 자동으로 "로그인됨"으로 바꾼다. */
function pollAgentLogin(container, agent) {
  clearInterval(agentPollTimer);
  let tries = 0;
  agentPollTimer = setInterval(async () => {
    tries += 1;
    try {
      const response = await fetch('/api/agents/status');
      const agents = (await response.json()).agents || {};
      state.agents = agents;
      if (agents[agent]?.loggedIn) {
        clearInterval(agentPollTimer);
        state.status = `${agent === 'codex' ? 'Codex' : 'Claude Code'} 로그인됨`;
        render(container);
        return;
      }
    } catch {
      /* 다음 폴링에서 재시도 */
    }
    if (tries >= 60) {
      clearInterval(agentPollTimer);
      state.status = '로그인 확인 시간 초과 — 완료 후 "에이전트 상태 확인"을 눌러주세요.';
      render(container);
    }
  }, 3000);
}

async function agentLogin(container, agent) {
  try {
    const response = await fetch('/api/agents/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent }),
    });
    state.status = (await response.json()).message || '로그인 창을 열었습니다.';
    pollAgentLogin(container, agent);
  } catch (error) {
    state.status = `실패: ${error.message}`;
  }
  render(container);
}

async function refreshDropshot(container) {
  state.dropshot = { checking: true, message: '브라우저 세션을 확인하는 중입니다 (10~20초)...' };
  render(container);
  try {
    const response = await fetch('/api/dropshot/status');
    state.dropshot = await response.json();
    if (!state.dropshot.message) {
      state.dropshot.message = state.dropshot.loggedIn ? '드롭샷 로그인됨 — 무제한 생성 가능' : '드롭샷 로그인이 필요합니다.';
    }
  } catch (error) {
    state.dropshot = { loggedIn: false, message: `확인 실패: ${error.message}` };
  }
  render(container);
}

async function dropshotLogin(container) {
  state.dropshot = { checking: true, message: '로그인 창이 열렸습니다. 브라우저에서 로그인하세요 (최대 5분). 로그인하면 창이 자동으로 닫힙니다.' };
  render(container);
  try {
    const response = await fetch('/api/dropshot/login', { method: 'POST' });
    const data = await response.json();
    state.dropshot = data;
    if (!state.dropshot.message) state.dropshot.message = data.loggedIn ? '드롭샷 로그인 완료' : '로그인 실패';
  } catch (error) {
    state.dropshot = { loggedIn: false, message: `로그인 실패: ${error.message}` };
  }
  render(container);
}

async function refreshTools(container) {
  state.status = '도구 상태 확인 중...';
  render(container);
  try {
    const response = await fetch('/api/captions/status');
    state.tools = (await response.json()).tools || [];
    state.status = '도구 상태 갱신됨';
  } catch (error) {
    state.status = `확인 실패: ${error.message}`;
  }
  render(container);
}

function esc(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

function toolRows() {
  if (!state.tools) return '<p class="wiz-hint">아직 확인하지 않았습니다.</p>';
  return state.tools
    .map(
      (tool) =>
        `<div class="settings-tool-row"><span>${esc(tool.label)}</span>` +
        `<span class="soft-badge ${tool.available ? 'good' : 'warn'}">${tool.available ? '사용 가능' : '없음'}</span></div>` +
        (tool.available ? '' : `<p class="wiz-hint">${esc(tool.installHint)}</p>`),
    )
    .join('');
}

export function renderSettingsTab(container) {
  render(container);
  if (!agentsLoadedOnce) {
    agentsLoadedOnce = true;
    refreshAgents(container, true);
  }
}

function render(container) {
  const s = state.settings;
  container.innerHTML = `
    <div class="wizard-panel">
      <section class="wizard-step">
        <h3>API 키 <span class="soft-badge good">자동 저장</span></h3>
        <label class="field-wide">OpenAI API Key <input id="setOpenai" type="password" value="${esc(s.openaiApiKey)}" /></label>
        <label class="field-wide">Gemini API Key <input id="setGemini" type="password" value="${esc(s.geminiApiKey)}" /></label>
        <label class="field-wide">Claude API Key <input id="setAnthropic" type="password" value="${esc(s.anthropicApiKey)}" /></label>
        <label class="field-wide">fal.ai API Key (Seedance 영상화용) <input id="setFal" type="password" value="${esc(s.falApiKey)}" /></label>
        <label class="field-wide">타입캐스트 API Key (AI 성우 낭독용) <input id="setTypecast" type="password" value="${esc(s.typecastApiKey)}" /></label>
        <p class="wiz-hint">💾 입력하는 즉시 자동 저장되고, 앱을 켤 때 자동으로 불러옵니다 — 저장 버튼이 필요 없어요. <span id="setKeySaved" class="key-saved-flash"></span></p>
      </section>

      <section class="wizard-step">
        <h3>에이전트 로그인 (대본 생성용, 키 불필요)</h3>
        <div class="field-grid">
          <button id="setAgentsRefresh" class="ghost-button" type="button">에이전트 상태 확인</button>
          <span class="soft-badge ${state.agents?.claude?.loggedIn || state.agents?.codex?.loggedIn ? 'good' : ''}">${
            state.agents === null
              ? '확인 중...'
              : `Claude Code ${agentBadgeText(state.agents.claude)} · Codex ${agentBadgeText(state.agents.codex)}`
          }</span>
        </div>
        <div class="field-grid">
          <button id="setClaudeLogin" class="ghost-button" type="button">Claude Code 로그인 창 열기</button>
          <button id="setCodexLogin" class="ghost-button" type="button">Codex 로그인 창 열기</button>
        </div>
        <p class="wiz-hint">구독 중인 Claude Code(claude)나 Codex(codex) CLI가 설치되어 있으면 API 키 없이 대본 생성이 가능합니다.</p>
      </section>

      <section class="wizard-step">
        <h3>드롭샷 (나노바나나프로 이미지, 무제한)</h3>
        <div class="field-grid">
          <button id="setDropshotRefresh" class="ghost-button" type="button" ${state.dropshot?.checking ? 'disabled' : ''}>로그인 상태 확인</button>
          <span class="soft-badge ${state.dropshot?.checking ? '' : state.dropshot?.loggedIn ? 'good' : 'warn'}">${
            state.dropshot === null ? '미확인' : state.dropshot.checking ? '확인 중...' : state.dropshot.loggedIn ? '로그인됨' : '로그인 필요'
          }</span>
        </div>
        <button id="setDropshotLogin" class="primary-button" type="button" ${state.dropshot?.checking ? 'disabled' : ''}>드롭샷 로그인 (브라우저 창 열림)</button>
        ${state.dropshot?.message ? `<p class="wiz-hint">${esc(state.dropshot.message)}</p>` : ''}
        <p class="wiz-hint">한 번 로그인하면 세션이 저장되어 다시 로그인할 필요가 없습니다. Pro 구독 계정이면 이미지 생성이 무제한입니다.</p>
      </section>

      <section class="wizard-step">
        <h3>로컬 도구 상태</h3>
        <button id="setRefreshTools" class="ghost-button" type="button">도구 확인</button>
        <div class="settings-tools">${toolRows()}</div>
      </section>

      <section class="wizard-step">
        <h3>API 키 관리</h3>
        <p class="wiz-hint">키 발급 페이지와 요금 충전 페이지로 바로 이동합니다 (기본 브라우저에서 열림).</p>
        <button id="setKeyLinks" class="ghost-button" type="button">🔑 API 키 바로가기</button>
      </section>

      <section class="wizard-step">
        <h3>문제 해결</h3>
        <p class="wiz-hint">생성 실패 등 문제가 생기면 진단 로그를 저장해서 파일을 전달해 주세요. 최근 실행 기록과 실패 원인이 담깁니다.</p>
        <button id="setDiagnostics" class="ghost-button" type="button">🩺 진단 로그 저장 (바탕화면)</button>
      </section>

      ${state.status ? `<p class="wiz-status">${esc(state.status)}</p>` : ''}
    </div>
  `;
  bind(container);
}

// ── API 키 바로가기 모달: 서비스별 키 발급/요금 충전 페이지로 바로 이동 ──
const KEY_LINKS = [
  { name: 'OpenAI (GPT)', keys: 'https://platform.openai.com/api-keys', billing: 'https://platform.openai.com/settings/organization/billing/overview' },
  { name: 'Google Gemini', keys: 'https://aistudio.google.com/apikey', billing: 'https://console.cloud.google.com/billing' },
  { name: 'Anthropic (Claude)', keys: 'https://console.anthropic.com/settings/keys', billing: 'https://console.anthropic.com/settings/billing' },
  { name: 'fal.ai (Seedance 영상화)', keys: 'https://fal.ai/dashboard/keys', billing: 'https://fal.ai/dashboard/billing' },
  { name: '타입캐스트 (AI 성우 낭독)', keys: 'https://typecast.ai/developers/api', billing: 'https://biz.typecast.ai/org/overview' },
];

let keyLinksModal = null;

function openKeyLinksModal() {
  if (!keyLinksModal) {
    keyLinksModal = document.createElement('div');
    keyLinksModal.className = 'voice-modal-backdrop';
    keyLinksModal.innerHTML = `
      <div class="voice-modal key-links-modal" role="dialog" aria-modal="true">
        <h3>🔑 API 키 바로가기</h3>
        <p class="wiz-hint">버튼을 누르면 기본 브라우저에서 해당 페이지가 열립니다. 발급한 키는 위의 입력칸에 붙여넣으세요.</p>
        <div class="key-links-list">
          ${KEY_LINKS.map(
            (service) => `
              <div class="key-links-row">
                <strong>${service.name}</strong>
                <span>
                  <button class="mini-button" type="button" data-url="${service.keys}">🔑 키 발급</button>
                  <button class="mini-button" type="button" data-url="${service.billing}">💳 요금 충전</button>
                </span>
              </div>
            `,
          ).join('')}
        </div>
        <button class="primary-button" type="button" data-action="close">닫기</button>
      </div>
    `;
    keyLinksModal.addEventListener('click', (e) => {
      const url = e.target.dataset?.url;
      if (url) window.open(url);
      if (e.target.dataset?.action === 'close' || e.target === keyLinksModal) keyLinksModal.hidden = true;
    });
    document.body.appendChild(keyLinksModal);
  }
  keyLinksModal.hidden = false;
}

function bind(container) {
  const persist = () => save(state.settings);
  const on = (id, event, handler) => {
    const el = container.querySelector(id);
    if (el) el.addEventListener(event, handler);
  };
  // 저장 확인 표시 — 입력할 때마다 "✓ 저장됨"을 잠깐 보여준다 (전체 재렌더 없이).
  let savedFlashTimer = null;
  const flashSaved = () => {
    const el = container.querySelector('#setKeySaved');
    if (!el) return;
    el.textContent = '✓ 저장됨';
    clearInterval(savedFlashTimer);
    savedFlashTimer = setInterval(() => {
      el.textContent = '';
      clearInterval(savedFlashTimer);
    }, 1600);
  };
  const bindKey = (id, field) => {
    on(id, 'input', (e) => {
      state.settings[field] = e.target.value;
      persist();
      flashSaved();
    });
  };
  bindKey('#setOpenai', 'openaiApiKey');
  bindKey('#setGemini', 'geminiApiKey');
  bindKey('#setAnthropic', 'anthropicApiKey');
  bindKey('#setFal', 'falApiKey');
  bindKey('#setTypecast', 'typecastApiKey');
  on('#setRefreshTools', 'click', () => refreshTools(container));
  on('#setAgentsRefresh', 'click', () => refreshAgents(container));
  on('#setClaudeLogin', 'click', () => agentLogin(container, 'claude'));
  on('#setCodexLogin', 'click', () => agentLogin(container, 'codex'));
  on('#setDropshotRefresh', 'click', () => refreshDropshot(container));
  on('#setDropshotLogin', 'click', () => dropshotLogin(container));
  on('#setKeyLinks', 'click', openKeyLinksModal);
  on('#setDiagnostics', 'click', async () => {
    state.status = '진단 로그 저장 중...';
    render(container);
    try {
      const response = await fetch('/api/diagnostics/save', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const data = await response.json();
      state.status = data.ok ? `진단 로그 저장 완료: ${data.file}` : `저장 실패: ${data.error || '알 수 없는 오류'}`;
    } catch (error) {
      state.status = `저장 실패: ${error.message}`;
    }
    render(container);
  });
}
