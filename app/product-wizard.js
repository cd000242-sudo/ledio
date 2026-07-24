/* global document, fetch */
/**
 * 쇼핑쇼츠 탭 셸 — 두 모드를 전환한다.
 * 🤖 전부 AI: 쿠팡 캡처 → 대본 → 이미지 생성 → 완성 (product-ai-mode.js)
 * 🎞 소스 짜집기: 캡처 → 대본 → 소스 영상 AI 매칭 짜집기 (product-remix-mode.js)
 * 목소리/말투 데이터 로드는 여기서 한 번만 하고 두 모드에 공유한다.
 * (구 이어붙이기 UI는 제거됨 — 서버 /api/product-pipeline과 product-render CLI는 호환용으로 유지)
 */

import { getSettings } from './settings.js';
import { renderProductAiMode } from './product-ai-mode.js';
import { renderProductRemixMode } from './product-remix-mode.js';

const state = {
  /** 'ai' = 쿠팡 캡처 → 전부 AI 제작(기본), 'source' = 소스 영상 짜집기 */
  mode: 'ai',
  voices: [],
  typecastVoices: [],
  narrationStyles: [],
};

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `${path} 실패`);
  return data;
}

async function loadData() {
  try {
    const [voicesData, stylesData] = await Promise.all([api('/api/voices'), api('/api/narration-styles')]);
    state.voices = voicesData.voices;
    state.narrationStyles = stylesData.styles || [];
  } catch {
    state.voices = [];
    state.narrationStyles = [];
  }
  // 환경설정에 타입캐스트 키가 있으면 AI 성우 목록도 함께 보여준다(실패는 조용히 무시).
  const typecastKey = (getSettings().typecastApiKey || '').trim();
  if (typecastKey) {
    try {
      const data = await api('/api/typecast/voices', { headers: { 'x-typecast-key': typecastKey } });
      state.typecastVoices = data.voices || [];
    } catch {
      state.typecastVoices = [];
    }
  } else {
    state.typecastVoices = [];
  }
}

export function renderProductWizardTab(container) {
  render(container);
  if (state.voices.length === 0 || state.narrationStyles.length === 0) loadData().then(() => render(container));
}

function modeToggleHtml() {
  return `
    <div class="pw-mode-toggle">
      <button id="pwModeAi" class="${state.mode === 'ai' ? 'primary-button' : 'ghost-button'}" type="button">🤖 전부 AI — 쿠팡 캡처로 완성</button>
      <button id="pwModeSource" class="${state.mode === 'source' ? 'primary-button' : 'ghost-button'}" type="button">🎞 소스 짜집기 — 내 영상 AI 편집</button>
    </div>
  `;
}

function bindModeToggle(container) {
  const setMode = (mode) => {
    state.mode = mode;
    render(container);
  };
  container.querySelector('#pwModeAi')?.addEventListener('click', () => setMode('ai'));
  container.querySelector('#pwModeSource')?.addEventListener('click', () => setMode('source'));
}

function render(container) {
  container.innerHTML = `<div class="wizard-panel">${modeToggleHtml()}<div id="pwModeRoot"></div></div>`;
  bindModeToggle(container);
  const modeRoot = container.querySelector('#pwModeRoot');
  const sharedData = {
    voices: state.voices,
    typecastVoices: state.typecastVoices,
    narrationStyles: state.narrationStyles,
  };
  if (state.mode === 'ai') renderProductAiMode(modeRoot, sharedData);
  else renderProductRemixMode(modeRoot, sharedData);
}
