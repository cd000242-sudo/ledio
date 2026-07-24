/* global Blob, FileReader, document, fetch */
/**
 * 쇼핑쇼츠 원클릭 위저드.
 * 클립 업로드 + 상품정보 + 내 목소리 → 변형 N개 쇼핑 쇼츠.
 * 자체 상태를 갖는 독립 모듈(app.js 상태에 의존하지 않음).
 */

import { getSettings } from './settings.js';

const state = {
  voices: [],
  typecastVoices: [],
  selectedVoice: '',
  narrationStyles: [],
  narrationStyle: 'shopping-host',
  narrationStrength: '2',
  customNarrationStyle: '',
  directedNarration: true,
  projectName: '',
  productName: '',
  affiliateUrl: '',
  benefit: '',
  painPoint: '',
  clips: [],
  variants: 5,
  running: false,
  status: '',
  resultVideos: [],
};

async function api(path, options) {
  const response = await fetch(path, options);
  const data = await response.json();
  if (!response.ok || data.ok === false) throw new Error(data.error || `${path} 실패`);
  return data;
}

function esc(value) {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
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

function narrationStyleOptions() {
  if (state.narrationStyles.length === 0) {
    return '<option value="shopping-host">쇼핑 호스트 · 친근한 판매 진행</option>';
  }
  const groups = new Map();
  for (const style of state.narrationStyles) {
    if (!groups.has(style.group)) groups.set(style.group, []);
    groups.get(style.group).push(style);
  }
  return [...groups.entries()]
    .map(
      ([group, styles]) =>
        `<optgroup label="${esc(group)}">${styles
          .map(
            (style) =>
              `<option value="${esc(style.id)}"${style.id === state.narrationStyle ? ' selected' : ''}>${esc(style.label)} — ${esc(style.description)}</option>`,
          )
          .join('')}</optgroup>`,
    )
    .join('');
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]+,/, ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

async function uploadClips(container) {
  const projectName = (state.projectName || `shop-${Date.now().toString(36)}`).trim();
  state.projectName = projectName;
  const input = container.querySelector('#pwClips');
  const files = Array.from(input.files || []);
  if (files.length === 0) throw new Error('영상 클립을 선택해 주세요.');
  state.status = `${files.length}개 클립 업로드 중...`;
  render(container);
  const payloadFiles = [];
  for (const file of files) {
    payloadFiles.push({ name: file.name, type: file.type, size: file.size, data: await fileToBase64(file) });
  }
  const data = await api('/api/media/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectName, kind: 'video', files: payloadFiles }),
  });
  state.clips = data.imported.map((item) => item.relativePath);
  state.status = `클립 ${state.clips.length}개 업로드 완료`;
}

async function runProductPipeline(container) {
  if (state.clips.length === 0) throw new Error('먼저 클립을 업로드해 주세요.');
  if (!state.productName.trim()) throw new Error('상품명을 입력해 주세요.');
  state.running = true;
  state.status = '쇼핑쇼츠 생성 중...';
  state.resultVideos = [];
  render(container);
  try {
    const settings = getSettings();
    const keyMap = {
      'api-gpt': settings.openaiApiKey,
      'api-gemini': settings.geminiApiKey,
      'api-claude': settings.anthropicApiKey,
    };
    const scriptMethod = settings.scriptMethod || 'api-gpt';
    const data = await api('/api/product-pipeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: state.projectName,
        productName: state.productName,
        affiliateUrl: state.affiliateUrl,
        benefit: state.benefit,
        painPoint: state.painPoint,
        clips: state.clips,
        variants: Number(state.variants) || 5,
        voice: state.selectedVoice || undefined,
        narrationStyle: state.narrationStyle,
        narrationStrength: Number(state.narrationStrength),
        customNarrationStyle: state.customNarrationStyle,
        directedNarration: state.directedNarration,
        scriptMethod,
        scriptApiKey: keyMap[scriptMethod] || '',
        ...(settings.typecastApiKey ? { typecastApiKey: settings.typecastApiKey.trim() } : {}),
      }),
    });
    state.resultVideos = (data.videos || []).map(
      (file) =>
        `/api/media/preview?projectPath=${encodeURIComponent(`projects/${data.projectName}`)}` +
        `&file=${encodeURIComponent(`output/${file}`)}`,
    );
    state.status = `완성! 변형 ${state.resultVideos.length}개`;
  } finally {
    state.running = false;
    render(container);
  }
}

function voiceOptions() {
  const none = `<option value=""${state.selectedVoice === '' ? ' selected' : ''}>나레이션 없이(자막만)</option>`;
  const typecast =
    state.typecastVoices.length === 0
      ? ''
      : `<optgroup label="🎭 타입캐스트 AI 성우">${state.typecastVoices
          .map(
            (voice) =>
              `<option value="typecast:${esc(voice.id)}"${`typecast:${voice.id}` === state.selectedVoice ? ' selected' : ''}>${esc(voice.name)}</option>`,
          )
          .join('')}</optgroup>`;
  return (
    none +
    state.voices
      .map(
        (voice) =>
          `<option value="${esc(voice.name)}"${voice.name === state.selectedVoice ? ' selected' : ''}>${esc(
            voice.name,
          )}</option>`,
      )
      .join('') +
    typecast
  );
}

export function renderProductWizardTab(container) {
  render(container);
  if (state.voices.length === 0 || state.narrationStyles.length === 0) loadData().then(() => render(container));
}

function render(container) {
  container.innerHTML = `
    <div class="wizard-panel">
      <section class="wizard-step">
        <h3>① 영상 클립</h3>
        <p class="wiz-hint">이미 편집한 클립들을 올리면 9:16으로 맞춰 이어 붙입니다.</p>
        <input id="pwClips" type="file" accept="video/*" multiple />
        <button id="pwUploadBtn" class="ghost-button" type="button">클립 업로드</button>
        ${state.clips.length ? `<p class="wiz-hint">업로드됨: ${state.clips.length}개</p>` : ''}
      </section>

      <section class="wizard-step">
        <h3>② 상품 정보</h3>
        <div class="field-grid">
          <label>상품명 <input id="pwProductName" value="${esc(state.productName)}" /></label>
          <label>제휴 링크 <input id="pwAffiliateUrl" value="${esc(state.affiliateUrl)}" placeholder="https://" /></label>
        </div>
        <label class="field-wide">핵심 장점 <input id="pwBenefit" value="${esc(state.benefit)}" placeholder="예: 접으면 작고 펼치면 수납공간" /></label>
        <label class="field-wide">불편 포인트 <input id="pwPainPoint" value="${esc(state.painPoint)}" placeholder="예: 좁은 주방 정리" /></label>
      </section>

      <section class="wizard-step">
        <h3>③ 목소리 & 변형</h3>
        <div class="field-grid">
          <label>나레이션 목소리 <select id="pwVoice">${voiceOptions()}</select></label>
          <label>변형 개수 <input id="pwVariants" type="number" min="1" max="10" value="${esc(state.variants)}" /></label>
        </div>
        <div class="field-grid">
          <label>광고·낭독 말투
            <select id="pwNarrationStyle" ${state.selectedVoice ? '' : 'disabled'}>${narrationStyleOptions()}</select>
          </label>
          <label>말투 적용 강도
            <select id="pwNarrationStrength" ${state.selectedVoice ? '' : 'disabled'}>
              <option value="1"${state.narrationStrength === '1' ? ' selected' : ''}>약하게 · 원래 목소리 중심</option>
              <option value="2"${state.narrationStrength === '2' ? ' selected' : ''}>보통 · 자연스러운 광고 말투</option>
              <option value="3"${state.narrationStrength === '3' ? ' selected' : ''}>강하게 · 판매 포인트 강조</option>
            </select>
          </label>
        </div>
        ${
          state.narrationStyle === 'custom'
            ? `<label class="field-wide">직접 말투 지시
                <input id="pwCustomNarrationStyle" maxlength="500" value="${esc(state.customNarrationStyle)}" placeholder="예: 홈쇼핑 진행자처럼 밝게, 마지막 구매 문구는 짧고 단호하게" />
              </label>`
            : ''
        }
        <label class="wiz-check"><input id="pwDirectedNarration" type="checkbox"${state.directedNarration ? ' checked' : ''} ${state.selectedVoice ? '' : 'disabled'} />
          AI 세밀 연출 — 상품 문맥에 맞춰 완급·쉼·피치·강도·끝음을 문장별로 조정</label>
        <p class="wiz-hint">목소리를 고르면 상품 정보로 쇼핑 멘트를 만들고, 선택한 말투와 끝음 처리까지 입혀 영상에 자동 합성합니다.</p>
        <button id="pwRunBtn" class="primary-button" type="button" ${state.running ? 'disabled' : ''}>
          ${state.running ? '생성 중...' : '쇼핑쇼츠 만들기'}
        </button>
      </section>

      ${state.status ? `<p class="wiz-status">${esc(state.status)}</p>` : ''}
      ${
        state.resultVideos.length
          ? `<section class="wizard-step"><h3>결과</h3><div class="wiz-result-grid">${state.resultVideos
              .map((src) => `<video controls class="wiz-result" src="${src}"></video>`)
              .join('')}</div></section>`
          : ''
      }
    </div>
  `;
  bind(container);
}

function bind(container) {
  const on = (id, event, handler) => {
    const el = container.querySelector(id);
    if (el) el.addEventListener(event, handler);
  };
  const guard = (fn) => () =>
    fn(container).catch((error) => {
      state.status = error.message;
      state.running = false;
      render(container);
    });

  on('#pwUploadBtn', 'click', guard(async (c) => {
    await uploadClips(c);
    render(c);
  }));
  on('#pwProductName', 'input', (e) => {
    state.productName = e.target.value;
  });
  on('#pwAffiliateUrl', 'input', (e) => {
    state.affiliateUrl = e.target.value;
  });
  on('#pwBenefit', 'input', (e) => {
    state.benefit = e.target.value;
  });
  on('#pwPainPoint', 'input', (e) => {
    state.painPoint = e.target.value;
  });
  on('#pwVoice', 'change', (e) => {
    state.selectedVoice = e.target.value;
    render(container);
  });
  on('#pwNarrationStyle', 'change', (e) => {
    state.narrationStyle = e.target.value;
    render(container);
  });
  on('#pwNarrationStrength', 'change', (e) => {
    state.narrationStrength = e.target.value;
  });
  on('#pwCustomNarrationStyle', 'input', (e) => {
    state.customNarrationStyle = e.target.value;
  });
  on('#pwDirectedNarration', 'change', (e) => {
    state.directedNarration = e.target.checked;
  });
  on('#pwVariants', 'input', (e) => {
    state.variants = e.target.value;
  });
  on('#pwRunBtn', 'click', guard(runProductPipeline));
}
