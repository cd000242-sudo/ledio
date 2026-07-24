/* global Blob, FileReader, MediaRecorder, URL, clearInterval, document, fetch, navigator, setInterval, setTimeout, window */
/**
 * 원클릭 스토리 쇼츠 위저드.
 * 자체 상태를 갖는 독립 모듈 — app.js 내부 상태에 의존하지 않는다.
 * 흐름: ① 목소리 → ② 대본 → ③ 만들기 → 결과
 */

import { getSettings, updateSettings } from './settings.js';
import { scriptToCaptionCues } from './edit-workbench.js';

// ── 대본 → SRT 변환/다운로드 ──

function srtTimestamp(ms) {
  const safe = Math.max(0, Math.round(ms));
  const hours = String(Math.floor(safe / 3600000)).padStart(2, '0');
  const minutes = String(Math.floor((safe % 3600000) / 60000)).padStart(2, '0');
  const seconds = String(Math.floor((safe % 60000) / 1000)).padStart(2, '0');
  const millis = String(safe % 1000).padStart(3, '0');
  return `${hours}:${minutes}:${seconds},${millis}`;
}

function scriptToSrt(script, durationSec) {
  const cues = scriptToCaptionCues(script, {
    durationSec: Math.max(5, Number(durationSec) || 30),
    maxChars: 28,
    minCueMs: 800,
  });
  if (cues.length === 0) throw new Error('SRT로 변환할 문장이 없습니다.');
  return (
    cues
      .map((cue, index) => `${index + 1}\n${srtTimestamp(cue.startMs)} --> ${srtTimestamp(cue.endMs)}\n${cue.text}`)
      .join('\n\n') + '\n'
  );
}

function downloadTextFile(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

function safeSrtName(title) {
  return `${String(title || '대본').replace(/[<>:"/\\|?*]+/g, '-').slice(0, 60)}.srt`;
}

const wizard = {
  voices: [],
  typecastVoices: [],
  templates: [],
  selectedVoice: '',
  selectedTemplate: '',
  topic: '',
  script: '',
  scriptMethod: 'api-gpt',
  directedNarration: true,
  narrationStyle: 'storyteller',
  narrationStrength: '2',
  customNarrationStyle: '',
  bgmFile: null,
  scriptAudio: null,
  ratio: '9:16',
  jobs: [],
  jobsTimer: null,
  jobsContainer: null,
  tone: '이야기꾼',
  genre: '',
  seriesMode: 'single',
  seriesEpisode: '1',
  seriesPrevious: '',
  durationSec: '30',
  generatedImages: [],
  startedProjectName: '',
  seriesScripts: null,
  motionMode: 'none',
  motionEngine: 'seedance',
  projectName: '',
  imageProvider: 'mock',
  running: false,
  elapsed: 0,
  timer: null,
  status: '',
  resultVideo: '',
  testAudioUrl: '',
  recording: null,
  recordedBlob: null,
  // 새 목소리 등록 폼 상태 — 다시 그려도 접힘/입력값이 유지되게 한다.
  registerOpen: false,
  voiceName: '',
  voiceTranscript: '',
  voiceFile: null,
};

let narrationStyles = [];

function narrationStyleOptions(selectedId) {
  if (narrationStyles.length === 0) return '<option value="natural">자연스러운 낭독</option>';
  const groups = new Map();
  for (const style of narrationStyles) {
    if (!groups.has(style.group)) groups.set(style.group, []);
    groups.get(style.group).push(style);
  }
  return [...groups.entries()]
    .map(
      ([group, styles]) =>
        `<optgroup label="${esc(group)}">${styles
          .map(
            (style) =>
              `<option value="${esc(style.id)}"${style.id === selectedId ? ' selected' : ''}>${esc(style.label)} — ${esc(style.description)}</option>`,
          )
          .join('')}</optgroup>`,
    )
    .join('');
}

function narrationStyleLabel(styleId) {
  return narrationStyles.find((style) => style.id === styleId)?.label ?? '자연스러운 낭독';
}

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

async function loadWizardData() {
  try {
    const [voicesData, templatesData, stylesData] = await Promise.all([
      api('/api/voices'),
      api('/api/script-templates'),
      api('/api/narration-styles'),
    ]);
    wizard.voices = voicesData.voices;
    wizard.templates = templatesData.templates;
    narrationStyles = stylesData.styles || [];
    await loadTypecastVoices();
    if (!wizard.selectedVoice) {
      // 기본 목소리 설정이 있으면 그걸 먼저, 없으면 첫 번째 목소리.
      const preferred = getSettings().defaultVoice;
      if (isTypecastVoiceValue(preferred)) {
        wizard.selectedVoice = preferred;
      } else {
        const found = wizard.voices.find((voice) => voice.name === preferred);
        wizard.selectedVoice = found ? found.name : (wizard.voices[0]?.name ?? '');
      }
    }
  } catch (error) {
    wizard.status = `불러오기 실패: ${error.message}`;
  }
}

/** typecast:<voice_id> 값(타입캐스트 AI 성우)인지 확인한다. */
function isTypecastVoiceValue(value) {
  return String(value ?? '').startsWith('typecast:');
}

/** 낭독 요청에 함께 보낼 타입캐스트 API 키(설정에 있을 때만). */
function typecastKeyBody() {
  const key = (getSettings().typecastApiKey || '').trim();
  return key ? { typecastApiKey: key } : {};
}

/** 목소리 값의 표시 이름 — 타입캐스트 성우면 성우 이름, 아니면 그대로. */
function voiceDisplayName(value) {
  if (!isTypecastVoiceValue(value)) return value;
  const id = String(value).slice('typecast:'.length);
  const found = wizard.typecastVoices.find((voice) => voice.id === id);
  return found ? `AI 성우 ${found.name}` : 'AI 성우';
}

/** 환경설정에 타입캐스트 키가 있으면 성우 목록을 불러온다(실패해도 조용히 넘어간다). */
async function loadTypecastVoices() {
  const key = (getSettings().typecastApiKey || '').trim();
  if (!key) {
    wizard.typecastVoices = [];
    return;
  }
  try {
    const data = await api('/api/typecast/voices', { headers: { 'x-typecast-key': key } });
    wizard.typecastVoices = data.voices || [];
  } catch {
    wizard.typecastVoices = [];
  }
}

/** 환경설정 탭으로 이동한다(상단 탭 버튼 클릭과 동일). */
function goToSettingsTab() {
  const button = [...document.querySelectorAll('.main-tabs .tab-button')].find(
    (el) => el.textContent === '환경설정',
  );
  button?.click();
}

/**
 * 첫 실행 안내 카드 — 대본 생성 수단(API 키)이나 목소리가 아직 없을 때만 보인다.
 * 준비가 끝나면 자동으로 사라진다(별도 닫기 버튼·저장 상태 불필요).
 */
function onboardingHtml() {
  const settings = getSettings();
  const hasScriptKey = Boolean(
    `${settings.openaiApiKey || ''}${settings.geminiApiKey || ''}${settings.anthropicApiKey || ''}`.trim(),
  );
  const hasVoice = wizard.voices.length > 0 || wizard.typecastVoices.length > 0;
  if (hasScriptKey && hasVoice) return '';
  const step = (done, html) => `<li${done ? ' class="onboard-done"' : ''}>${done ? '✅' : '⬜'} ${html}</li>`;
  return `
    <section class="wizard-step onboard-card">
      <h3>🚀 처음이신가요? 두 가지만 준비하면 바로 만들 수 있어요</h3>
      <ol class="onboard-steps">
        ${step(
          hasScriptKey,
          '<strong>AI 키 준비</strong> — 환경설정에서 OpenAI·Gemini·Claude 키 중 하나를 입력하세요. 키가 없어도 Claude Code/Codex 로그인으로 대본 생성이 됩니다.',
        )}
        ${step(
          hasVoice,
          '<strong>목소리 준비</strong> — 아래 ①에서 내 목소리를 10~30초 녹음해 등록하거나, 환경설정에 타입캐스트 API 키를 넣으면 전문 AI 성우를 바로 쓸 수 있어요.',
        )}
        ${step(
          false,
          '<strong>만들기</strong> — ②에서 주제를 넣고 AI 대본 생성 → 맨 아래 ‘영상 만들기’를 누르면 이미지·낭독·자막·렌더까지 자동으로 끝납니다.',
        )}
      </ol>
      <div class="field-grid">
        <button id="wizGoSettingsBtn" class="ghost-button" type="button">⚙️ 환경설정 열기</button>
      </div>
      <p class="wiz-hint">💡 키가 아직 없어도 체험할 수 있어요 — 이미지 생성기를 ‘테스트’로, 목소리를 ‘나레이션 없이’로 두고 실행해 보세요.</p>
    </section>
  `;
}

/** 타입캐스트 성우 optgroup HTML — 목록이 없으면 빈 문자열. */
function typecastOptionsHtml(selected) {
  if (wizard.typecastVoices.length === 0) return '';
  return (
    '<optgroup label="🎭 타입캐스트 AI 성우">' +
    wizard.typecastVoices
      .map(
        (voice) =>
          `<option value="typecast:${esc(voice.id)}"${`typecast:${voice.id}` === selected ? ' selected' : ''}>${esc(voice.name)}</option>`,
      )
      .join('') +
    '</optgroup>'
  );
}

function fillTemplate(template, vars) {
  const lines = [
    ...template.beats.hook,
    ...template.beats.build,
    ...template.beats.twist,
    ...template.beats.cta,
  ];
  return lines
    .map((line) => line.replace(/\{([^}]+)\}/g, (match, name) => vars[name] || match))
    .join('\n');
}

function applyTemplate() {
  const template = wizard.templates.find((t) => t.key === wizard.selectedTemplate);
  if (!template) return;
  wizard.script = fillTemplate(template, { 주제: wizard.topic });
}

async function toggleRecording(container) {
  wizard.registerOpen = true;
  if (wizard.recording) {
    wizard.recording.stop();
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    recorder.onstop = () => {
      wizard.recordedBlob = new Blob(chunks, { type: recorder.mimeType });
      wizard.recording = null;
      stream.getTracks().forEach((track) => track.stop());
      renderWizard(container);
    };
    recorder.start();
    wizard.recording = recorder;
    renderWizard(container);
  } catch (error) {
    wizard.status = `마이크 사용 불가: ${error.message}`;
    renderWizard(container);
  }
}

// ── 목소리 생성 모달: 저장→생성→완성을 최상단 오버레이로 보여준다 ──

const voiceModal = { root: null, pill: null, timer: null, elapsed: 0, minimized: false, running: false };

function ensureVoiceModal() {
  if (voiceModal.root) return voiceModal.root;
  const root = document.createElement('div');
  root.className = 'voice-modal-backdrop';
  root.hidden = true;
  root.innerHTML = `
    <div class="voice-modal" role="dialog" aria-modal="true" aria-labelledby="voiceModalTitle">
      <div class="voice-modal-visual"><span></span><span></span><span></span><span></span><span></span></div>
      <h3 id="voiceModalTitle"></h3>
      <p id="voiceModalDesc"></p>
      <div id="voiceModalGauge" class="voice-modal-gauge" hidden>
        <div class="voice-modal-gauge-track"><div id="voiceModalGaugeFill" class="voice-modal-gauge-fill"></div></div>
        <span id="voiceModalGaugeText"></span>
      </div>
      <p id="voiceModalElapsed"></p>
      <audio id="voiceModalAudio" controls hidden></audio>
      <div class="voice-modal-actions">
        <button id="voiceModalMinBtn" class="ghost-button" type="button" hidden>⬇ 최소화 — 다른 작업 하기</button>
        <button id="voiceModalStopBtn" class="ghost-button voice-modal-stop" type="button" hidden>⏹ 중지</button>
        <button id="voiceModalCloseBtn" class="primary-button" type="button" hidden>닫기</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  root.querySelector('#voiceModalCloseBtn').addEventListener('click', closeVoiceModal);
  root.querySelector('#voiceModalMinBtn').addEventListener('click', minimizeVoiceModal);
  root.querySelector('#voiceModalStopBtn').addEventListener('click', stopVoiceGeneration);

  // 최소화 시 화면 아래에 떠 있는 진행 알약 — 클릭하면 모달 복귀.
  const pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'voice-mini-pill';
  pill.hidden = true;
  pill.innerHTML = '<span class="voice-mini-pill-bar"><i></i></span><span class="voice-mini-pill-text"></span>';
  pill.addEventListener('click', restoreVoiceModal);
  document.body.appendChild(pill);
  voiceModal.pill = pill;
  voiceModal.root = root;
  return root;
}

function updateVoicePill(text, percent) {
  if (!voiceModal.pill) return;
  voiceModal.pill.querySelector('.voice-mini-pill-text').textContent = text;
  const bar = voiceModal.pill.querySelector('.voice-mini-pill-bar i');
  if (percent !== undefined) bar.style.width = `${Math.max(4, percent)}%`;
}

function minimizeVoiceModal() {
  const root = ensureVoiceModal();
  voiceModal.minimized = true;
  root.hidden = true;
  voiceModal.pill.hidden = false;
  voiceModal.pill.classList.remove('done', 'error');
  if (voiceModal.running) {
    updateVoicePill(`작업 중... ${voiceModal.elapsed}초 경과`, 4);
  } else {
    // 완성/실패 후 최소화 — 오디오는 계속 재생되고, 알약을 누르면 다시 열린다.
    const failed = root.classList.contains('error');
    voiceModal.pill.classList.add(failed ? 'error' : 'done');
    updateVoicePill(failed ? '❌ 실패 — 클릭해서 확인' : '✅ 낭독 재생 중 — 클릭해서 열기', 100);
  }
}

function restoreVoiceModal() {
  const root = ensureVoiceModal();
  voiceModal.minimized = false;
  voiceModal.pill.hidden = true;
  root.hidden = false;
}

async function stopVoiceGeneration() {
  if (!voiceModal.progressVoice) return;
  try {
    await fetch('/api/voices/test/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ voice: voiceModal.progressVoice }),
    });
  } catch {
    /* 서버 응답 실패해도 아래에서 모달은 닫는다 */
  }
  closeVoiceModal();
}

function setVoiceModalStage(title, desc) {
  const root = ensureVoiceModal();
  root.querySelector('#voiceModalTitle').textContent = title;
  root.querySelector('#voiceModalDesc').textContent = desc;
}

/** 낭독 진행 파일을 읽어 게이지바를 갱신한다. */
async function refreshVoiceModalGauge(root) {
  if (!voiceModal.progressVoice || voiceModal.polling) return;
  voiceModal.polling = true;
  try {
    const res = await fetch(`/api/voices/progress?voice=${encodeURIComponent(voiceModal.progressVoice)}`);
    const data = await res.json();
    const progress = data.progress;
    if (!progress) return;
    const gauge = root.querySelector('#voiceModalGauge');
    const fill = root.querySelector('#voiceModalGaugeFill');
    const text = root.querySelector('#voiceModalGaugeText');
    gauge.hidden = false;
    let percent;
    let label = '';
    if (progress.status === 'directing') {
      percent = 5;
      label = 'AI가 대본 분위기를 분석해 연출을 잡는 중...';
    } else if (progress.status === 'merging') {
      percent = 100;
      label = '조각을 하나로 이어 붙이는 중...';
    } else if (progress.total > 0) {
      percent = Math.round((progress.done / progress.total) * 100);
      label = `${progress.done}/${progress.total} 덩어리 생성 (${percent}%)`;
    }
    if (label) {
      fill.style.width = `${Math.max(4, percent)}%`;
      text.textContent = label;
      if (voiceModal.minimized) updateVoicePill(label, percent);
    }
  } catch {
    /* 진행 조회 실패는 게이지만 멈출 뿐 */
  } finally {
    voiceModal.polling = false;
  }
}

function openVoiceModal(title, desc, progressVoice = '') {
  const root = ensureVoiceModal();
  root.hidden = false;
  root.classList.remove('done', 'error');
  setVoiceModalStage(title, desc);
  const audio = root.querySelector('#voiceModalAudio');
  audio.pause();
  audio.hidden = true;
  root.querySelector('#voiceModalCloseBtn').hidden = true;
  root.querySelector('#voiceModalMinBtn').hidden = false;
  root.querySelector('#voiceModalStopBtn').hidden = !progressVoice;
  voiceModal.elapsed = 0;
  voiceModal.progressVoice = progressVoice;
  voiceModal.polling = false;
  voiceModal.minimized = false;
  voiceModal.running = true;
  voiceModal.pill.hidden = true;
  const gauge = root.querySelector('#voiceModalGauge');
  gauge.hidden = true;
  root.querySelector('#voiceModalGaugeFill').style.width = '0%';
  const elapsedEl = root.querySelector('#voiceModalElapsed');
  elapsedEl.hidden = false;
  elapsedEl.textContent = '0초 경과 · 보통 30초~1분 걸려요';
  clearInterval(voiceModal.timer);
  voiceModal.timer = setInterval(() => {
    voiceModal.elapsed += 1;
    elapsedEl.textContent = `${voiceModal.elapsed}초 경과 · 보통 30초~1분 걸려요`;
    if (voiceModal.minimized && !voiceModal.progressVoice) {
      updateVoicePill(`작업 중... ${voiceModal.elapsed}초 경과`, 4);
    }
    if (voiceModal.elapsed % 2 === 0) refreshVoiceModalGauge(root);
  }, 1000);
}

function finishVoiceModal({ title, desc, audioUrl, error }) {
  const root = ensureVoiceModal();
  clearInterval(voiceModal.timer);
  voiceModal.timer = null;
  voiceModal.progressVoice = '';
  voiceModal.running = false;
  root.querySelector('#voiceModalGauge').hidden = true;
  root.querySelector('#voiceModalElapsed').hidden = true;
  root.classList.add(error ? 'error' : 'done');
  setVoiceModalStage(title, desc);
  const audio = root.querySelector('#voiceModalAudio');
  if (audioUrl) {
    audio.src = audioUrl;
    audio.hidden = false;
    // 최소화 상태에서는 사용자가 알약을 눌러 열 때 듣게 한다(작업 중 갑자기 소리 안 나게).
    if (!voiceModal.minimized) audio.play().catch(() => {});
  }
  // 완성 후에도 최소화는 가능하게 둔다 — 낭독을 들으면서 다른 작업을 할 수 있게.
  root.querySelector('#voiceModalMinBtn').hidden = false;
  root.querySelector('#voiceModalStopBtn').hidden = true;
  root.querySelector('#voiceModalCloseBtn').hidden = false;
  if (voiceModal.minimized) {
    // 모달은 숨긴 채 알약만 완료/실패 상태로 바꾼다 — 클릭하면 결과 모달이 열린다.
    voiceModal.pill.classList.add(error ? 'error' : 'done');
    updateVoicePill(error ? '❌ 실패 — 클릭해서 확인' : '✅ 완성 — 클릭해서 듣기', 100);
  }
}

function closeVoiceModal() {
  if (!voiceModal.root) return;
  clearInterval(voiceModal.timer);
  voiceModal.timer = null;
  voiceModal.running = false;
  voiceModal.minimized = false;
  voiceModal.progressVoice = '';
  if (voiceModal.pill) voiceModal.pill.hidden = true;
  voiceModal.root.querySelector('#voiceModalAudio').pause();
  voiceModal.root.hidden = true;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]+,/, ''));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function saveVoice(container) {
  const name = wizard.voiceName.trim();
  const transcript = wizard.voiceTranscript.trim();
  const file = wizard.voiceFile;
  const source = wizard.recordedBlob || file;
  if (!name) throw new Error('목소리 이름을 입력해 주세요.');
  if (!source) throw new Error('녹음하거나 음성 파일을 선택해 주세요.');

  const format = wizard.recordedBlob
    ? (wizard.recordedBlob.type.includes('ogg') ? 'ogg' : 'webm')
    : (file.name.split('.').pop() || 'wav').toLowerCase();

  wizard.status = '목소리 저장 중(변환 포함)...';
  renderWizard(container);
  const data = await api('/api/voices', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, transcript, format, audioData: await blobToBase64(source) }),
  });
  wizard.recordedBlob = null;
  wizard.voiceName = '';
  wizard.voiceTranscript = '';
  wizard.voiceFile = null;
  wizard.registerOpen = false;
  wizard.selectedVoice = data.name;
  wizard.status = `목소리 저장 완료: ${data.name}${data.hasTranscript ? ' (+전사)' : ''} — 테스트 음성을 만드는 중입니다.`;
  await loadWizardData();
}

async function testVoice(container) {
  if (!wizard.selectedVoice) throw new Error('먼저 목소리를 선택해 주세요.');
  wizard.status = '테스트 음성 생성 중(GPU, 30초~1분)...';
  wizard.testAudioUrl = '';
  renderWizard(container);
  // sample 모드: 한 번 만든 테스트 음성은 저장해 두고 재사용한다.
  const data = await api('/api/voices/test', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ voice: wizard.selectedVoice, sample: true, ...typecastKeyBody() }),
  });
  wizard.testAudioUrl = `${data.audioUrl}&t=${Date.now()}`;
  wizard.status = '테스트 음성 완성 — 아래에서 들어보세요.';
}

const STAGE_LABELS = {
  images: '이미지 생성',
  narrate: '나레이션 생성',
  clips: '장면 클립 만들기',
  render: '최종 렌더',
};

function stopTimer() {
  if (wizard.timer) clearInterval(wizard.timer);
  wizard.timer = null;
}

// ── 작업 패널: 복수 파이프라인 작업을 카드로 병렬 표시 ──
const JOB_STATUS_LABELS = { queued: '대기 중', running: '진행 중', done: '완성', error: '실패', cancelled: '중지됨' };

function activeJobCount() {
  return wizard.jobs.filter((job) => job.status === 'running' || job.status === 'queued').length;
}

function jobPercent(job) {
  if (job.status === 'done') return 100;
  const progress = job.progress;
  if (!progress || !progress.stages?.length) return job.status === 'running' ? 5 : 0;
  const total = progress.stages.length;
  let fraction = 0;
  if (job.status === 'running' && progress.current === 'images' && job.projectName === wizard.startedProjectName) {
    const totalScenes = wizard.script.split('\n').map((line) => line.trim()).filter(Boolean).length || 1;
    fraction = Math.min(0.95, wizard.generatedImages.length / totalScenes);
  } else if (job.status === 'running') {
    fraction = 0.15;
  }
  return Math.round(((progress.completed.length + fraction) / total) * 100);
}

function renderJobsPanel(container) {
  const panel = container?.querySelector('#wizJobsPanel');
  if (!panel) return;
  if (wizard.jobs.length === 0) {
    panel.innerHTML = '';
    return;
  }
  panel.innerHTML = wizard.jobs
    .map((job) => {
      const percent = jobPercent(job);
      const stage = job.progress?.current ? STAGE_LABELS[job.progress.current] || job.progress.current : '';
      const badgeClass = job.status === 'done' ? ' good' : job.status === 'error' ? ' danger' : '';
      return `
        <article class="job-card job-${esc(job.status)}" data-id="${esc(job.id)}">
          <div class="job-card-head">
            <strong>${esc(job.title || job.projectName || job.id)}</strong>
            <span class="soft-badge${badgeClass}">${JOB_STATUS_LABELS[job.status] || esc(job.status)}${
              job.status === 'queued' && job.queuePosition ? ` · ${job.queuePosition}번째` : ''
            }</span>
          </div>
          <div class="wiz-progress"><div class="wiz-progress-bar" style="width:${Math.max(4, percent)}%"></div></div>
          <div class="wiz-progress-meta">
            <span class="wiz-hint">${
              job.status === 'running'
                ? `진행 중: ${esc(stage)}`
                : job.status === 'error'
                  ? `⚠️ ${esc(String(job.stderrTail || '실패').split('\n').filter(Boolean).at(-1) || '실패')}`
                  : ''
            }</span>
            <span class="wiz-hint">${percent}%</span>
          </div>
          ${job.logTail?.length ? `<pre class="wiz-log">${esc(job.logTail.join('\n'))}</pre>` : ''}
          <div class="job-card-actions">
            ${
              job.status === 'running' || job.status === 'queued'
                ? '<button class="mini-button mini-danger" type="button" data-action="cancel">⏹ 중지</button>'
                : ''
            }
            ${job.status === 'done' ? '<button class="mini-button" type="button" data-action="watch">▶ 결과 보기</button>' : ''}
          </div>
        </article>
      `;
    })
    .join('');
  for (const card of panel.querySelectorAll('.job-card')) {
    const id = card.dataset.id;
    card.querySelector('[data-action="cancel"]')?.addEventListener('click', async () => {
      await fetch(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
    });
    card.querySelector('[data-action="watch"]')?.addEventListener('click', () => {
      const job = wizard.jobs.find((entry) => entry.id === id);
      if (!job?.projectName) return;
      wizard.resultVideo = `/api/media/preview?projectPath=${encodeURIComponent(
        `projects/${job.projectName}`,
      )}&file=${encodeURIComponent('pipeline/video/output/video_01.mp4')}`;
      renderWizard(wizard.jobsContainer);
    });
  }
}

/** 작업 목록 폴링 — 진행 중 작업이 하나라도 있으면 2초마다 갱신한다. */
function ensureJobsPolling(container) {
  wizard.jobsContainer = container;
  if (wizard.jobsTimer) return;
  const tick = async () => {
    try {
      const data = await api('/api/jobs');
      wizard.jobs = data.jobs || [];
      renderJobsPanel(wizard.jobsContainer);
      await refreshWizardImages(wizard.jobsContainer);
      if (activeJobCount() === 0 && wizard.jobsTimer) {
        clearInterval(wizard.jobsTimer);
        wizard.jobsTimer = null;
      }
    } catch {
      /* 다음 틱에서 재시도 */
    }
  };
  wizard.jobsTimer = setInterval(tick, 2000);
  tick();
}

/** 파이프라인이 만든 이미지를 그리드로 실시간 표시한다. */
async function refreshWizardImages(container) {
  if (!wizard.startedProjectName) return;
  try {
    const data = await api(`/api/project/images?projectName=${encodeURIComponent(wizard.startedProjectName)}`);
    const urls = (data.images || []).map(
      (file) =>
        `/api/media/preview?projectPath=${encodeURIComponent(data.projectPath)}&file=${encodeURIComponent(file)}`,
    );
    if (urls.length === wizard.generatedImages.length) return;
    wizard.generatedImages = urls;
    const grid = container.querySelector('#wizImageGrid');
    if (grid) grid.innerHTML = wizardImageTiles();
    const badge = container.querySelector('#wizImageCount');
    if (badge) badge.textContent = `${urls.length}장`;
  } catch {
    /* 아직 이미지 생성 전 */
  }
}

function wizardImageTiles() {
  return wizard.generatedImages
    .map(
      (src, index) =>
        `<figure class="wiz-image-tile"><img src="${esc(src)}" alt="장면 ${index + 1}" loading="lazy" decoding="async" /><figcaption>장면 ${index + 1}</figcaption></figure>`,
    )
    .join('');
}

// ── 오디오 독: 화면을 다시 그려도 재생이 끊기지 않는 하단 고정 플레이어 ──
let audioDock = null;

function openAudioDock(src, title = '') {
  if (!audioDock) {
    audioDock = document.createElement('div');
    audioDock.className = 'audio-dock';
    audioDock.innerHTML = `
      <span class="audio-dock-title"></span>
      <audio controls></audio>
      <button class="mini-button" type="button" title="플레이어 닫기">✕</button>
    `;
    audioDock.querySelector('button').addEventListener('click', () => {
      audioDock.querySelector('audio').pause();
      audioDock.hidden = true;
    });
    document.body.appendChild(audioDock);
  }
  audioDock.hidden = false;
  audioDock.querySelector('.audio-dock-title').textContent = title;
  const audio = audioDock.querySelector('audio');
  const absolute = new URL(src, window.location.href).href;
  // 같은 파일이면 이어서 재생하고, 다른 파일일 때만 처음부터 재생한다.
  if (audio.src !== absolute) {
    audio.src = absolute;
  }
  audio.play().catch(() => {});
}

// ── 이미지 라이트박스: 클릭하면 크게 보고, ←/→ 로 이전·다음 이미지를 넘긴다 ──
let lightboxRoot = null;
const lightboxState = { items: [], index: 0 };

function renderLightboxCurrent() {
  const item = lightboxState.items[lightboxState.index];
  if (!item) return;
  const multi = lightboxState.items.length > 1;
  lightboxRoot.querySelector('img').src = item.src;
  lightboxRoot.querySelector('figcaption').textContent = multi
    ? `${item.caption} (${lightboxState.index + 1}/${lightboxState.items.length})`
    : item.caption;
  lightboxRoot.querySelector('.lightbox-prev').hidden = !multi;
  lightboxRoot.querySelector('.lightbox-next').hidden = !multi;
}

function stepLightbox(delta) {
  const count = lightboxState.items.length;
  if (count < 2) return;
  lightboxState.index = (lightboxState.index + delta + count) % count;
  renderLightboxCurrent();
}

/** items: [{src, caption}] 배열 + 시작 인덱스. 단일 이미지는 문자열로도 호출 가능. */
function openLightbox(itemsOrSrc, indexOrCaption = 0) {
  if (!lightboxRoot) {
    lightboxRoot = document.createElement('div');
    lightboxRoot.className = 'lightbox-backdrop';
    lightboxRoot.innerHTML = `
      <button class="lightbox-arrow lightbox-prev" type="button" aria-label="이전 이미지">‹</button>
      <figure class="lightbox-figure"><img alt="확대 이미지" /><figcaption></figcaption></figure>
      <button class="lightbox-arrow lightbox-next" type="button" aria-label="다음 이미지">›</button>
    `;
    lightboxRoot.addEventListener('click', () => {
      lightboxRoot.hidden = true;
    });
    lightboxRoot.querySelector('.lightbox-prev').addEventListener('click', (e) => {
      e.stopPropagation();
      stepLightbox(-1);
    });
    lightboxRoot.querySelector('.lightbox-next').addEventListener('click', (e) => {
      e.stopPropagation();
      stepLightbox(1);
    });
    document.addEventListener('keydown', (e) => {
      if (!lightboxRoot || lightboxRoot.hidden) return;
      if (e.key === 'Escape') lightboxRoot.hidden = true;
      if (e.key === 'ArrowLeft') stepLightbox(-1);
      if (e.key === 'ArrowRight') stepLightbox(1);
    });
    document.body.appendChild(lightboxRoot);
  }
  if (typeof itemsOrSrc === 'string') {
    lightboxState.items = [{ src: itemsOrSrc, caption: String(indexOrCaption || '') }];
    lightboxState.index = 0;
  } else {
    lightboxState.items = itemsOrSrc;
    lightboxState.index = Math.max(0, Math.min(Number(indexOrCaption) || 0, itemsOrSrc.length - 1));
  }
  renderLightboxCurrent();
  lightboxRoot.hidden = false;
}

/** 이미지 보관함 탭: 지금까지 생성된 모든 이미지를 모아 보고 확대/저장한다. */
export function renderImageGalleryTab(container) {
  container.innerHTML = '<div class="wizard-panel"><p class="wiz-hint">이미지를 불러오는 중...</p></div>';
  api('/api/gallery/images')
    .then((data) => {
      const images = data.images || [];
      if (images.length === 0) {
        container.innerHTML =
          '<div class="wizard-panel"><section class="wizard-step"><h3>이미지 보관함</h3><p class="wiz-hint">아직 생성된 이미지가 없습니다. AI 숏폼 만들기에서 영상을 생성하면 장면 이미지가 여기에 쌓입니다.</p></section></div>';
        return;
      }
      // 프로젝트(대본 제목)별 폴더로 묶어서 보여준다.
      const byProject = new Map();
      for (const image of images) {
        if (!byProject.has(image.project)) byProject.set(image.project, { title: image.title || image.project, items: [] });
        byProject.get(image.project).items.push(image);
      }
      container.innerHTML = `
        <div class="wizard-panel">
          <section class="wizard-step">
            <h3>이미지/영상 보관함 <span class="soft-badge">${images.length}개</span></h3>
            <p class="wiz-hint">지금까지 생성한 장면 이미지·영상화 클립·완성 영상입니다. 이미지는 클릭하면 크게 보이고, 영상은 바로 재생됩니다. ⬇로 저장해 재사용하세요.</p>
            ${[...byProject.entries()]
              .map(
                ([project, group]) => `
                  <details class="gallery-group" data-project="${esc(project)}" open>
                    <summary>
                      <strong>📁 ${esc(group.title)}</strong> <span class="soft-badge">${group.items.length}장</span>
                      <span class="gallery-group-actions">
                        <button class="mini-button" type="button" data-action="download-all">⬇ 전체 다운로드</button>
                        <button class="mini-button mini-danger" type="button" data-action="delete-all">🗑 전체 삭제</button>
                      </span>
                    </summary>
                    <div class="wiz-image-grid">
                      ${group.items
                        .map(
                          (image) => `
                            <figure class="wiz-image-tile gallery-tile" data-type="${esc(image.type || 'image')}" data-url="${esc(image.url)}" data-project="${esc(project)}" data-file="${esc(image.file)}" data-name="${esc(`${group.title}-${image.file.split('/').pop()}`)}">
                              ${
                                image.type === 'video'
                                  ? `<video src="${esc(image.url)}" preload="metadata" controls></video>`
                                  : `<img src="${esc(image.url)}" alt="${esc(image.file)}" loading="lazy" decoding="async" />`
                              }
                              <figcaption>
                                <span>${image.type === 'video' ? '🎬 ' : ''}${esc(image.file.split('/').pop())}</span>
                                <span class="gallery-tile-actions">
                                  <button class="mini-button" type="button" data-action="download" title="다운로드">⬇</button>
                                  <button class="mini-button mini-danger" type="button" data-action="delete" title="삭제">🗑</button>
                                </span>
                              </figcaption>
                            </figure>
                          `,
                        )
                        .join('')}
                    </div>
                  </details>
                `,
              )
              .join('')}
          </section>
        </div>
      `;
      // 폴더 단위 전체 다운로드/삭제
      for (const group of container.querySelectorAll('.gallery-group')) {
        const projectName = group.dataset.project;
        const tiles = () => [...group.querySelectorAll('.gallery-tile')];
        group.querySelector('[data-action="download-all"]').addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          // 브라우저가 파일을 하나씩 저장하도록 간격을 두고 순차 다운로드한다.
          tiles().forEach((tile, index) => {
            setTimeout(() => {
              const link = document.createElement('a');
              link.href = tile.dataset.url;
              link.download = tile.dataset.name;
              link.click();
            }, index * 300);
          });
        });
        group.querySelector('[data-action="delete-all"]').addEventListener('click', async (e) => {
          e.preventDefault();
          e.stopPropagation();
          const count = tiles().length;
          if (!window.confirm(`이 폴더의 이미지 ${count}장을 전부 삭제할까요?`)) return;
          try {
            await api('/api/gallery/delete-project', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ project: projectName }),
            });
            renderImageGalleryTab(container);
          } catch (error) {
            group.insertAdjacentHTML('beforeend', `<p class="wiz-status">${esc(error.message)}</p>`);
          }
        });
      }

      const allTiles = [...container.querySelectorAll('.gallery-tile')];
      // 라이트박스 넘기기는 이미지끼리만 — 영상은 타일에서 바로 재생한다.
      const imageTiles = allTiles.filter((tile) => tile.dataset.type !== 'video');
      const lightboxItems = imageTiles.map((entry) => ({ src: entry.dataset.url, caption: entry.dataset.name }));
      for (const tile of allTiles) {
        tile.querySelector('img')?.addEventListener('click', () => {
          openLightbox(lightboxItems, imageTiles.indexOf(tile));
        });
        tile.querySelector('[data-action="download"]').addEventListener('click', (e) => {
          e.stopPropagation();
          const link = document.createElement('a');
          link.href = tile.dataset.url;
          link.download = tile.dataset.name;
          link.click();
        });
        tile.querySelector('[data-action="delete"]').addEventListener('click', async (e) => {
          e.stopPropagation();
          if (!window.confirm('이 이미지를 삭제할까요?')) return;
          try {
            await api('/api/gallery/delete', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ project: tile.dataset.project, file: tile.dataset.file }),
            });
            tile.remove();
          } catch (error) {
            container.querySelector('.wizard-step')?.insertAdjacentHTML('beforeend', `<p class="wiz-status">${esc(error.message)}</p>`);
          }
        });
      }
    })
    .catch((error) => {
      container.innerHTML = `<div class="wizard-panel"><p class="wiz-status">이미지 보관함 불러오기 실패: ${esc(error.message)}</p></div>`;
    });
}


async function generateScriptWithAi(container) {
  if (!wizard.topic.trim()) throw new Error('먼저 주제를 입력해 주세요.');
  const settings = getSettings();
  const keyMap = {
    'api-gpt': settings.openaiApiKey,
    'api-gemini': settings.geminiApiKey,
    'api-claude': settings.anthropicApiKey,
  };
  const fullSeries = wizard.seriesMode === 'series' && Number(wizard.seriesEpisode) > 1 && !wizard.seriesPrevious.trim();
  openVoiceModal(
    '대본 생성 중',
    fullSeries
      ? `'${wizard.topic}' 시리즈를 1화부터 ${wizard.seriesEpisode}화까지 순서대로 쓰고 있어요. 앞 화 전문을 이어받아 완성하니 몇 분 걸릴 수 있습니다.`
      : `'${wizard.topic}' 주제로 쇼츠 대본을 쓰고 있어요.`,
  );
  try {
    const data = await api('/api/script/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        method: wizard.scriptMethod,
        topic: wizard.topic,
        apiKey: keyMap[wizard.scriptMethod] || '',
        seriesEpisode: wizard.seriesMode === 'series' ? Number(wizard.seriesEpisode) || 1 : 0,
        seriesPrevious: wizard.seriesMode === 'series' ? wizard.seriesPrevious : '',
        durationSec: Number(wizard.durationSec) || 30,
        format: selectedTemplateLabel(),
        genre: wizard.genre,
        tone: wizard.tone,
      }),
    });
    wizard.script = data.script;
    wizard.seriesScripts = Array.isArray(data.episodes) ? data.episodes : null;
    // 새 대본에는 아직 낭독 녹음본이 없다.
    wizard.scriptAudio = null;
    saveScriptToLibrary().catch(() => {});
    wizard.status = wizard.seriesScripts
      ? `1~${wizard.seriesScripts.length}화 전체 대본 완성 — 회차를 바꾸면 해당 화 대본이 자동으로 들어갑니다.`
      : 'AI 대본 생성 완료 — 내용을 다듬고 쇼츠 만들기를 누르세요.';
    finishVoiceModal({
      title: wizard.seriesScripts ? `시리즈 ${wizard.seriesScripts.length}화 전체 완성` : '대본 완성',
      desc: wizard.seriesScripts
        ? '모든 회차가 이어지게 작성됐습니다. 회차 번호를 바꾸면 그 화의 대본이 대본칸에 들어갑니다.'
        : '대본을 확인하고 필요하면 수정하세요.',
    });
  } catch (error) {
    finishVoiceModal({ title: '대본 생성 실패', desc: error.message, error: true });
    throw error;
  }
  renderWizard(container);
}

/** 현재 대본을 보관함에 저장한다(생성 성공 시 자동 호출 + 수동 버튼 + 낭독 완료 시 오디오 포함). */
async function saveScriptToLibrary(audio = null) {
  if (!wizard.script.trim()) throw new Error('저장할 대본이 없습니다.');
  // 낭독이 연결된 대본은 수동 저장 때도 녹음본 링크를 유지한다.
  if (!audio && wizard.scriptAudio) audio = wizard.scriptAudio;
  await api('/api/scripts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      title: (wizard.topic || wizard.script.split('\n')[0]) + (audio ? ' (낭독 포함)' : ''),
      topic: wizard.topic,
      genre: wizard.genre,
      format: selectedTemplateLabel(),
      tone: wizard.tone,
      durationSec: Number(wizard.durationSec) || 30,
      script: wizard.script,
      episodes: wizard.seriesScripts,
      audio,
    }),
  });
}

/** 보관함 탭: 저장된 대본 목록 + 불러오기/삭제. */
export function renderScriptLibraryTab(container, onLoaded) {
  container.innerHTML = '<div class="wizard-panel"><p class="wiz-hint">보관함을 불러오는 중...</p></div>';
  api('/api/scripts')
    .then((data) => {
      const scripts = data.scripts || [];
      if (scripts.length === 0) {
        container.innerHTML =
          '<div class="wizard-panel"><section class="wizard-step"><h3>대본 보관함</h3><p class="wiz-hint">아직 저장된 대본이 없습니다. AI로 대본을 생성하면 자동으로 저장되고, 💾 버튼으로 직접 저장할 수도 있습니다.</p></section></div>';
        return;
      }
      container.innerHTML = `
        <div class="wizard-panel">
          <section class="wizard-step">
            <h3>대본 보관함 <span class="soft-badge">${scripts.length}개</span></h3>
            <div class="library-list">
              ${scripts
                .map(
                  (entry) => `
                    <article class="library-card" data-id="${esc(entry.id)}">
                      <div class="library-card-head">
                        <strong>${esc(entry.title)}</strong>
                        <span class="library-card-meta">
                          ${entry.audio ? '<span class="soft-badge duration-badge" data-field="duration" hidden></span>' : ''}
                          <span class="wiz-hint">${esc([entry.genre, entry.format, entry.tone, `${entry.durationSec}초`, entry.episodes ? `시리즈 ${entry.episodes.length}화` : ''].filter(Boolean).join(' · '))} · ${esc(String(entry.savedAt).slice(0, 10))}</span>
                        </span>
                      </div>
                      <p class="wiz-hint">${esc(entry.script.split('\n').slice(0, 2).join(' '))}</p>
                      ${entry.audio ? `<audio controls preload="metadata" src="${esc(entry.audio)}"></audio>` : ''}
                      <div class="field-grid three">
                        <button class="primary-button" type="button" data-action="load">불러오기</button>
                        <button class="ghost-button" type="button" data-action="srt">SRT 내보내기</button>
                        <button class="ghost-button" type="button" data-action="delete">삭제</button>
                      </div>
                    </article>
                  `,
                )
                .join('')}
            </div>
          </section>
        </div>
      `;
      for (const card of container.querySelectorAll('.library-card')) {
        const entry = scripts.find((item) => item.id === card.dataset.id);
        // 낭독이 붙은 대본은 녹음 길이를 배지로 표시한다.
        const libraryAudio = card.querySelector('audio');
        libraryAudio?.addEventListener('loadedmetadata', () => {
          const seconds = Math.round(libraryAudio.duration);
          if (!Number.isFinite(seconds) || seconds <= 0) return;
          const badge = card.querySelector('[data-field="duration"]');
          if (badge) {
            badge.textContent = `⏱ ${seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`}`;
            badge.hidden = false;
          }
        });
        card.querySelector('[data-action="load"]').addEventListener('click', () => {
          wizard.topic = entry.topic || '';
          wizard.genre = entry.genre || '';
          wizard.tone = entry.tone || '이야기꾼';
          wizard.durationSec = String(entry.durationSec || 30);
          wizard.selectedTemplate = wizard.templates.find((t) => t.label === entry.format)?.key ?? '';
          wizard.script = entry.script;
          wizard.seriesScripts = entry.episodes || null;
          // 대본에 연결된 낭독 녹음본도 함께 불러온다.
          wizard.scriptAudio = entry.audio || null;
          wizard.status = `보관함에서 "${entry.title}" 대본을 불러왔습니다.${entry.audio ? ' (낭독 녹음본 포함)' : ''}`;
          onLoaded?.();
        });
        card.querySelector('[data-action="srt"]').addEventListener('click', () => {
          try {
            downloadTextFile(safeSrtName(entry.title), scriptToSrt(entry.script, entry.durationSec));
          } catch (error) {
            container.querySelector('.wiz-status')?.remove();
            card.insertAdjacentHTML('beforeend', `<p class="wiz-status">${esc(error.message)}</p>`);
          }
        });
        card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
          await fetch(`/api/scripts/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
          renderScriptLibraryTab(container, onLoaded);
        });
      }
    })
    .catch((error) => {
      container.innerHTML = `<div class="wizard-panel"><p class="wiz-status">보관함 불러오기 실패: ${esc(error.message)}</p></div>`;
    });
}

/** 낭독 스튜디오: 자유 텍스트 낭독 생성 + 저장된 낭독 관리(듣기/변환/이름/다운로드). */
const studio = {
  text: '',
  voice: '',
  name: '',
  directed: true,
  styleId: 'natural',
  strength: '2',
  customStyle: '',
};

/** 스튜디오에서 자유 텍스트를 낭독으로 만든다(사연·멘트·대본 무엇이든). */
async function createStudioNarration(container) {
  const text = studio.text.trim();
  if (!studio.voice) throw new Error('목소리를 선택해 주세요.');
  if (!text) throw new Error('낭독할 텍스트를 입력해 주세요.');
  if ([...text].length > 12000) throw new Error('텍스트가 너무 깁니다(12,000자 초과). 나눠서 만들어 주세요.');
  const keepAs = studio.name.trim() || text.replace(/\s+/g, ' ').slice(0, 24);
  openVoiceModal(
    '낭독 생성 중',
    `'${voiceDisplayName(studio.voice)}' 목소리에 '${narrationStyleLabel(studio.styleId)}' 말투를 적용하고 있어요.` +
      (studio.directed ? ' AI가 문장별 연출도 함께 잡습니다.' : ''),
    studio.voice,
  );
  try {
    const settings = getSettings();
    const keyMap = {
      'api-gpt': settings.openaiApiKey,
      'api-gemini': settings.geminiApiKey,
      'api-claude': settings.anthropicApiKey,
    };
    const data = await api('/api/voices/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        voice: studio.voice,
        text,
        directed: studio.directed,
        styleId: studio.styleId,
        styleStrength: Number(studio.strength),
        customStyle: studio.customStyle,
        method: wizard.scriptMethod,
        apiKey: keyMap[wizard.scriptMethod] || '',
        keepAs,
        ...typecastKeyBody(),
      }),
    });
    finishVoiceModal({
      title: '낭독 완성',
      desc: `'${keepAs}' 이름으로 저장됐습니다.`,
      audioUrl: `${data.audioUrl}&t=${Date.now()}`,
    });
    studio.text = '';
    studio.name = '';
    renderNarrationStudioTab(container);
  } catch (error) {
    if (String(error.message).includes('중지')) {
      renderNarrationStudioTab(container);
      return;
    }
    finishVoiceModal({ title: '낭독 생성 실패', desc: error.message, error: true });
  }
}

function studioCreatorHtml(voices) {
  const defaultVoice = getSettings().defaultVoice;
  const options =
    voices
      .map(
        (voice) =>
          `<option value="${esc(voice.name)}"${voice.name === studio.voice ? ' selected' : ''}>` +
          `${voice.name === defaultVoice ? '⭐ ' : ''}${esc(voice.name)}</option>`,
      )
      .join('') + typecastOptionsHtml(studio.voice);
  return `
    <section class="wizard-step">
      <h3>🎙 새 낭독 만들기</h3>
      <p class="wiz-hint">대본이 아니어도 됩니다 — 사연, 광고 멘트, 인트로 등 아무 텍스트나 내 목소리로 만들어 보관하세요.</p>
      <label class="field-wide">낭독할 텍스트
        <textarea id="studioText" rows="5" placeholder="여기에 텍스트를 붙여넣으세요.">${esc(studio.text)}</textarea>
      </label>
      <div class="field-grid three">
        <label>목소리 <select id="studioVoice">${options || '<option value="">등록된 목소리 없음</option>'}</select></label>
        <label>저장 이름 <input id="studioName" value="${esc(studio.name)}" placeholder="비우면 첫 문장으로 저장" /></label>
        <button id="studioCreateBtn" class="primary-button" type="button">🎙 낭독 생성</button>
      </div>
      <div class="field-grid">
        <label>낭독 말투
          <select id="studioStyle">${narrationStyleOptions(studio.styleId)}</select>
        </label>
        <label>적용 강도
          <select id="studioStrength">
            <option value="1"${studio.strength === '1' ? ' selected' : ''}>약하게 · 원래 목소리 중심</option>
            <option value="2"${studio.strength === '2' ? ' selected' : ''}>보통 · 자연스러운 연출</option>
            <option value="3"${studio.strength === '3' ? ' selected' : ''}>강하게 · 광고/연기 강조</option>
          </select>
        </label>
      </div>
      ${
        studio.styleId === 'custom'
          ? `<label class="field-wide">직접 말투 지시
              <input id="studioCustomStyle" maxlength="500" value="${esc(studio.customStyle)}" placeholder="예: 친근하게 설명하되 마지막 구매 문구는 낮고 단호하게" />
            </label>`
          : ''
      }
      <label class="wiz-check"><input type="checkbox" id="studioDirected"${studio.directed ? ' checked' : ''} />
        AI 세밀 연출 — 선택한 말투를 바탕으로 문장별 완급·쉼·피치·강도·끝음을 조정합니다</label>
    </section>
  `;
}

/** 낭독 스튜디오 탭: 저장된 낭독을 듣고 속도/톤을 조절해 새 파일로 만든다. */
export function renderNarrationStudioTab(container) {
  container.innerHTML = '<div class="wizard-panel"><p class="wiz-hint">낭독 목록을 불러오는 중...</p></div>';
  Promise.all([api('/api/narrations'), api('/api/voices'), api('/api/narration-styles'), loadTypecastVoices()])
    .then(([data, voicesData, stylesData]) => {
      const narrations = data.narrations || [];
      const voices = voicesData.voices || [];
      narrationStyles = stylesData.styles || narrationStyles;
      if (!studio.voice) {
        const preferred = getSettings().defaultVoice;
        studio.voice = isTypecastVoiceValue(preferred)
          ? preferred
          : (voices.find((voice) => voice.name === preferred)?.name ?? voices[0]?.name ?? '');
      }
      const listHtml =
        narrations.length === 0
          ? '<p class="wiz-hint">아직 저장된 낭독이 없습니다. 위에서 만들거나, AI 숏폼 만들기 탭에서 "대본 낭독 듣기"를 실행하면 여기에 쌓입니다.</p>'
          : `
            <p class="wiz-hint">속도는 목소리 음정을 유지한 배속이고, 톤은 반음 단위로 목소리를 높이거나 낮춥니다. 변환하면 원본은 그대로 두고 새 파일이 생깁니다.</p>
            <div class="library-list">
              ${narrations
                .map(
                  (item) => `
                    <article class="library-card" data-name="${esc(item.name)}">
                      <div class="library-card-head">
                        <strong>${esc(item.name)}</strong>
                        ${item.metadata?.styleLabel ? `<span class="soft-badge">${esc(item.metadata.styleLabel)} · 강도 ${esc(item.metadata.styleStrength || 2)}</span>` : ''}
                        <span class="library-card-meta">
                          <span class="soft-badge duration-badge" data-field="duration" hidden></span>
                          <span class="wiz-hint">${esc(String(item.savedAt).slice(0, 10))} · ${Math.round(item.sizeKb / 1024) || 1}MB</span>
                        </span>
                      </div>
                      <audio controls preload="metadata" src="${esc(item.url)}"></audio>
                      <div class="field-grid three">
                        <label>속도
                          <select data-field="speed">
                            <option value="0.75">0.75x 느리게</option>
                            <option value="0.9">0.9x 살짝 느리게</option>
                            <option value="1" selected>1x 원본</option>
                            <option value="1.1">1.1x 살짝 빠르게</option>
                            <option value="1.25">1.25x 빠르게</option>
                            <option value="1.5">1.5x 아주 빠르게</option>
                          </select>
                        </label>
                        <label>톤
                          <select data-field="pitch">
                            <option value="-3">-3키 굵고 낮게</option>
                            <option value="-1">-1키 살짝 낮게</option>
                            <option value="0" selected>원본</option>
                            <option value="1">+1키 살짝 높게</option>
                            <option value="3">+3키 밝고 높게</option>
                          </select>
                        </label>
                        <button class="primary-button" type="button" data-action="adjust">변환해서 새 파일 만들기</button>
                      </div>
                      <div class="field-grid three">
                        <button class="ghost-button" type="button" data-action="download">⬇ 다운로드</button>
                        <button class="ghost-button" type="button" data-action="rename">✏ 이름 변경</button>
                        <button class="ghost-button" type="button" data-action="delete">🗑 삭제</button>
                      </div>
                    </article>
                  `,
                )
                .join('')}
            </div>`;

      container.innerHTML = `
        <div class="wizard-panel">
          ${studioCreatorHtml(voices)}
          <section class="wizard-step">
            <h3>내 낭독 보관함 <span class="soft-badge">${narrations.length}개</span></h3>
            ${listHtml}
          </section>
        </div>
      `;

      const on = (id, event, handler) => container.querySelector(id)?.addEventListener(event, handler);
      on('#studioText', 'input', (e) => {
        studio.text = e.target.value;
      });
      on('#studioName', 'input', (e) => {
        studio.name = e.target.value;
      });
      on('#studioVoice', 'change', (e) => {
        studio.voice = e.target.value;
      });
      on('#studioDirected', 'change', (e) => {
        studio.directed = e.target.checked;
      });
      on('#studioStyle', 'change', (e) => {
        studio.styleId = e.target.value;
        renderNarrationStudioTab(container);
      });
      on('#studioStrength', 'change', (e) => {
        studio.strength = e.target.value;
      });
      on('#studioCustomStyle', 'input', (e) => {
        studio.customStyle = e.target.value;
      });
      on('#studioCreateBtn', 'click', () =>
        createStudioNarration(container).catch((error) => {
          finishVoiceModal({ title: '낭독 생성 실패', desc: error.message, error: true });
        }),
      );

      for (const card of container.querySelectorAll('.library-card')) {
        const name = card.dataset.name;
        const audio = card.querySelector('audio');
        // 오디오 메타데이터가 로드되면 재생 길이를 배지로 표시한다.
        audio.addEventListener('loadedmetadata', () => {
          const seconds = Math.round(audio.duration);
          if (!Number.isFinite(seconds) || seconds <= 0) return;
          const label = seconds >= 60 ? `${Math.floor(seconds / 60)}분 ${seconds % 60}초` : `${seconds}초`;
          const badge = card.querySelector('[data-field="duration"]');
          if (badge) {
            badge.textContent = `⏱ ${label}`;
            badge.hidden = false;
          }
        });
        const showCardStatus = (message, isError = true) => {
          card.querySelector('.card-inline-status')?.remove();
          card.insertAdjacentHTML(
            'beforeend',
            `<p class="wiz-status card-inline-status${isError ? ' wiz-status-error' : ''}">${esc(message)}</p>`,
          );
        };
        card.querySelector('[data-action="adjust"]').addEventListener('click', async () => {
          const speed = Number(card.querySelector('[data-field="speed"]').value);
          const pitch = Number(card.querySelector('[data-field="pitch"]').value);
          if (speed === 1 && pitch === 0) {
            showCardStatus('속도나 톤을 먼저 바꾼 뒤 변환을 눌러주세요. (지금은 원본과 같은 설정이라 만들 게 없어요)');
            return;
          }
          const button = card.querySelector('[data-action="adjust"]');
          button.disabled = true;
          button.textContent = '변환 중...';
          try {
            await api('/api/narrations/adjust', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ name, speed, pitch }),
            });
            renderNarrationStudioTab(container);
          } catch (error) {
            button.disabled = false;
            button.textContent = '변환해서 새 파일 만들기';
            showCardStatus(error.message);
          }
        });
        card.querySelector('[data-action="download"]').addEventListener('click', () => {
          const link = document.createElement('a');
          link.href = card.querySelector('audio').src;
          link.download = `${name}.wav`;
          link.click();
        });
        // 이름 변경 — Electron은 window.prompt를 지원하지 않으므로 인라인 입력으로 처리한다.
        card.querySelector('[data-action="rename"]').addEventListener('click', () => {
          if (card.querySelector('.inline-rename')) return;
          const head = card.querySelector('.library-card-head strong');
          head.insertAdjacentHTML(
            'afterend',
            `<span class="inline-rename">
              <input type="text" value="${esc(name)}" />
              <button class="mini-button" type="button" data-action="rename-ok">확인</button>
              <button class="mini-button" type="button" data-action="rename-cancel">취소</button>
            </span>`,
          );
          const input = card.querySelector('.inline-rename input');
          input.focus();
          input.select();
          const closeRename = () => card.querySelector('.inline-rename')?.remove();
          card.querySelector('[data-action="rename-cancel"]').addEventListener('click', closeRename);
          const submitRename = async () => {
            const next = input.value.trim();
            if (!next || next === name) {
              closeRename();
              return;
            }
            try {
              await api('/api/narrations/rename', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ from: name, to: next }),
              });
              renderNarrationStudioTab(container);
            } catch (error) {
              showCardStatus(error.message);
            }
          };
          card.querySelector('[data-action="rename-ok"]').addEventListener('click', submitRename);
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') submitRename();
            if (e.key === 'Escape') closeRename();
          });
        });
        card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
          if (!window.confirm(`'${name}' 낭독을 삭제할까요?`)) return;
          await fetch(`/api/narrations/${encodeURIComponent(name)}`, { method: 'DELETE' });
          renderNarrationStudioTab(container);
        });
      }
    })
    .catch((error) => {
      container.innerHTML = `<div class="wizard-panel"><p class="wiz-status">불러오기 실패: ${esc(error.message)}</p></div>`;
    });
}

/** 대본 전체를 선택한 목소리로 낭독한 녹음 파일을 만들어 바로 들려준다. */
async function listenScript(container) {
  if (!wizard.selectedVoice) throw new Error('먼저 ① 내 목소리에서 목소리를 선택해 주세요.');
  if (!wizard.script.trim()) throw new Error('먼저 대본을 입력하거나 AI로 생성해 주세요.');
  // 대본을 자르지 않고 전부 낭독한다(과거 1500자 절단이 "중간에 짤림" 원인이었음).
  const text = wizard.script.trim();
  if ([...text].length > 12000) throw new Error('대본이 너무 깁니다(12,000자 초과). 나눠서 낭독해 주세요.');
  openVoiceModal(
    '대본 낭독 생성 중',
    `'${voiceDisplayName(wizard.selectedVoice)}' 목소리로 대본 전체를 읽고 있어요.` +
      (wizard.directedNarration ? ' AI가 낭독 연출(완급·쉼)도 함께 잡습니다.' : '') +
      ' 대본이 길수록 오래 걸립니다.',
    wizard.selectedVoice,
  );
  try {
    const settings = getSettings();
    const keyMap = {
      'api-gpt': settings.openaiApiKey,
      'api-gemini': settings.geminiApiKey,
      'api-claude': settings.anthropicApiKey,
    };
    const data = await api('/api/voices/test', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        voice: wizard.selectedVoice,
        text,
        directed: wizard.directedNarration,
        styleId: wizard.narrationStyle,
        styleStrength: Number(wizard.narrationStrength),
        customStyle: wizard.customNarrationStyle,
        method: wizard.scriptMethod,
        apiKey: keyMap[wizard.scriptMethod] || '',
        keepAs: `${wizard.topic || 'script'}-${Date.now().toString(36)}`,
        ...typecastKeyBody(),
      }),
    });
    wizard.testAudioUrl = `${data.audioUrl}&t=${Date.now()}`;
    if (data.savedAudioUrl) {
      wizard.scriptAudio = data.savedAudioUrl;
      saveScriptToLibrary(data.savedAudioUrl).catch(() => {});
    }
    finishVoiceModal({
      title: '대본 낭독 완성',
      desc: '아래에서 들어보세요. 대본과 낭독 녹음이 보관함에 함께 저장됐습니다.',
      audioUrl: wizard.testAudioUrl,
    });
    wizard.status = '대본 낭독 녹음 완성 — 보관함에서 언제든 다시 들을 수 있습니다.';
  } catch (error) {
    // 사용자가 직접 중지한 경우는 실패가 아니다 — 조용히 상태만 남긴다.
    if (String(error.message).includes('중지')) {
      wizard.status = '낭독을 중지했습니다.';
      renderWizard(container);
      return;
    }
    finishVoiceModal({ title: '낭독 생성 실패', desc: error.message, error: true });
    throw error;
  }
  renderWizard(container);
}

/** 이미지 생성기에 맞는 API 키를 환경설정에서 가져온다(위자드에 키 입력칸 없음). */
function imageApiKeyFromSettings() {
  const settings = getSettings();
  if (wizard.imageProvider === 'gpt') return settings.openaiApiKey || '';
  if (wizard.imageProvider === 'gemini') return settings.geminiApiKey || '';
  return '';
}

async function checkDropshotStatus(container) {
  wizard.status = '드롭샷 로그인 확인 중...';
  renderWizard(container);
  try {
    const data = await api('/api/dropshot/status');
    wizard.status = data.loggedIn
      ? '드롭샷 로그인됨 — 나노바나나프로 무제한 생성 가능'
      : '드롭샷 로그인 필요 — 환경설정에서 로그인하세요.';
  } catch (error) {
    wizard.status = `드롭샷 확인 실패: ${error.message}`;
  }
  renderWizard(container);
}

async function runPipeline(container) {
  if (!wizard.script.trim()) throw new Error('대본을 입력해 주세요.');
  if (!['mock', 'dropshot'].includes(wizard.imageProvider) && !imageApiKeyFromSettings()) {
    throw new Error('선택한 이미지 생성기는 API 키가 필요합니다. 환경설정에서 키를 입력하거나 드롭샷/테스트를 선택하세요.');
  }
  if (wizard.motionMode !== 'none' && wizard.motionEngine === 'seedance' && !getSettings().falApiKey) {
    throw new Error('Seedance 영상화에는 fal.ai API 키가 필요합니다. 환경설정에서 입력하거나 엔진을 드롭샷으로 바꾸세요.');
  }
  const projectName = wizard.projectName.trim() || `story-${Date.now().toString(36)}`;
  // 같은 프로젝트 이름으로 두 작업을 겹치면 파일이 섞인다 — 이름을 비워두면 자동으로 고유 이름이 붙는다.
  if (wizard.jobs.some((job) => job.projectName === projectName && (job.status === 'running' || job.status === 'queued'))) {
    throw new Error(`'${projectName}' 작업이 이미 진행 중입니다. 프로젝트 이름을 바꾸거나 비워 두세요.`);
  }
  wizard.resultVideo = '';
  wizard.generatedImages = [];
  wizard.status = '';
  try {
    // 배경음악을 골랐으면 프로젝트에 먼저 올리고 경로를 파이프라인에 넘긴다.
    let bgmFile;
    if (wizard.bgmFile) {
      const uploaded = await api('/api/media/upload', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          projectName,
          kind: 'audio',
          files: [{ name: wizard.bgmFile.name, data: await blobToBase64(wizard.bgmFile) }],
        }),
      });
      bgmFile = uploaded.imported?.[0]?.relativePath;
    }
    const started = await api('/api/story-pipeline', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        projectName,
        title: wizard.topic || projectName,
        script: wizard.script,
        maxSceneChars: 20, // 한 문장 = 한 장면 = 이미지 한 장 (긴 쇼츠일수록 이미지가 많아진다)
        ratio: wizard.ratio,
        character: characterFromSettings() || undefined,
        // AI 촬영감독(장면별 숏 연출)에 쓸 생성 방식 — 대본 생성과 같은 설정을 쓴다.
        scriptMethod: wizard.scriptMethod,
        scriptApiKey: (() => {
          const settings = getSettings();
          return { 'api-gpt': settings.openaiApiKey, 'api-gemini': settings.geminiApiKey, 'api-claude': settings.anthropicApiKey }[wizard.scriptMethod] || '';
        })(),
        bgmFile,
        motionMode: wizard.motionMode,
        motionEngine: wizard.motionEngine,
        falApiKey: getSettings().falApiKey || '',
        voice: wizard.selectedVoice || undefined,
        narrationStyle: wizard.narrationStyle,
        narrationStrength: Number(wizard.narrationStrength),
        customNarrationStyle: wizard.customNarrationStyle,
        directedNarration: wizard.directedNarration,
        imageProvider: wizard.imageProvider,
        apiKey: imageApiKeyFromSettings() || undefined,
        ttsProvider: isTypecastVoiceValue(wizard.selectedVoice) ? 'typecast' : 'qwen3',
        ...typecastKeyBody(),
        force: true,
        async: true,
      }),
    });
    wizard.startedProjectName = started.projectName;
    wizard.status = `'${started.projectName}' 작업이 시작됐습니다 — 아래 작업 목록에서 진행을 확인하세요. 다른 대본으로 작업을 더 추가할 수 있습니다.`;
    renderWizard(container);
    ensureJobsPolling(container);
  } catch (error) {
    wizard.status = error.message;
    wizard.statusIsError = true;
    renderWizard(container);
    throw error;
  }
}

function voiceOptions() {
  const defaultVoice = getSettings().defaultVoice;
  const none = `<option value=""${wizard.selectedVoice === '' ? ' selected' : ''}>나레이션 없이</option>`;
  return (
    none +
    wizard.voices
      .map(
        (voice) =>
          `<option value="${esc(voice.name)}"${voice.name === wizard.selectedVoice ? ' selected' : ''}>` +
          `${voice.name === defaultVoice ? '⭐ ' : ''}${esc(voice.name)}${voice.hasTranscript ? ' (테스트 대본 있음)' : ' ⚠️'}</option>`,
      )
      .join('') +
    typecastOptionsHtml(wizard.selectedVoice)
  );
}

function templateOptions() {
  const none = `<option value=""${wizard.selectedTemplate === '' ? ' selected' : ''}>자유 형식</option>`;
  return (
    none +
    wizard.templates
      .map(
        (template) =>
          `<option value="${esc(template.key)}"${template.key === wizard.selectedTemplate ? ' selected' : ''}>${esc(template.label)}</option>`,
      )
      .join('')
  );
}

function selectedTemplateLabel() {
  return wizard.templates.find((template) => template.key === wizard.selectedTemplate)?.label ?? '';
}

export function renderStoryWizardTab(container) {
  renderWizard(container);
  if (wizard.templates.length === 0) {
    loadWizardData().then(() => renderWizard(container));
  }
}

function renderWizard(container) {
  container.innerHTML = `
    <div class="wizard-panel">
      ${onboardingHtml()}
      <section class="wizard-step">
        <h3>① 목소리 <span class="wiz-hint">내 목소리 녹음 또는 타입캐스트 AI 성우</span></h3>
        <div class="field-grid">
          <label>사용할 목소리 <select id="wizVoiceSelect">${voiceOptions()}</select></label>
          <button id="wizVoiceTestBtn" class="ghost-button" type="button">테스트 듣기</button>
        </div>
        <div class="wiz-voice-manage">
          <button id="wizVoiceDefaultBtn" class="mini-button" type="button" title="앱을 켤 때 이 목소리가 자동 선택됩니다">⭐ 기본 목소리로 지정</button>
          <button id="wizVoiceDeleteBtn" class="mini-button mini-danger" type="button">🗑 선택한 목소리 삭제</button>
        </div>
        ${(() => {
          const selected = wizard.voices.find((voice) => voice.name === wizard.selectedVoice);
          return selected && !selected.hasTranscript
            ? '<p class="wiz-status wiz-status-error">⚠️ 이 목소리는 테스트 대본(말한 문장) 없이 등록되어 억양·끝음 품질이 크게 떨어집니다. 같은 이름으로 테스트 대본과 함께 다시 등록하면 훨씬 자연스러워집니다.</p>'
            : '';
        })()}
        ${
          wizard.typecastVoices.length === 0
            ? '<p class="wiz-hint">🎭 녹음 없이 시작하려면 환경설정에 타입캐스트 API 키를 넣어 보세요 — 전문 AI 성우 목소리가 이 목록에 추가됩니다.</p>'
            : ''
        }
        <details id="wizVoiceRegister" class="voice-register"${wizard.registerOpen || wizard.voices.length === 0 ? ' open' : ''}>
          <summary>🎤 새 목소리 등록하기 <span class="wiz-hint">10~30초 녹음 또는 파일 업로드 — 길수록 품질↑</span></summary>
          <div class="field-grid">
            <label>이름 <input id="wizVoiceName" value="${esc(wizard.voiceName)}" placeholder="내목소리" /></label>
            <button id="wizRecordBtn" class="${wizard.recording ? 'primary-button' : 'ghost-button'}" type="button">
              ${wizard.recording ? '■ 녹음 중지' : wizard.recordedBlob ? '다시 녹음' : '● 녹음 시작'}
            </button>
            <label>또는 파일 <input id="wizVoiceFile" type="file" accept="audio/*" /></label>
          </div>
          ${wizard.voiceFile ? `<p class="wiz-hint">선택한 파일: ${esc(wizard.voiceFile.name)}</p>` : ''}
          ${wizard.recordedBlob ? '<p class="wiz-hint">녹음 완료 — 아래 전사를 입력하고 저장하세요.</p>' : ''}
          <label class="field-wide">테스트 대본 — 녹음에서 말한 문장 그대로 (길수록 억양·끝음이 좋아집니다)
            <textarea id="wizVoiceTranscript" rows="4" placeholder="안녕하세요, 제 목소리 샘플입니다. 억양이 자연스럽게 들리나요? 평서문과 의문문을 섞어서 길게 읽을수록 복제 품질이 좋아집니다. 오늘도 좋은 하루 보내세요.">${esc(wizard.voiceTranscript)}</textarea>
          </label>
          <button id="wizVoiceSaveBtn" class="primary-button" type="button">목소리 저장</button>
        </details>
      </section>

      <section class="wizard-step">
        <h3>② 대본</h3>
        <div class="field-grid">
          <label>주제 <input id="wizTopic" value="${esc(wizard.topic)}" placeholder="예: 한밤의 택배" /></label>
          <label>프로젝트 이름 <input id="wizProjectName" value="${esc(wizard.projectName)}" placeholder="자동 생성" /></label>
        </div>
        <div class="field-grid">
          <label>주제 장르
            <select id="wizGenre">
              <option value=""${wizard.genre === '' ? ' selected' : ''}>자유 주제</option>
              <option value="경제"${wizard.genre === '경제' ? ' selected' : ''}>경제 이야기</option>
              <option value="공포썰"${wizard.genre === '공포썰' ? ' selected' : ''}>공포썰</option>
              <option value="웃긴썰"${wizard.genre === '웃긴썰' ? ' selected' : ''}>웃긴썰</option>
              <option value="고전·역사썰"${wizard.genre === '고전·역사썰' ? ' selected' : ''}>고전·역사썰 (옛날 이야기)</option>
              <option value="과학"${wizard.genre === '과학' ? ' selected' : ''}>과학 이야기</option>
              <option value="미스터리·미제"${wizard.genre === '미스터리·미제' ? ' selected' : ''}>미스터리·미제사건</option>
              <option value="상식·꿀팁"${wizard.genre === '상식·꿀팁' ? ' selected' : ''}>상식·꿀팁</option>
            </select>
          </label>
          <label>대본 형식
            <select id="wizTemplateSelect">${templateOptions()}</select>
          </label>
          <label>말투
            <select id="wizTone">
              <option value="이야기꾼"${wizard.tone === '이야기꾼' ? ' selected' : ''}>이야기꾼 · 들려주는 대화체 (추천)</option>
              <option value="반말썰"${wizard.tone === '반말썰' ? ' selected' : ''}>반말썰 · 커뮤니티체</option>
              <option value="차분한나레이션"${wizard.tone === '차분한나레이션' ? ' selected' : ''}>차분한 나레이션 · 다큐체</option>
              <option value="하이텐션"${wizard.tone === '하이텐션' ? ' selected' : ''}>하이텐션 · 예능 진행자</option>
            </select>
          </label>
          <label>목표 길이
            <select id="wizDuration">
              <option value="30"${wizard.durationSec === '30' ? ' selected' : ''}>30초 (이미지 6~8장)</option>
              <option value="60"${wizard.durationSec === '60' ? ' selected' : ''}>1분 (이미지 12~16장)</option>
              <option value="120"${wizard.durationSec === '120' ? ' selected' : ''}>2분 (이미지 24~30장)</option>
              <option value="180"${wizard.durationSec === '180' ? ' selected' : ''}>3분 · 쇼츠 최대 (이미지 36~45장)</option>
              <option value="300"${wizard.durationSec === '300' ? ' selected' : ''}>5분 · 롱폼 (이미지 60~75장)</option>
              <option value="600"${wizard.durationSec === '600' ? ' selected' : ''}>10분 · 롱폼 (이미지 110~140장)</option>
            </select>
          </label>
          <label>연재
            <select id="wizSeriesMode">
              <option value="single"${wizard.seriesMode === 'single' ? ' selected' : ''}>단편 (1편 완결)</option>
              <option value="series"${wizard.seriesMode === 'series' ? ' selected' : ''}>시리즈 (여러 화 연재)</option>
            </select>
          </label>
          ${
            wizard.seriesMode === 'series'
              ? `<label>회차 <input id="wizSeriesEpisode" type="number" min="1" step="1" value="${esc(wizard.seriesEpisode)}" /></label>`
              : ''
          }
        </div>
        ${
          wizard.seriesMode === 'series'
            ? `<label class="field-wide">이전 화 줄거리 (2화부터 입력하면 이어서 써줍니다)
                <input id="wizSeriesPrevious" value="${esc(wizard.seriesPrevious)}" placeholder="예: 주인공이 한밤에 의문의 택배를 받았다" />
              </label>`
            : ''
        }
        <div class="field-grid">
          <label>AI 대본 생성 방식
            <select id="wizScriptMethod">
              <option value="api-gpt"${wizard.scriptMethod === 'api-gpt' ? ' selected' : ''}>API · GPT</option>
              <option value="api-gemini"${wizard.scriptMethod === 'api-gemini' ? ' selected' : ''}>API · Gemini</option>
              <option value="api-claude"${wizard.scriptMethod === 'api-claude' ? ' selected' : ''}>API · Claude</option>
              <option value="agent-claude"${wizard.scriptMethod === 'agent-claude' ? ' selected' : ''}>에이전트 · Claude Code</option>
              <option value="agent-codex"${wizard.scriptMethod === 'agent-codex' ? ' selected' : ''}>에이전트 · Codex</option>
            </select>
          </label>
          <button id="wizScriptGenBtn" class="primary-button" type="button">AI로 대본 생성</button>
        </div>
        <p class="wiz-hint">직접 쓰거나 웹에서 만든 대본을 붙여넣어도 됩니다. API 키와 에이전트 로그인은 환경설정에서 관리합니다.</p>
        <label class="field-wide">대본 (한 줄 = 한 장면)
          <textarea id="wizScript" rows="7" placeholder="템플릿을 고르거나 직접 입력하세요.">${esc(wizard.script)}</textarea>
        </label>
        <div class="field-grid">
          <button id="wizScriptListenBtn" class="ghost-button" type="button">🔊 대본 낭독 듣기 — 선택한 목소리로 녹음 생성</button>
          <button id="wizScriptSaveBtn" class="ghost-button" type="button">💾 대본 보관함에 저장</button>
          <button id="wizScriptSrtBtn" class="ghost-button" type="button">⬇ SRT 자막 파일로 내보내기</button>
          <button id="wizScriptPlayBtn" class="ghost-button" type="button" ${wizard.scriptAudio ? '' : 'disabled'}
            title="${wizard.scriptAudio ? '이 대본으로 만든 낭독 녹음본을 재생합니다' : '아직 이 대본의 낭독 녹음본이 없습니다 — 먼저 대본 낭독 듣기를 실행하세요'}">
            ▶ 생성된 낭독 들어보기</button>
        </div>
        <label class="wiz-check"><input type="checkbox" id="wizDirectedNarration"${wizard.directedNarration ? ' checked' : ''} />
          AI 세밀 연출 — 선택한 말투를 대본 문맥에 맞춰 문장별로 조정합니다</label>
        <div class="field-grid">
          <label>낭독 말투
            <select id="wizNarrationStyle">${narrationStyleOptions(wizard.narrationStyle)}</select>
          </label>
          <label>적용 강도
            <select id="wizNarrationStrength">
              <option value="1"${wizard.narrationStrength === '1' ? ' selected' : ''}>약하게</option>
              <option value="2"${wizard.narrationStrength === '2' ? ' selected' : ''}>보통</option>
              <option value="3"${wizard.narrationStrength === '3' ? ' selected' : ''}>강하게</option>
            </select>
          </label>
        </div>
        ${
          wizard.narrationStyle === 'custom'
            ? `<label class="field-wide">직접 말투 지시
                <input id="wizCustomNarrationStyle" maxlength="500" value="${esc(wizard.customNarrationStyle)}" placeholder="예: 빠르고 밝게 시작하고 결론은 낮고 단호하게" />
              </label>`
            : ''
        }
      </section>

      <section class="wizard-step">
        <h3>③ 만들기</h3>
        <div class="field-grid">
          <label>화면 비율
            <select id="wizRatio">
              <option value="9:16"${wizard.ratio === '9:16' ? ' selected' : ''}>숏폼 · 세로 9:16</option>
              <option value="16:9"${wizard.ratio === '16:9' ? ' selected' : ''}>롱폼 · 가로 16:9</option>
            </select>
          </label>
          <label>이미지 생성
            <select id="wizImageProvider">
              <option value="mock"${wizard.imageProvider === 'mock' ? ' selected' : ''}>테스트(무료, 단색)</option>
              <option value="dropshot"${wizard.imageProvider === 'dropshot' ? ' selected' : ''}>드롭샷 · 나노바나나프로(무제한)</option>
              <option value="gpt"${wizard.imageProvider === 'gpt' ? ' selected' : ''}>GPT 이미지(키 필요)</option>
              <option value="gemini"${wizard.imageProvider === 'gemini' ? ' selected' : ''}>Gemini(키 필요)</option>
            </select>
          </label>
          <label>장면 영상화
            <select id="wizMotionMode">
              <option value="none"${wizard.motionMode === 'none' ? ' selected' : ''}>정지 이미지 (무료)</option>
              <option value="hook"${wizard.motionMode === 'hook' ? ' selected' : ''}>후킹 장면만 영상화 (추천)</option>
              <option value="all"${wizard.motionMode === 'all' ? ' selected' : ''}>전체 장면 영상화</option>
            </select>
          </label>
          ${
            wizard.motionMode !== 'none'
              ? `<label>영상화 엔진
                  <select id="wizMotionEngine">
                    <option value="seedance"${wizard.motionEngine === 'seedance' ? ' selected' : ''}>Seedance (fal.ai 키 필요 · 최저가)</option>
                    <option value="dropshot"${wizard.motionEngine === 'dropshot' ? ' selected' : ''}>드롭샷 (클립당 130크레딧)</option>
                  </select>
                </label>`
              : ''
          }
        </div>
        ${
          wizard.motionMode !== 'none'
            ? `<p class="wiz-hint">${
                wizard.motionEngine === 'seedance'
                  ? 'Seedance는 환경설정의 fal.ai API 키를 사용합니다. 5초 클립당 약 50~90원.'
                  : '드롭샷 영상은 클립당 130크레딧을 소모합니다(이미지와 달리 무제한 아님).'
              } 영상화는 장면당 1~3분 걸립니다.</p>`
            : ''
        }
        <div class="field-grid">
          <label>주인공 성별
            <select id="wizCharGender">
              <option value="남성"${getSettings().characterGender === '남성' ? ' selected' : ''}>남성</option>
              <option value="여성"${getSettings().characterGender === '여성' ? ' selected' : ''}>여성</option>
              <option value=""${getSettings().characterGender === '' ? ' selected' : ''}>자동(대본에 맡김)</option>
            </select>
          </label>
          <label>주인공 외모 (채널 고정, 선택)
            <input id="wizCharDesc" value="${esc(getSettings().characterDesc)}" placeholder="예: 30대, 짧은 검은 머리, 어두운 재킷" />
          </label>
        </div>
        <p class="wiz-hint">여기 설정은 저장되어 모든 쇼츠에 같은 인물이 나옵니다 — 채널 일관성의 핵심.</p>
        <div class="field-grid">
          <label>배경음악 (선택)
            <input id="wizBgmFile" type="file" accept="audio/*" />
          </label>
          ${wizard.bgmFile ? `<p class="wiz-hint">🎵 ${esc(wizard.bgmFile.name)} — 나레이션 아래에 낮은 볼륨(8%)으로 깔립니다.</p>` : '<p class="wiz-hint">mp3/wav 파일을 고르면 영상 전체에 잔잔하게 깔립니다. 안 골라도 됩니다.</p>'}
        </div>
        <button id="wizRunBtn" class="primary-button" type="button">
          영상 만들기${activeJobCount() > 0 ? ` (진행 중 ${activeJobCount()}개 — 추가 가능)` : ''}
        </button>
        <div id="wizJobsPanel" class="jobs-panel"></div>
      </section>

      ${
        activeJobCount() > 0 || wizard.generatedImages.length > 0
          ? `<section class="wizard-step">
              <h3>생성된 이미지 <span id="wizImageCount" class="soft-badge">${wizard.generatedImages.length}장</span></h3>
              <div id="wizImageGrid" class="wiz-image-grid">${wizardImageTiles()}</div>
              ${activeJobCount() > 0 ? '<p class="wiz-hint">가장 최근 시작한 작업의 이미지가 만들어지는 대로 표시됩니다. 이후 자동으로 나레이션 → 영상화 → 렌더까지 이어집니다.</p>' : ''}
            </section>`
          : ''
      }
      ${wizard.status ? `<p class="wiz-status${wizard.statusIsError ? ' wiz-status-error' : ''}">${wizard.statusIsError ? '⚠️ ' : ''}${esc(wizard.status)}</p>` : ''}
      ${
        wizard.resultVideo
          ? `<section class="wizard-step"><h3>결과</h3>
             <video controls class="wiz-result" src="${wizard.resultVideo}"></video></section>`
          : ''
      }
    </div>
  `;
  bindWizard(container);
}

function bindWizard(container) {
  const on = (id, event, handler) => {
    const el = container.querySelector(id);
    if (el) el.addEventListener(event, handler);
  };
  const guard = (fn) => () => {
    wizard.statusIsError = false;
    return fn(container)
      .then(() => {
        wizard.statusIsError = false;
      })
      .catch((error) => {
        wizard.status = error.message;
        wizard.statusIsError = true;
        wizard.running = false;
        stopTimer();
        renderWizard(container);
      });
  };

  on('#wizVoiceSelect', 'change', (e) => {
    wizard.selectedVoice = e.target.value;
  });
  on('#wizGoSettingsBtn', 'click', goToSettingsTab);
  on('#wizVoiceDefaultBtn', 'click', guard(async () => {
    if (!wizard.selectedVoice) throw new Error('기본으로 지정할 목소리를 먼저 선택해 주세요.');
    updateSettings({ defaultVoice: wizard.selectedVoice });
    wizard.status = `'${wizard.selectedVoice}'를 기본 목소리로 지정했습니다 — 앱을 켤 때 자동 선택됩니다.`;
    renderWizard(container);
  }));
  on('#wizVoiceDeleteBtn', 'click', guard(async () => {
    if (!wizard.selectedVoice) throw new Error('삭제할 목소리를 먼저 선택해 주세요.');
    if (isTypecastVoiceValue(wizard.selectedVoice)) {
      throw new Error('타입캐스트 AI 성우는 삭제할 수 없습니다. 내가 등록한 목소리만 삭제됩니다.');
    }
    const target = wizard.selectedVoice;
    if (!window.confirm(`'${target}' 목소리를 삭제할까요? 등록한 음성 샘플과 전사가 함께 지워집니다.`)) return;
    await api(`/api/voices/${encodeURIComponent(target)}`, { method: 'DELETE' });
    if (getSettings().defaultVoice === target) updateSettings({ defaultVoice: '' });
    wizard.selectedVoice = '';
    await loadWizardData();
    wizard.status = `'${target}' 목소리를 삭제했습니다.`;
    renderWizard(container);
  }));
  on('#wizVoiceTestBtn', 'click', guard(async (c) => {
    if (!wizard.selectedVoice) throw new Error('먼저 목소리를 선택해 주세요.');
    // 이미 만들어 둔 테스트 음성이 있으면 재생성 없이 즉시 재생한다.
    const check = await api(`/api/voices/sample?voice=${encodeURIComponent(wizard.selectedVoice)}`);
    if (check.exists) {
      wizard.status = '저장된 테스트 음성 — 바로 재생합니다. (목소리를 새로 등록하면 자동으로 다시 만듭니다)';
      renderWizard(c);
      openAudioDock(check.url, `🔊 테스트 음성 — ${voiceDisplayName(wizard.selectedVoice)}`);
      return;
    }
    openVoiceModal(
      '테스트 음성 생성 중',
      `'${voiceDisplayName(wizard.selectedVoice)}' 목소리로 샘플 문장을 읽고 있어요. 처음 한 번만 만들고 다음부터는 바로 재생됩니다.`,
      `${wizard.selectedVoice}.sample`,
    );
    try {
      await testVoice(c);
      finishVoiceModal({ title: '테스트 음성 완성', desc: '아래에서 바로 들어보세요. 다음부터는 즉시 재생됩니다.', audioUrl: wizard.testAudioUrl });
    } catch (error) {
      finishVoiceModal({ title: '생성 실패', desc: error.message, error: true });
      throw error;
    }
    renderWizard(c);
  }));
  on('#wizRecordBtn', 'click', () => toggleRecording(container));
  on('#wizVoiceRegister', 'toggle', (e) => {
    // 렌더 직후 자동 발화하는 toggle은 무시하고, 사용자가 실제로 바꾼 경우만 기억한다.
    const renderedOpen = wizard.registerOpen || wizard.voices.length === 0;
    if (e.target.open !== renderedOpen) wizard.registerOpen = e.target.open;
  });
  on('#wizVoiceName', 'input', (e) => {
    wizard.voiceName = e.target.value;
  });
  on('#wizVoiceTranscript', 'input', (e) => {
    wizard.voiceTranscript = e.target.value;
  });
  on('#wizVoiceFile', 'change', (e) => {
    wizard.voiceFile = e.target.files && e.target.files[0] ? e.target.files[0] : null;
  });
  on('#wizVoiceSaveBtn', 'click', guard(async (c) => {
    openVoiceModal('목소리 저장 중', '녹음을 표준 음질로 변환하고 있어요.');
    try {
      await saveVoice(c);
      renderWizard(c);
      // 저장한 목소리로 곧바로 테스트 음성을 생성해 들려준다.
      setVoiceModalStage('테스트 음성 생성 중', `방금 저장한 '${wizard.selectedVoice}' 목소리로 샘플 문장을 읽고 있어요.`);
      await testVoice(c);
      finishVoiceModal({
        title: '목소리가 준비됐어요',
        desc: '들어보고 마음에 들지 않으면 다시 녹음해서 저장하세요.',
        audioUrl: wizard.testAudioUrl,
      });
    } catch (error) {
      finishVoiceModal({ title: '목소리 생성 실패', desc: error.message, error: true });
      throw error;
    }
    renderWizard(c);
  }));
  on('#wizTopic', 'input', (e) => {
    wizard.topic = e.target.value;
  });
  on('#wizProjectName', 'input', (e) => {
    wizard.projectName = e.target.value;
  });
  on('#wizScript', 'input', (e) => {
    wizard.script = e.target.value;
  });
  on('#wizImageProvider', 'change', (e) => {
    wizard.imageProvider = e.target.value;
    if (wizard.imageProvider === 'dropshot') checkDropshotStatus(container);
  });
  on('#wizMotionMode', 'change', (e) => {
    wizard.motionMode = e.target.value;
    renderWizard(container);
  });
  on('#wizMotionEngine', 'change', (e) => {
    wizard.motionEngine = e.target.value;
    renderWizard(container);
  });
  on('#wizScriptMethod', 'change', (e) => {
    wizard.scriptMethod = e.target.value;
  });
  on('#wizTone', 'change', (e) => {
    wizard.tone = e.target.value;
  });
  on('#wizScriptSaveBtn', 'click', guard(async (c) => {
    await saveScriptToLibrary();
    wizard.status = '대본을 보관함에 저장했습니다. 원클릭 제작 → 대본 보관함 탭에서 볼 수 있습니다.';
    renderWizard(c);
  }));
  on('#wizScriptSrtBtn', 'click', guard(async (c) => {
    if (!wizard.script.trim()) throw new Error('먼저 대본을 입력하거나 AI로 생성해 주세요.');
    downloadTextFile(safeSrtName(wizard.topic || '대본'), scriptToSrt(wizard.script, wizard.durationSec));
    wizard.status = 'SRT 자막 파일을 내려받았습니다.';
    renderWizard(c);
  }));
  on('#wizScriptPlayBtn', 'click', (e) => {
    if (e.target.disabled || !wizard.scriptAudio) return;
    // 하단 고정 플레이어로 재생 — 다른 작업을 해도 끊기지 않는다.
    openAudioDock(wizard.scriptAudio, '📜 대본 낭독');
  });
  on('#wizDuration', 'change', (e) => {
    wizard.durationSec = e.target.value;
  });
  on('#wizGenre', 'change', (e) => {
    wizard.genre = e.target.value;
  });
  on('#wizSeriesMode', 'change', (e) => {
    wizard.seriesMode = e.target.value;
    renderWizard(container);
  });
  on('#wizSeriesEpisode', 'input', (e) => {
    wizard.seriesEpisode = e.target.value;
    const episode = Number(e.target.value);
    if (wizard.seriesScripts && wizard.seriesScripts[episode - 1]) {
      wizard.script = wizard.seriesScripts[episode - 1];
      wizard.status = `${episode}화 대본을 불러왔습니다.`;
      renderWizard(container);
    }
  });
  on('#wizSeriesPrevious', 'input', (e) => {
    wizard.seriesPrevious = e.target.value;
  });
  on('#wizScriptGenBtn', 'click', guard(generateScriptWithAi));
  on('#wizRunBtn', 'click', guard(runPipeline));
  // 진행 중 작업이 있으면 패널을 그리고 폴링을 이어간다 (탭을 오가도 유지).
  renderJobsPanel(container);
  if (activeJobCount() > 0) ensureJobsPolling(container);
  on('#wizTemplateSelect', 'change', (e) => {
    wizard.selectedTemplate = e.target.value;
    // 대본이 비어 있을 때만 형식 뼈대를 채워준다(작성 중인 내용은 덮지 않음).
    if (!wizard.script.trim()) applyTemplate();
    renderWizard(container);
  });
  on('#wizScriptListenBtn', 'click', guard(listenScript));
  on('#wizDirectedNarration', 'change', (e) => {
    wizard.directedNarration = e.target.checked;
  });
  on('#wizNarrationStyle', 'change', (e) => {
    wizard.narrationStyle = e.target.value;
    renderWizard(container);
  });
  on('#wizNarrationStrength', 'change', (e) => {
    wizard.narrationStrength = e.target.value;
  });
  on('#wizCustomNarrationStyle', 'input', (e) => {
    wizard.customNarrationStyle = e.target.value;
  });
  // 생성된 장면 이미지를 클릭하면 크게 본다 (그리드는 실시간 갱신되므로 위임 방식).
  on('#wizImageGrid', 'click', (e) => {
    const img = e.target.closest('.wiz-image-tile img');
    if (!img) return;
    const items = wizard.generatedImages.map((src, i) => ({ src, caption: `장면 ${i + 1}` }));
    const figure = img.closest('.wiz-image-tile');
    const index = [...figure.parentElement.children].indexOf(figure);
    openLightbox(items, index);
  });
  on('#wizBgmFile', 'change', (e) => {
    wizard.bgmFile = e.target.files?.[0] ?? null;
    renderWizard(container);
  });
  on('#wizRatio', 'change', (e) => {
    wizard.ratio = e.target.value;
  });
  on('#wizCharGender', 'change', (e) => {
    updateSettings({ characterGender: e.target.value });
  });
  on('#wizCharDesc', 'input', (e) => {
    updateSettings({ characterDesc: e.target.value });
  });
}

/** 채널 주인공 설정을 이미지 프롬프트용 한 줄 묘사로 만든다. */
function characterFromSettings() {
  const settings = getSettings();
  const parts = [];
  if (settings.characterGender) parts.push(`한국인 ${settings.characterGender}`);
  if (settings.characterDesc.trim()) parts.push(settings.characterDesc.trim());
  return parts.join(', ');
}
