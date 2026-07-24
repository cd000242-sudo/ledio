/* global Blob, FileReader, clearInterval, document, fetch, setInterval */
/**
 * 쇼핑쇼츠 · 전부 AI 모드 (쿠팡 캡처 → 완성 영상).
 * 캡처 업로드 → 상품정보 자동 분석(비전) → 15~20초 바이럴 대본 → 타입캐스트/내 목소리 TTS →
 * 캡처 참조 이미지 생성 → i2v 영상화 → 12자 센터 자막(TTS 동기) → 최종 영상.
 * product-wizard.js가 목소리/말투 데이터를 넘겨주고, 이 모듈은 자체 상태로 동작한다.
 */

import { getSettings } from './settings.js';

const COUPANG_DISCLOSURE =
  '이 포스팅은 쿠팡 파트너스 활동의 일환으로, 이에 따른 일정액의 수수료를 제공받습니다.';

const ai = {
  projectName: '',
  captures: [],
  analyzing: false,
  productInfo: { productName: '', benefit: '', painPoint: '', pricePoint: '' },
  affiliateUrl: '',
  script: '',
  generatingScript: false,
  durationSec: '18',
  selectedVoice: '',
  narrationStyle: 'shopping-host',
  narrationStrength: '2',
  imageEngine: 'dropshot',
  motionEngine: 'dropshot',
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
  ai.status = message;
  ai.statusIsError = isError;
}

/** 비전/대본 생성에 쓸 API 방식과 키 — 설정된 키 중에서 고른다(에이전트는 이미지 미지원). */
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
  if (!ai.projectName) ai.projectName = `coupang-${Date.now().toString(36)}`;
  return ai.projectName;
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
  ai.captures = [...ai.captures, ...data.imported.map((item) => item.relativePath)];
  setStatus(`캡처 ${ai.captures.length}장 준비 완료 — 이제 [상품정보 자동 분석]을 눌러보세요.`);
}

async function analyzeCaptures() {
  if (ai.captures.length === 0) throw new Error('먼저 쿠팡 캡처를 업로드해 주세요.');
  const picked = pickApiMethod();
  if (!picked) {
    throw new Error('캡처 분석에는 API 키가 필요합니다. 환경설정에서 OpenAI/Gemini/Claude 키 중 하나를 입력하세요.');
  }
  ai.analyzing = true;
  setStatus('AI가 캡처에서 상품 정보를 읽는 중...');
  render();
  try {
    const data = await api('/api/coupang/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: ai.projectName,
        images: ai.captures,
        method: picked.method,
        apiKey: picked.apiKey,
      }),
    });
    ai.productInfo = { ...ai.productInfo, ...data.productInfo };
    setStatus('상품 정보를 채웠습니다 — 내용을 확인·수정하고 [바이럴 대본 생성]을 누르세요.');
  } finally {
    ai.analyzing = false;
  }
}

async function generateScript() {
  if (!ai.productInfo.productName.trim()) {
    throw new Error('상품명이 필요합니다 — 캡처를 분석하거나 직접 입력해 주세요.');
  }
  const picked = pickApiMethod();
  const settings = getSettings();
  const method = picked?.method ?? settings.scriptMethod ?? 'agent-claude';
  const apiKey = picked?.apiKey ?? '';
  ai.generatingScript = true;
  setStatus('AI가 15~20초 바이럴 대본을 쓰는 중(초안 2개 + 심사)...');
  render();
  try {
    const data = await api('/api/script/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'coupang',
        productInfo: ai.productInfo,
        durationSec: Number(ai.durationSec) || 18,
        method,
        apiKey,
      }),
    });
    ai.script = data.script;
    setStatus('대본 완성 — 문구를 다듬고 [완성 영상 만들기]를 누르세요.');
  } finally {
    ai.generatingScript = false;
  }
}

/** 이미지 엔진 선택 → 파이프라인 파라미터. */
function imageEngineParams() {
  const settings = getSettings();
  if (ai.imageEngine === 'gpt-image-2') {
    if (!String(settings.openaiApiKey || '').trim()) {
      throw new Error('GPT Image 2(덕테이프)는 OpenAI API 키가 필요합니다. 환경설정에서 입력하세요.');
    }
    return { imageProvider: 'gpt', imageModel: 'gpt-image-2', apiKey: settings.openaiApiKey.trim() };
  }
  if (ai.imageEngine === 'gemini') {
    if (!String(settings.geminiApiKey || '').trim()) {
      throw new Error('나노바나나(Gemini) 이미지는 Gemini API 키가 필요합니다. 환경설정에서 입력하세요.');
    }
    return { imageProvider: 'gemini', apiKey: settings.geminiApiKey.trim() };
  }
  return { imageProvider: 'dropshot' };
}

async function startPipeline() {
  if (ai.captures.length === 0) throw new Error('쿠팡 캡처를 먼저 업로드해 주세요(상품 이미지의 기준이 됩니다).');
  if (!ai.script.trim()) throw new Error('대본이 필요합니다 — [바이럴 대본 생성]을 먼저 눌러주세요.');
  if (!ai.selectedVoice) throw new Error('목소리를 선택해 주세요 — 자막이 목소리 타이밍에 맞춰집니다.');
  if (ai.motionEngine === 'seedance' && !String(getSettings().falApiKey || '').trim()) {
    throw new Error('Seedance 영상화에는 fal.ai API 키가 필요합니다. 환경설정에서 입력하거나 드롭샷을 선택하세요.');
  }
  if (
    ai.motionEngine === 'higgsfield' &&
    (!String(getSettings().higgsfieldApiKey || '').trim() || !String(getSettings().higgsfieldSecret || '').trim())
  ) {
    throw new Error('힉스필드 영상화에는 API Key와 Secret이 모두 필요합니다. 환경설정에서 입력하세요.');
  }
  const settings = getSettings();
  const engine = imageEngineParams();
  const picked = pickApiMethod();
  ai.running = true;
  ai.resultVideo = '';
  setStatus('');
  render();
  try {
    const started = await api('/api/story-pipeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName: ensureProjectName(),
        title: ai.productInfo.productName || ai.projectName,
        script: ai.script,
        maxSceneChars: 20,
        sceneDurationSec: 3,
        ratio: '9:16',
        promptProfile: 'product',
        referenceImages: ai.captures,
        disclosure: COUPANG_DISCLOSURE,
        captionPosition: 'center',
        captionMaxChars: 12,
        imageProvider: engine.imageProvider,
        imageModel: engine.imageModel,
        apiKey: engine.apiKey,
        motionMode: ai.motionEngine === 'none' ? 'none' : 'all',
        motionEngine: ai.motionEngine === 'none' ? undefined : ai.motionEngine,
        falApiKey: settings.falApiKey || '',
        higgsfieldApiKey: settings.higgsfieldApiKey || '',
        higgsfieldSecret: settings.higgsfieldSecret || '',
        voice: ai.selectedVoice,
        ttsProvider: isTypecastVoice(ai.selectedVoice) ? 'typecast' : 'qwen3',
        ...(settings.typecastApiKey ? { typecastApiKey: settings.typecastApiKey.trim() } : {}),
        narrationStyle: ai.narrationStyle,
        narrationStrength: Number(ai.narrationStrength),
        directedNarration: true,
        scriptMethod: picked?.method ?? '',
        scriptApiKey: picked?.apiKey ?? '',
        force: true,
        async: true,
      }),
    });
    ai.jobId = started.jobId;
    setStatus(`'${started.projectName}' 영상 제작을 시작했습니다 — 아래 진행 상황을 지켜보세요.`);
    startJobPolling();
  } catch (error) {
    ai.running = false;
    throw error;
  }
  render();
}

const STAGE_LABELS = {
  images: '① 상품 이미지 생성',
  motion: '② 장면 영상화(i2v)',
  narrate: '③ 나레이션 생성',
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
  ai.jobTimer = setInterval(async () => {
    try {
      const data = await api('/api/jobs');
      const job = (data.jobs || []).find((entry) => entry.id === ai.jobId);
      if (!job) return;
      ai.job = job;
      if (job.status === 'done') {
        stopJobPolling();
        ai.running = false;
        ai.resultVideo =
          `/api/media/preview?projectPath=${encodeURIComponent(`projects/${job.projectName}`)}` +
          `&file=${encodeURIComponent('pipeline/video/output/video_01.mp4')}`;
        setStatus('🎉 완성! 아래에서 영상을 확인하세요.');
      } else if (job.status === 'error' || job.status === 'cancelled') {
        stopJobPolling();
        ai.running = false;
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
  if (ai.jobTimer) clearInterval(ai.jobTimer);
  ai.jobTimer = null;
}

async function cancelJob() {
  if (!ai.jobId) return;
  await fetch(`/api/jobs/${encodeURIComponent(ai.jobId)}/cancel`, { method: 'POST' });
  setStatus('중지 요청을 보냈습니다...');
}

function voiceOptionsHtml() {
  const none = `<option value=""${ai.selectedVoice === '' ? ' selected' : ''}>목소리 선택(필수)</option>`;
  const mine = shared.voices
    .map(
      (voice) =>
        `<option value="${esc(voice.name)}"${voice.name === ai.selectedVoice ? ' selected' : ''}>${esc(voice.name)}</option>`,
    )
    .join('');
  const typecast =
    shared.typecastVoices.length === 0
      ? ''
      : `<optgroup label="🎭 타입캐스트 AI 성우">${shared.typecastVoices
          .map(
            (voice) =>
              `<option value="typecast:${esc(voice.id)}"${`typecast:${voice.id}` === ai.selectedVoice ? ' selected' : ''}>${esc(voice.name)}</option>`,
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
              `<option value="${esc(style.id)}"${style.id === ai.narrationStyle ? ' selected' : ''}>${esc(style.label)} — ${esc(style.description)}</option>`,
          )
          .join('')}</optgroup>`,
    )
    .join('');
}

function progressHtml() {
  if (!ai.running && !ai.job) return '';
  const job = ai.job;
  const percent = jobPercent(job);
  const stage = job?.progress?.current ? STAGE_LABELS[job.progress.current] || job.progress.current : '대기 중';
  if (!ai.running && job?.status === 'done') return '';
  return `
    <div class="job-card job-${esc(job?.status ?? 'queued')}">
      <div class="job-card-head">
        <strong>${esc(ai.productInfo.productName || ai.projectName)}</strong>
        <span class="soft-badge">${esc(job?.status === 'running' ? stage : job?.status === 'queued' ? '대기 중' : (job?.status ?? '준비'))}</span>
      </div>
      <div class="wiz-progress"><div class="wiz-progress-bar" style="width:${Math.max(4, percent)}%"></div></div>
      <div class="wiz-progress-meta"><span class="wiz-hint">${percent}%</span></div>
      ${ai.running ? '<button id="aiCancelBtn" class="mini-button mini-danger" type="button">⏹ 중지</button>' : ''}
    </div>
  `;
}

export function renderProductAiMode(container, sharedData) {
  root = container;
  shared = sharedData;
  render();
}

function render() {
  if (!root) return;
  root.innerHTML = `
      <section class="wizard-step">
        <h3>① 쿠팡 상품 캡처 <span class="wiz-hint">상품 페이지를 캡처해서 올리면 이미지의 기준이 됩니다</span></h3>
        <div class="field-grid">
          <input id="aiCaptures" type="file" accept="image/*" multiple />
          <button id="aiUploadBtn" class="ghost-button" type="button">캡처 업로드</button>
          <button id="aiAnalyzeBtn" class="primary-button" type="button" ${ai.analyzing || ai.captures.length === 0 ? 'disabled' : ''}>
            ${ai.analyzing ? '분석 중...' : '🔎 상품정보 자동 분석'}
          </button>
        </div>
        ${ai.captures.length ? `<p class="wiz-hint">업로드된 캡처: ${ai.captures.length}장</p>` : ''}
        <p class="wiz-hint">자동 분석에는 환경설정의 OpenAI/Gemini/Claude API 키 중 하나가 필요합니다. 키가 없으면 아래 칸에 직접 입력해도 됩니다.</p>
      </section>

      <section class="wizard-step">
        <h3>② 상품 정보 <span class="wiz-hint">자동 분석 결과를 확인·수정하세요</span></h3>
        <div class="field-grid">
          <label>상품명 <input id="aiProductName" value="${esc(ai.productInfo.productName)}" placeholder="예: 접이식 주방 선반" /></label>
          <label>가격·혜택 포인트 <input id="aiPricePoint" value="${esc(ai.productInfo.pricePoint)}" placeholder="예: 오늘만 40% 할인" /></label>
        </div>
        <label class="field-wide">핵심 장점 <input id="aiBenefit" value="${esc(ai.productInfo.benefit)}" placeholder="예: 펼치면 수납 2배" /></label>
        <label class="field-wide">해결하는 불편 <input id="aiPainPoint" value="${esc(ai.productInfo.painPoint)}" placeholder="예: 좁은 주방 정리" /></label>
        <label class="field-wide">쿠팡 파트너스 링크(선택) <input id="aiAffiliateUrl" value="${esc(ai.affiliateUrl)}" placeholder="https://link.coupang.com/..." /></label>
      </section>

      <section class="wizard-step">
        <h3>③ 바이럴 대본 <span class="wiz-hint">후킹 → 사용 장면 → 변화 → CTA, 15~20초</span></h3>
        <div class="field-grid">
          <label>목표 길이
            <select id="aiDuration">
              <option value="15"${ai.durationSec === '15' ? ' selected' : ''}>15초</option>
              <option value="18"${ai.durationSec === '18' ? ' selected' : ''}>18초 (권장)</option>
              <option value="20"${ai.durationSec === '20' ? ' selected' : ''}>20초</option>
            </select>
          </label>
          <button id="aiScriptBtn" class="primary-button" type="button" ${ai.generatingScript ? 'disabled' : ''}>
            ${ai.generatingScript ? '작성 중...' : '✍️ 바이럴 대본 생성'}
          </button>
        </div>
        <label class="field-wide">대본 (한 줄 = 한 장면 = 이미지 한 장)
          <textarea id="aiScript" rows="6" placeholder="[바이럴 대본 생성]을 누르거나 직접 입력하세요.">${esc(ai.script)}</textarea>
        </label>
      </section>

      <section class="wizard-step">
        <h3>④ 목소리 & 생성 엔진</h3>
        <div class="field-grid">
          <label>나레이션 목소리 (필수) <select id="aiVoice">${voiceOptionsHtml()}</select></label>
          <label>낭독 말투 <select id="aiStyle">${narrationStyleOptionsHtml()}</select></label>
        </div>
        <div class="field-grid">
          <label>이미지 생성
            <select id="aiImageEngine">
              <option value="dropshot"${ai.imageEngine === 'dropshot' ? ' selected' : ''}>드롭샷 · 나노바나나프로 (구독, 무제한)</option>
              <option value="gpt-image-2"${ai.imageEngine === 'gpt-image-2' ? ' selected' : ''}>GPT Image 2 · 덕테이프 (OpenAI 키)</option>
              <option value="gemini"${ai.imageEngine === 'gemini' ? ' selected' : ''}>나노바나나 (Gemini 키)</option>
            </select>
          </label>
          <label>장면 영상화(i2v)
            <select id="aiMotionEngine">
              <option value="dropshot"${ai.motionEngine === 'dropshot' ? ' selected' : ''}>드롭샷 영상 (구독 크레딧)</option>
              <option value="higgsfield"${ai.motionEngine === 'higgsfield' ? ' selected' : ''}>힉스필드 DoP (시네마틱 · API 키)</option>
              <option value="seedance"${ai.motionEngine === 'seedance' ? ' selected' : ''}>Seedance (fal.ai 키)</option>
              <option value="none"${ai.motionEngine === 'none' ? ' selected' : ''}>정지 이미지만 (빠름)</option>
            </select>
          </label>
        </div>
        <p class="wiz-hint">자막은 12자 이내로 화면 중앙에, 목소리 타이밍에 맞춰 자동으로 들어갑니다. 쿠팡 파트너스 고지 문구도 자동 삽입됩니다.</p>
        <button id="aiRunBtn" class="primary-button" type="button" ${ai.running ? 'disabled' : ''}>
          ${ai.running ? '제작 중...' : '🎬 완성 영상 만들기'}
        </button>
        ${progressHtml()}
      </section>

      ${ai.status ? `<p class="wiz-status${ai.statusIsError ? ' wiz-status-error' : ''}">${esc(ai.status)}</p>` : ''}
      ${
        ai.resultVideo
          ? `<section class="wizard-step"><h3>완성 영상</h3><video controls class="wiz-result" src="${ai.resultVideo}"></video></section>`
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

  on('#aiUploadBtn', 'click', guard(async () => {
    const input = root.querySelector('#aiCaptures');
    await uploadCaptures(Array.from(input?.files ?? []));
  }));
  on('#aiAnalyzeBtn', 'click', guard(analyzeCaptures));
  on('#aiScriptBtn', 'click', guard(generateScript));
  on('#aiRunBtn', 'click', guard(startPipeline));
  on('#aiCancelBtn', 'click', guard(cancelJob));
  on('#aiProductName', 'input', (e) => {
    ai.productInfo = { ...ai.productInfo, productName: e.target.value };
  });
  on('#aiBenefit', 'input', (e) => {
    ai.productInfo = { ...ai.productInfo, benefit: e.target.value };
  });
  on('#aiPainPoint', 'input', (e) => {
    ai.productInfo = { ...ai.productInfo, painPoint: e.target.value };
  });
  on('#aiPricePoint', 'input', (e) => {
    ai.productInfo = { ...ai.productInfo, pricePoint: e.target.value };
  });
  on('#aiAffiliateUrl', 'input', (e) => {
    ai.affiliateUrl = e.target.value;
  });
  on('#aiScript', 'input', (e) => {
    ai.script = e.target.value;
  });
  on('#aiDuration', 'change', (e) => {
    ai.durationSec = e.target.value;
  });
  on('#aiVoice', 'change', (e) => {
    ai.selectedVoice = e.target.value;
  });
  on('#aiStyle', 'change', (e) => {
    ai.narrationStyle = e.target.value;
  });
  on('#aiImageEngine', 'change', (e) => {
    ai.imageEngine = e.target.value;
  });
  on('#aiMotionEngine', 'change', (e) => {
    ai.motionEngine = e.target.value;
  });
}
