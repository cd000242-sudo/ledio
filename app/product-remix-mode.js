/* global FileReader, clearInterval, document, fetch, setInterval */
/**
 * 쇼핑쇼츠 · 소스 짜집기 모드.
 * 쿠팡 캡처 → 상품정보 자동 채움 → 바이럴 대본 → 소스 영상 여러 개 업로드 →
 * (서버) 원본 오디오 제거 + 박힌 자막 자동 블러 + AI 내용 매칭 → TTS 길이에 맞춰 컷 →
 * 12자 센터 자막 동기 → 완성 영상.
 */

import { getSettings } from './settings.js';

const COUPANG_DISCLOSURE =
  '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

const remix = {
  projectName: '',
  captures: [],
  analyzing: false,
  productInfo: { productName: '', benefit: '', painPoint: '', pricePoint: '' },
  script: '',
  generatingScript: false,
  durationSec: '18',
  sources: [],
  uploadingSources: false,
  selectedVoice: '',
  narrationStyle: 'shopping-host',
  narrationStrength: '2',
  running: false,
  jobId: '',
  job: null,
  jobTimer: null,
  status: '',
  statusIsError: false,
  resultVideo: '',
};

let shared = { voices: [], typecastVoices: [], narrationStyles: [] };
let root = null;

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

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]+,/, ''));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function setStatus(message, isError = false) {
  remix.status = message;
  remix.statusIsError = isError;
}

function pickApiMethod() {
  const settings = getSettings();
  const candidates = [
    ['api-gpt', settings.openaiApiKey],
    ['api-gemini', settings.geminiApiKey],
    ['api-claude', settings.anthropicApiKey],
  ];
  const preferred = candidates.find(([method]) => method === settings.scriptMethod);
  if (preferred && String(preferred[1] || '').trim()) {
    return { method: preferred[0], apiKey: preferred[1].trim() };
  }
  const available = candidates.find(([, key]) => String(key || '').trim());
  return available ? { method: available[0], apiKey: available[1].trim() } : null;
}

function isTypecastVoice(value) {
  return String(value ?? '').startsWith('typecast:');
}

function ensureProjectName() {
  if (!remix.projectName) remix.projectName = `remix-${Date.now().toString(36)}`;
  return remix.projectName;
}

async function uploadCaptures(files) {
  if (files.length === 0) throw new Error('쿠팡 상품 화면 캡처를 선택해 주세요.');
  const projectName = ensureProjectName();
  setStatus(`캡처 ${files.length}장 업로드 중...`);
  render();
  const payloadFiles = [];
  for (const file of files) {
    payloadFiles.push({ name: file.name, type: file.type, size: file.size, data: await fileToBase64(file) });
  }
  const data = await api('/api/media/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ projectName, kind: 'image', files: payloadFiles }),
  });
  remix.captures = [...remix.captures, ...data.imported.map((item) => item.relativePath)];
  setStatus(`캡처 ${remix.captures.length}장 준비 완료 — [상품정보 자동 분석]을 눌러보세요.`);
}

async function analyzeCaptures() {
  if (remix.captures.length === 0) throw new Error('먼저 쿠팡 캡처를 업로드해 주세요.');
  const picked = pickApiMethod();
  if (!picked) {
    throw new Error('캡처 분석에는 API 키가 필요합니다. 환경설정에서 OpenAI/Gemini/Claude 키 중 하나를 입력하세요.');
  }
  remix.analyzing = true;
  setStatus('AI가 캡처에서 상품 정보를 읽는 중...');
  render();
  try {
    const data = await api('/api/coupang/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: remix.projectName,
        images: remix.captures,
        method: picked.method,
        apiKey: picked.apiKey,
      }),
    });
    remix.productInfo = { ...remix.productInfo, ...data.productInfo };
    setStatus('상품 정보를 채웠습니다 — 확인·수정 후 [바이럴 대본 생성]을 누르세요.');
  } finally {
    remix.analyzing = false;
  }
}

async function generateScript() {
  if (!remix.productInfo.productName.trim()) {
    throw new Error('상품명이 필요합니다 — 캡처를 분석하거나 직접 입력해 주세요.');
  }
  const picked = pickApiMethod();
  const settings = getSettings();
  remix.generatingScript = true;
  setStatus('AI가 15~20초 바이럴 대본을 쓰는 중...');
  render();
  try {
    const data = await api('/api/script/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'coupang',
        productInfo: remix.productInfo,
        durationSec: Number(remix.durationSec) || 18,
        method: picked?.method ?? settings.scriptMethod ?? 'agent-claude',
        apiKey: picked?.apiKey ?? '',
      }),
    });
    remix.script = data.script;
    setStatus('대본 완성 — 소스 영상을 올리고 [짜집기 영상 만들기]를 누르세요.');
  } finally {
    remix.generatingScript = false;
  }
}

/** 소스 영상은 용량이 커서 파일당 1요청으로 업로드한다(요청 본문 한도 260MB). */
async function uploadSources(files) {
  if (files.length === 0) throw new Error('짜집기할 소스 영상을 선택해 주세요.');
  const projectName = ensureProjectName();
  remix.uploadingSources = true;
  try {
    for (let index = 0; index < files.length; index++) {
      const file = files[index];
      setStatus(`소스 영상 업로드 중 ${index + 1}/${files.length}: ${file.name}`);
      render();
      const data = await api('/api/media/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectName,
          kind: 'video',
          files: [{ name: file.name, type: file.type, size: file.size, data: await fileToBase64(file) }],
        }),
      });
      remix.sources = [...remix.sources, ...data.imported.map((item) => item.relativePath)];
    }
    setStatus(`소스 영상 ${remix.sources.length}개 준비 완료 — 원본 소리·자막은 제작 때 자동으로 제거됩니다.`);
  } finally {
    remix.uploadingSources = false;
  }
}

async function startRemix() {
  if (!remix.script.trim()) throw new Error('대본이 필요합니다 — [바이럴 대본 생성]을 먼저 눌러주세요.');
  if (remix.sources.length === 0) throw new Error('짜집기할 소스 영상을 먼저 업로드해 주세요.');
  if (!remix.selectedVoice) throw new Error('목소리를 선택해 주세요 — 자막이 목소리 타이밍에 맞춰집니다.');
  const settings = getSettings();
  const picked = pickApiMethod();
  remix.running = true;
  remix.resultVideo = '';
  setStatus('');
  render();
  try {
    const started = await api('/api/source-remix', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: ensureProjectName(),
        title: remix.productInfo.productName || remix.projectName,
        script: remix.script,
        clips: remix.sources,
        voice: remix.selectedVoice,
        ttsProvider: isTypecastVoice(remix.selectedVoice) ? 'typecast' : 'qwen3',
        ...(settings.typecastApiKey ? { typecastApiKey: settings.typecastApiKey.trim() } : {}),
        narrationStyle: remix.narrationStyle,
        narrationStrength: Number(remix.narrationStrength),
        directedNarration: true,
        scriptMethod: picked?.method ?? '',
        scriptApiKey: picked?.apiKey ?? '',
        disclosure: COUPANG_DISCLOSURE,
        ratio: '9:16',
      }),
    });
    remix.jobId = started.jobId;
    setStatus(`'${started.projectName}' 짜집기를 시작했습니다 — 소스 분석부터 순서대로 진행됩니다.`);
    startJobPolling();
  } catch (error) {
    remix.running = false;
    throw error;
  }
  render();
}

const STAGE_LABELS = {
  analyze: '① 소스 분석 — 자막 감지·내용 매칭',
  narrate: '② 나레이션 생성',
  cut: '③ 소스 컷 편집(블러·컷)',
  clips: '④ 자막 굽기·장면 클립',
  render: '⑤ 최종 렌더',
};

function jobPercent(job) {
  const stages = job?.progress?.stages ?? [];
  if (stages.length === 0) return job?.status === 'done' ? 100 : 5;
  const completed = (job?.progress?.completed ?? []).length;
  const runningBoost = job?.status === 'running' ? 0.5 : 0;
  return Math.min(100, Math.round(((completed + runningBoost) / stages.length) * 100));
}

function startJobPolling() {
  stopJobPolling();
  remix.jobTimer = setInterval(async () => {
    try {
      const data = await api('/api/jobs');
      const job = (data.jobs || []).find((entry) => entry.id === remix.jobId);
      if (!job) return;
      remix.job = job;
      if (job.status === 'done') {
        stopJobPolling();
        remix.running = false;
        remix.resultVideo =
          `/api/media/preview?projectPath=${encodeURIComponent(`projects/${job.projectName}`)}` +
          `&file=${encodeURIComponent('remix/video/output/video_01.mp4')}`;
        setStatus('🎉 짜집기 완성! 아래에서 확인하세요.');
      } else if (job.status === 'error' || job.status === 'cancelled') {
        stopJobPolling();
        remix.running = false;
        const tail = String(job.stderrTail || '').split('\n').filter(Boolean).at(-1) || '';
        setStatus(
          job.status === 'cancelled' ? '작업을 중지했습니다.' : `제작 실패: ${tail || '원인 미상 — 진단 로그를 확인하세요.'}`,
          job.status === 'error',
        );
      }
      render();
    } catch {
      /* 다음 틱에서 재시도 */
    }
  }, 2000);
}

function stopJobPolling() {
  if (remix.jobTimer) clearInterval(remix.jobTimer);
  remix.jobTimer = null;
}

async function cancelJob() {
  if (!remix.jobId) return;
  await fetch(`/api/jobs/${encodeURIComponent(remix.jobId)}/cancel`, { method: 'POST' });
  setStatus('중지 요청을 보냈습니다...');
}

function voiceOptionsHtml() {
  const none = `<option value=""${remix.selectedVoice === '' ? ' selected' : ''}>목소리 선택(필수)</option>`;
  const mine = shared.voices
    .map(
      (voice) =>
        `<option value="${esc(voice.name)}"${voice.name === remix.selectedVoice ? ' selected' : ''}>${esc(voice.name)}</option>`,
    )
    .join('');
  const typecast =
    shared.typecastVoices.length === 0
      ? ''
      : `<optgroup label="🎭 타입캐스트 AI 성우">${shared.typecastVoices
          .map(
            (voice) =>
              `<option value="typecast:${esc(voice.id)}"${`typecast:${voice.id}` === remix.selectedVoice ? ' selected' : ''}>${esc(voice.name)}</option>`,
          )
          .join('')}</optgroup>`;
  return none + mine + typecast;
}

function narrationStyleOptionsHtml() {
  if (shared.narrationStyles.length === 0) {
    return '<option value="shopping-host">쇼핑 호스트 · 친근한 판매 진행</option>';
  }
  const groups = new Map();
  for (const style of shared.narrationStyles) {
    if (!groups.has(style.group)) groups.set(style.group, []);
    groups.get(style.group).push(style);
  }
  return [...groups.entries()]
    .map(
      ([group, styles]) =>
        `<optgroup label="${esc(group)}">${styles
          .map(
            (style) =>
              `<option value="${esc(style.id)}"${style.id === remix.narrationStyle ? ' selected' : ''}>${esc(style.label)} — ${esc(style.description)}</option>`,
          )
          .join('')}</optgroup>`,
    )
    .join('');
}

function progressHtml() {
  if (!remix.running && !remix.job) return '';
  const job = remix.job;
  const percent = jobPercent(job);
  const stage = job?.progress?.current ? STAGE_LABELS[job.progress.current] || job.progress.current : '대기 중';
  if (!remix.running && job?.status === 'done') return '';
  return `
    <div class="job-card job-${esc(job?.status ?? 'queued')}">
      <div class="job-card-head">
        <strong>${esc(remix.productInfo.productName || remix.projectName)}</strong>
        <span class="soft-badge">${esc(job?.status === 'running' ? stage : job?.status === 'queued' ? '대기 중' : (job?.status ?? '준비'))}</span>
      </div>
      <div class="wiz-progress"><div class="wiz-progress-bar" style="width:${Math.max(4, percent)}%"></div></div>
      <div class="wiz-progress-meta"><span class="wiz-hint">${percent}%</span></div>
      ${job?.logTail?.length ? `<pre class="wiz-log">${esc(job.logTail.slice(-6).join('\n'))}</pre>` : ''}
      ${remix.running ? '<button id="rmCancelBtn" class="mini-button mini-danger" type="button">⏹ 중지</button>' : ''}
    </div>
  `;
}

export function renderProductRemixMode(container, sharedData) {
  root = container;
  shared = sharedData;
  render();
}

function render() {
  if (!root) return;
  root.innerHTML = `
      <section class="wizard-step">
        <h3>① 쿠팡 상품 캡처 <span class="wiz-hint">올리면 상품 정보가 자동으로 채워집니다</span></h3>
        <div class="field-grid">
          <input id="rmCaptures" type="file" accept="image/*" multiple />
          <button id="rmUploadCapturesBtn" class="ghost-button" type="button">캡처 업로드</button>
          <button id="rmAnalyzeBtn" class="primary-button" type="button" ${remix.analyzing || remix.captures.length === 0 ? 'disabled' : ''}>
            ${remix.analyzing ? '분석 중...' : '🔎 상품정보 자동 분석'}
          </button>
        </div>
        ${remix.captures.length ? `<p class="wiz-hint">업로드된 캡처: ${remix.captures.length}장</p>` : ''}
      </section>

      <section class="wizard-step">
        <h3>② 상품 정보</h3>
        <div class="field-grid">
          <label>상품명 <input id="rmProductName" value="${esc(remix.productInfo.productName)}" placeholder="예: 접이식 주방 선반" /></label>
          <label>가격·혜택 포인트 <input id="rmPricePoint" value="${esc(remix.productInfo.pricePoint)}" placeholder="예: 오늘만 40% 할인" /></label>
        </div>
        <label class="field-wide">핵심 장점 <input id="rmBenefit" value="${esc(remix.productInfo.benefit)}" placeholder="예: 펼치면 수납 2배" /></label>
        <label class="field-wide">해결하는 불편 <input id="rmPainPoint" value="${esc(remix.productInfo.painPoint)}" placeholder="예: 좁은 주방 정리" /></label>
      </section>

      <section class="wizard-step">
        <h3>③ 바이럴 대본 <span class="wiz-hint">문장마다 어울리는 소스 장면이 배정됩니다</span></h3>
        <div class="field-grid">
          <label>목표 길이
            <select id="rmDuration">
              <option value="15"${remix.durationSec === '15' ? ' selected' : ''}>15초</option>
              <option value="18"${remix.durationSec === '18' ? ' selected' : ''}>18초 (권장)</option>
              <option value="20"${remix.durationSec === '20' ? ' selected' : ''}>20초</option>
            </select>
          </label>
          <button id="rmScriptBtn" class="primary-button" type="button" ${remix.generatingScript ? 'disabled' : ''}>
            ${remix.generatingScript ? '작성 중...' : '✍️ 바이럴 대본 생성'}
          </button>
        </div>
        <label class="field-wide">대본
          <textarea id="rmScript" rows="6" placeholder="[바이럴 대본 생성]을 누르거나 직접 입력하세요.">${esc(remix.script)}</textarea>
        </label>
      </section>

      <section class="wizard-step">
        <h3>④ 소스 영상 <span class="wiz-hint">여러 개 가능 — 원본 소리 제거·박힌 자막 블러는 자동</span></h3>
        <div class="field-grid">
          <input id="rmSources" type="file" accept="video/*" multiple />
          <button id="rmUploadSourcesBtn" class="ghost-button" type="button" ${remix.uploadingSources ? 'disabled' : ''}>
            ${remix.uploadingSources ? '업로드 중...' : '소스 영상 업로드'}
          </button>
        </div>
        ${remix.sources.length ? `<p class="wiz-hint">준비된 소스: ${remix.sources.length}개 — AI가 대본 문장별로 어울리는 장면을 골라 짜집기합니다.</p>` : ''}
      </section>

      <section class="wizard-step">
        <h3>⑤ 목소리 & 만들기</h3>
        <div class="field-grid">
          <label>나레이션 목소리 (필수) <select id="rmVoice">${voiceOptionsHtml()}</select></label>
          <label>낭독 말투 <select id="rmStyle">${narrationStyleOptionsHtml()}</select></label>
        </div>
        <p class="wiz-hint">자막은 12자 이내로 화면 중앙에, 목소리 타이밍에 맞춰 자동 삽입됩니다. 쿠팡 파트너스 고지도 자동 포함됩니다.</p>
        <button id="rmRunBtn" class="primary-button" type="button" ${remix.running ? 'disabled' : ''}>
          ${remix.running ? '제작 중...' : '🎬 짜집기 영상 만들기'}
        </button>
        ${progressHtml()}
      </section>

      ${remix.status ? `<p class="wiz-status${remix.statusIsError ? ' wiz-status-error' : ''}">${esc(remix.status)}</p>` : ''}
      ${
        remix.resultVideo
          ? `<section class="wizard-step"><h3>완성 영상</h3><video controls class="wiz-result" src="${remix.resultVideo}"></video></section>`
          : ''
      }
  `;
  bind();
}

function bind() {
  const on = (id, event, handler) => {
    const el = root.querySelector(id);
    if (el) el.addEventListener(event, handler);
  };
  const guard = (fn) => () =>
    Promise.resolve()
      .then(fn)
      .then(() => render())
      .catch((error) => {
        setStatus(error.message, true);
        render();
      });

  on('#rmUploadCapturesBtn', 'click', guard(async () => {
    const input = root.querySelector('#rmCaptures');
    await uploadCaptures(Array.from(input?.files ?? []));
  }));
  on('#rmAnalyzeBtn', 'click', guard(analyzeCaptures));
  on('#rmScriptBtn', 'click', guard(generateScript));
  on('#rmUploadSourcesBtn', 'click', guard(async () => {
    const input = root.querySelector('#rmSources');
    await uploadSources(Array.from(input?.files ?? []));
  }));
  on('#rmRunBtn', 'click', guard(startRemix));
  on('#rmCancelBtn', 'click', guard(cancelJob));
  on('#rmProductName', 'input', (e) => {
    remix.productInfo = { ...remix.productInfo, productName: e.target.value };
  });
  on('#rmBenefit', 'input', (e) => {
    remix.productInfo = { ...remix.productInfo, benefit: e.target.value };
  });
  on('#rmPainPoint', 'input', (e) => {
    remix.productInfo = { ...remix.productInfo, painPoint: e.target.value };
  });
  on('#rmPricePoint', 'input', (e) => {
    remix.productInfo = { ...remix.productInfo, pricePoint: e.target.value };
  });
  on('#rmScript', 'input', (e) => {
    remix.script = e.target.value;
  });
  on('#rmDuration', 'change', (e) => {
    remix.durationSec = e.target.value;
  });
  on('#rmVoice', 'change', (e) => {
    remix.selectedVoice = e.target.value;
  });
  on('#rmStyle', 'change', (e) => {
    remix.narrationStyle = e.target.value;
  });
}
