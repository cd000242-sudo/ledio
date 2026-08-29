/* global Blob, FileReader, URL, URLSearchParams, document, fetch, navigator, structuredClone, window */
import {
  applyEditPreset,
  analyzeScriptForAutoEdit,
  cutSourceRangeFromClips,
  applyAutoEditPlan,
  buildTimelineSegments,
  deleteCueAt,
  dragTrimClipRange,
  EDIT_SUBTAB_IDS,
  mergeCueWithNext,
  moveItem as moveWorkbenchItem,
  msToSecText,
  normalizeEditSubtab,
  normalizeSelectValue,
  normalizeTtsSettings,
  secToMs,
  setClipSpeed,
  scriptToCaptionCues,
  splitClipAt,
  trimClipRange,
  updateCueAt,
} from './edit-workbench.js';
import { renderImageGalleryTab, renderNarrationStudioTab, renderScriptLibraryTab, renderStoryWizardTab } from './story-wizard.js';
import { renderProductWizardTab } from './product-wizard.js';
import { getSettings, renderSettingsTab } from './settings.js';
import { mountAssistant } from './assistant.js';

const platformLabels = {
  youtube_shorts: '유튜브 쇼츠',
  instagram_reels: '인스타그램 릴스',
  tiktok: '틱톡',
};

const roleLabels = {
  hook: '후킹',
  problem: '문제 제시',
  product: '상품 노출',
  use: '사용 장면',
  result: '결과',
  cta: '행동 유도',
};

const rightsLabels = {
  owned: '직접 촬영',
  licensed: '라이선스',
  official_brand: '공식 브랜드',
  creative_commons: 'CC 허용',
  ai_generated: 'AI 생성',
  permission_pending: '허가 대기',
  reference_only: '참고 전용',
  unknown: '미확인',
};

const usageLabels = {
  edit: '편집 사용',
  reference: '참고만',
};

const imageRightsLabels = {
  ai_generated: 'AI 생성 이미지',
  owned: '직접 제작/촬영',
  licensed: '라이선스 보유',
};

const aiProviderLabels = {
  mock: '테스트 생성',
  dropshot: '드롭샷 나노바나나프로 (무제한)',
  gpt: 'GPT 이미지',
  gemini: 'Gemini 이미지',
  leaders_nano_banana_pro: '리더스 나노바나나프로',
};

const captionProviderLabels = {
  'local-whisper': '음성인식 자막 (Whisper)',
  mock: '테스트 자막',
  'script-analysis': '대본 분석',
};

const editSubtabLabels = {
  media: '파일',
  frame: '편집틀',
  timeline: '타임라인',
  audio: '오디오·TTS',
  captions: '자막',
  storyboard: '이미지 영상화',
};

const durationPresetLabels = {
  15: '15초',
  25: '25초',
  30: '30초',
  45: '45초',
  60: '60초',
  90: '90초',
  180: '180초',
};

const toneLabels = {
  '친근한 리뷰': '친근한 리뷰',
  '고급스럽고 깔끔': '고급스럽고 깔끔',
  '빠른 후킹': '빠른 후킹',
  '차분한 썰채널': '차분한 썰채널',
  '강한 세일즈': '강한 세일즈',
};

const bgmVolumeLabels = {
  0: '끄기',
  0.12: '작게',
  0.18: '기본',
  0.25: '조금 크게',
  0.35: '강하게',
};

const captionLanguageLabels = {
  ko: '한국어',
  en: '영어',
  ja: '일본어',
};

const captionModelLabels = {
  tiny: 'tiny - 빠른 테스트',
  base: 'base - 기본',
  small: 'small - 품질 우선',
  medium: 'medium - 고품질',
  'large-v3': 'large-v3 - 최고 품질',
};

const captionMinCharLabels = {
  6: '짧게 6자',
  8: '기본 8자',
  12: '안정 12자',
  16: '긴 문장 16자',
};

const captionStyleLabels = {
  basic: '기본 · 흰 글자+박스',
  'bold-yellow': '예능 · 노란 글자',
  'clean-white': '깔끔 · 테두리 글자',
  'strong-box': '강조 · 진한 박스',
};

const transitionLabels = {
  none: '없음 · 바로 전환',
  fade: '페이드 · 부드럽게',
  'slow-fade': '느린 페이드 · 감성',
};

const stickerPositionLabels = {
  top: '상단',
  center: '중앙',
  bottom: '하단',
};

const captionMaxCharLabels = {
  24: '짧게 24자',
  28: '기본 28자',
  36: '읽기 편한 36자',
  48: '긴 문장 48자',
};

const linkPlacementLabels = {
  profile_link: '프로필 링크로 유도',
  fixed_comment: '고정 댓글 링크',
  description: '설명란 링크',
  profile_and_comment: '프로필 링크 + 고정 댓글',
};

const variantCountLabels = {
  1: '1개',
  3: '3개',
  5: '5개',
  10: '10개',
  20: '20개',
};

const silenceNoiseLabels = {
  '-45': '매우 엄격 -45dB',
  '-40': '엄격 -40dB',
  '-35': '기본 -35dB',
  '-30': '느슨함 -30dB',
};

const silenceMinLabels = {
  0.3: '짧은 무음 0.3초',
  0.6: '기본 0.6초',
  1: '긴 무음 1초',
  1.5: '확실한 공백 1.5초',
};

const silencePaddingLabels = {
  0: '여백 없음',
  0.05: '아주 짧게 0.05초',
  0.08: '기본 0.08초',
  0.15: '자연스럽게 0.15초',
};

const ttsProviderLabels = {
  mock: '테스트 음성',
  openai: 'OpenAI TTS',
  elevenlabs: 'ElevenLabs',
  system: '시스템 음성',
};

const ttsVoiceLabels = {
  'ko-female-bright': '한국어 여성 · 밝고 또렷',
  'ko-male-calm': '한국어 남성 · 차분',
  'ko-story-warm': '썰채널 · 따뜻한 내레이션',
  'ko-news-clear': '정보형 · 정확한 발음',
};

const ttsSpeedLabels = {
  0.85: '느리게',
  1: '기본',
  1.1: '조금 빠르게',
  1.25: '빠르게',
};

const ttsScriptSourceLabels = {
  story: 'AI 스토리 대본',
  captions: '자동자막 문장',
  hook: '상품 후킹 문구',
};

const ttsVolumeLabels = {
  0.7: '작게',
  0.8: '조금 작게',
  0.9: '기본',
  1: '크게',
};

const tabs = [
  { id: 'wizard', label: '원클릭 제작', title: '원클릭 제작', eyebrow: '대본/클립 → 완성 영상' },
  { id: 'manual', label: '수동편집하기', title: '수동 편집', eyebrow: '타임라인과 세부 도구' },
  { id: 'settings', label: '환경설정', title: '환경설정', eyebrow: '기본값과 도구 상태' },
];

// 수동편집 안의 서브 도구 id들(옛 탭 이동 흐름 호환용)
const manualSubIds = ['edit', 'plan', 'output', 'story', 'ai', 'longform', 'platform', 'sources', 'performance', 'guide'];

// 수동편집 그룹 내비게이션 — 편집 세부탭을 최상위로 승격해 이중 탭을 없앤다(기능 손실 없음)
const manualNavGroups = [
  {
    label: '편집 도구',
    items: EDIT_SUBTAB_IDS.map((id) => ({
      id: `edit:${id}`,
      label: id === 'media' ? '파일 추가' : id === 'timeline' ? '장면 목록(상세)' : editSubtabLabels[id],
    })),
  },
  {
    label: '콘텐츠 만들기',
    items: [
      { id: 'story', label: 'AI 스토리' },
      { id: 'ai', label: 'AI엔진' },
      { id: 'longform', label: '롱폼' },
    ],
  },
  {
    label: '게시 준비',
    items: [
      { id: 'plan', label: '기획' },
      { id: 'platform', label: '플랫폼' },
      { id: 'sources', label: '저작권' },
    ],
  },
  {
    label: '완성·관리',
    items: [
      { id: 'output', label: '출력' },
      { id: 'performance', label: '성과' },
      { id: 'guide', label: '사용법' },
    ],
  },
];

const platformIds = Object.keys(platformLabels);
const roleIds = Object.keys(roleLabels);
const essentialRoles = ['hook', 'use', 'result'];
const rightsIds = Object.keys(rightsLabels);
const usageIds = Object.keys(usageLabels);
const imageRightsIds = Object.keys(imageRightsLabels);
const aiProviderIds = Object.keys(aiProviderLabels);
const captionProviderIds = Object.keys(captionProviderLabels);
const durationPresetIds = Object.keys(durationPresetLabels);
const toneIds = Object.keys(toneLabels);
const bgmVolumeIds = Object.keys(bgmVolumeLabels);
const captionLanguageIds = Object.keys(captionLanguageLabels);
const captionModelIds = Object.keys(captionModelLabels);
const captionStyleIds = Object.keys(captionStyleLabels);
const transitionIds = Object.keys(transitionLabels);
const stickerPositionIds = Object.keys(stickerPositionLabels);
const captionMinCharIds = Object.keys(captionMinCharLabels);
const captionMaxCharIds = Object.keys(captionMaxCharLabels);
const linkPlacementIds = Object.keys(linkPlacementLabels);
const variantCountIds = Object.keys(variantCountLabels);
const silenceNoiseIds = Object.keys(silenceNoiseLabels);
const silenceMinIds = Object.keys(silenceMinLabels);
const silencePaddingIds = Object.keys(silencePaddingLabels);
const ttsProviderIds = Object.keys(ttsProviderLabels);
const ttsVoiceIds = Object.keys(ttsVoiceLabels);
const ttsSpeedIds = Object.keys(ttsSpeedLabels);
const ttsScriptSourceIds = Object.keys(ttsScriptSourceLabels);
const ttsVolumeIds = Object.keys(ttsVolumeLabels);
const minimumPerformanceRecords = 5;

const performanceTemplate = [
  'videoFile,platform,postedUrl,views,clicks,orders,revenue,cost,notes',
  'video_01.mp4,youtube_shorts,https://example.com/post/1,1000,50,5,50000,12000,첫 영상',
  'video_02.mp4,instagram_reels,https://example.com/post/2,800,30,2,22000,8000,릴스 테스트',
  'video_03.mp4,tiktok,https://example.com/post/3,1500,80,7,74000,15000,틱톡 테스트',
  'video_04.mp4,youtube_shorts,https://example.com/post/4,900,25,1,10000,7000,후킹 비교',
  'video_05.mp4,tiktok,https://example.com/post/5,2200,110,9,99000,18000,확장 후보',
].join('\n');

// 빈 프로젝트로 시작한다. 예시 데이터는 사용자가 직접 채우기 전까지 넣지 않는다.
const defaultDraft = {
  projectName: 'my-shorts-001',
  product: {
    name: '',
    category: '',
    priceMin: '',
    priceMax: '',
    affiliateUrl: '',
    painPoint: '',
    benefit: '',
  },
  disclosure: {
    type: 'affiliate',
    text: '이 콘텐츠는 제휴 링크를 포함하며 구매 시 수수료를 받을 수 있습니다.',
  },
  style: {
    duration: '25',
    // 수동편집 기본은 롱폼(가로) 기준 — 숏츠는 원클릭 제작에서 만든다.
    ratio: '16:9',
    resolution: '1920x1080',
    tone: '친근한 리뷰',
    captionPosition: 'bottom',
    captionStyle: 'basic',
    transition: 'none',
    bgmVolume: '0.18',
  },
  bgm: { file: '' },
  clips: [],
  stickers: [],
  variants: { count: '5' },
  publish: {
    campaignName: '',
    platforms: ['youtube_shorts', 'instagram_reels', 'tiktok'],
    hashtags: [],
    cta: '',
    fixedComment: '',
    linkPlacement: 'profile_link',
  },
  sources: [],
  story: {
    title: '',
    script: '',
  },
  longform: {
    file: '',
    duration: '',
    productName: '',
    affiliateUrl: '',
  },
};

const state = {
  draft: structuredClone(defaultDraft),
  manifest: null,
  risk: null,
  selectedTab: 'wizard',
  wizardSub: 'ai',
  manualSub: 'edit',
  advancedOpen: false,
  voiceList: null,
  previewPlayer: { playing: false, mode: 'edited' },
  automationOpen: { silence: false, captions: false, textedit: true, voice: false, speed: false },
  workbenchCollapsed: false,
  timelineZoom: 1,
  selectedPlatform: 'youtube_shorts',
  selectedVideo: 'video_01.mp4',
  localProjectPath: '',
  status: '작성 중',
  commandOutput: '',
  performanceCsv: '',
  imageScenes: [],
  imageRights: 'ai_generated',
  silence: {
    clipFile: '',
    noiseDb: '-35',
    minDurationSec: '0.6',
    paddingSec: '0.08',
    report: null,
  },
  captions: {
    clipFile: '',
    provider: 'local-whisper',
    language: 'ko',
    model: 'base',
    minChars: '8',
    maxChars: '28',
    report: null,
    tools: null,
  },
  edit: {
    selectedClipIndex: 0,
    playheadSec: 0,
    subtab: 'media',
    autoPlan: null,
  },
  tts: {
    provider: 'mock',
    voice: 'ko-female-bright',
    speed: '1',
    scriptSource: 'story',
    volume: '0.9',
  },
  ai: {
    provider: 'mock',
    apiKey: '',
    endpoint: '',
    models: {
      gpt: 'gpt-5.5',
      gemini: 'gemini-3-pro-image-preview',
      leaders_nano_banana_pro: 'nano-banana-pro',
      mock: 'mock-1x1-png',
    },
  },
  useLoadedManifest: false,
  useLoadedRisk: false,
};

function byId(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`화면 요소를 찾을 수 없습니다: ${id}`);
  return element;
}

function clean(value) {
  return String(value ?? '').trim();
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function intValue(value, fallback = 1) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function unique(values) {
  return Array.from(new Set(values));
}

function isValidUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function parseTags(value) {
  if (Array.isArray(value)) return value.map((tag) => clean(tag).replace(/^#/, '')).filter(Boolean);
  return String(value ?? '')
    .split(/[,\s]+/)
    .map((tag) => clean(tag).replace(/^#/, ''))
    .filter(Boolean);
}

function formatTags(tags) {
  return parseTags(tags)
    .map((tag) => `#${tag}`)
    .join(' ');
}

function trimLine(value, maxLength) {
  const text = clean(value).replace(/\s+/g, ' ');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

function pad2(value) {
  return String(value).padStart(2, '0');
}

function safeFileName(value, fallback = 'media') {
  const withoutControlChars = Array.from(String(value ?? '')).filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 32 && code !== 127;
  });
  const cleaned = withoutControlChars
    .join('')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.replace(/^\.+/, '').slice(0, 120) || fallback;
}

function nextRole(index) {
  return roleIds[index % roleIds.length] ?? 'product';
}

function roleForStoryScene(index, total) {
  if (index === 0) return 'hook';
  if (index === total - 1) return 'result';
  if (index === Math.floor(total / 2)) return 'use';
  return ['problem', 'product', 'cta'][(index - 1) % 3] ?? 'problem';
}

function draftPriceRange() {
  const min = clean(state.draft.product.priceMin) || '0';
  const max = clean(state.draft.product.priceMax) || min;
  return `${min}-${max}`;
}

function makeHook() {
  const pain = clean(state.draft.product.painPoint);
  const benefit = clean(state.draft.product.benefit);
  if (pain && benefit) return trimLine(`${pain}이라면 ${benefit}`, 74);
  return trimLine(benefit || pain || `${state.draft.product.name} 핵심 장점`, 74);
}

function linkPlacementCue(value = state.draft.publish.linkPlacement) {
  if (value === 'fixed_comment') return '고정 댓글에서 링크 확인';
  if (value === 'description') return '설명란 링크 확인';
  if (value === 'profile_and_comment') return '프로필 링크와 고정 댓글 확인';
  return '프로필 링크에서 확인';
}

function buildCaption() {
  return [
    makeHook(),
    clean(state.draft.product.benefit),
    clean(state.draft.publish.cta),
    clean(state.draft.disclosure.text),
    formatTags(state.draft.publish.hashtags),
  ]
    .filter(Boolean)
    .join('\n');
}

function variantFiles() {
  const count = Math.min(20, Math.max(1, intValue(state.draft.variants.count, 1)));
  return Array.from({ length: count }, (_, index) => `video_${pad2(index + 1)}.mp4`);
}

function buildManifestFromDraft() {
  const platforms = state.draft.publish.platforms.length > 0 ? state.draft.publish.platforms : ['youtube_shorts'];
  const hook = makeHook();
  const caption = buildCaption();
  const title = trimLine(`${state.draft.product.name} | ${hook}`, 88);
  const files = variantFiles();

  return {
    projectName: clean(state.draft.projectName),
    campaignName: clean(state.draft.publish.campaignName) || clean(state.draft.projectName),
    productName: clean(state.draft.product.name),
    affiliateUrl: clean(state.draft.product.affiliateUrl),
    disclosure: clean(state.draft.disclosure.text),
    linkPlacement: state.draft.publish.linkPlacement,
    generatedAt: new Date().toISOString(),
    platforms,
    items: files.flatMap((videoFile, fileIndex) =>
      platforms.map((platform) => ({
        platform,
        platformLabel: platformLabels[platform] ?? platform,
        videoFile,
        title: fileIndex === 0 ? title : trimLine(`${state.draft.product.name} | ${hook} ${fileIndex + 1}`, 88),
        caption,
        fixedComment: clean(state.draft.publish.fixedComment),
        affiliateUrl: clean(state.draft.product.affiliateUrl),
        linkPlacement: state.draft.publish.linkPlacement,
        linkCue: linkPlacementCue(),
        hashtags: parseTags(state.draft.publish.hashtags),
        hook,
      })),
    ),
  };
}

function normalizeSource(source) {
  const locator = clean(source.url || source.file);
  return {
    title: clean(source.title),
    url: isValidUrl(locator) ? locator : '',
    file: isValidUrl(locator) ? '' : locator,
    rights: source.rights,
    usage: source.usage,
    notes: clean(source.notes),
  };
}

function sourceItemsFromDraft() {
  const clipSources = state.draft.clips
    .filter((clip) => clean(clip.file))
    .map((clip) => ({
      title: `${roleLabels[clip.role] ?? clip.role} 클립`,
      file: clean(clip.file),
      url: '',
      rights: 'owned',
      usage: 'edit',
      notes: '편집 타임라인 클립',
    }));
  const boardSources = state.draft.sources.map(normalizeSource).filter((source) => source.title && (source.url || source.file));
  return [...clipSources, ...boardSources];
}

function assessSource(source) {
  if (source.usage === 'reference') {
    if (source.rights === 'unknown' || source.rights === 'permission_pending') {
      return { level: 'caution', reason: '참고용이지만 권리 상태 확인이 필요합니다.' };
    }
    return { level: 'safe', reason: '참고 전용으로 분리되어 직접 편집 소스로 쓰지 않습니다.' };
  }
  if (['owned', 'licensed', 'official_brand', 'creative_commons', 'ai_generated'].includes(source.rights)) {
    return { level: 'safe', reason: '편집 사용 가능한 권리 상태입니다.' };
  }
  if (source.rights === 'reference_only') {
    return { level: 'risk', reason: '참고 전용 소스를 편집 사용으로 설정했습니다.' };
  }
  return { level: 'caution', reason: '편집 전 권리 확인 또는 사용 허가 기록이 필요합니다.' };
}

function buildRiskFromDraft() {
  const items = sourceItemsFromDraft().map((source) => ({ ...source, ...assessSource(source) }));
  return {
    projectName: clean(state.draft.projectName),
    summary: {
      safe: items.filter((item) => item.level === 'safe').length,
      caution: items.filter((item) => item.level === 'caution').length,
      risk: items.filter((item) => item.level === 'risk').length,
    },
    items,
  };
}

function syncDerived() {
  if (!state.useLoadedManifest) state.manifest = buildManifestFromDraft();
  if (!state.useLoadedRisk) state.risk = buildRiskFromDraft();
  state.edit.subtab = normalizeEditSubtab(state.edit.subtab);
  state.draft.style.duration = normalizeSelectValue(state.draft.style.duration, durationPresetIds, '25');
  state.draft.style.tone = normalizeSelectValue(state.draft.style.tone, toneIds, '친근한 리뷰');
  state.draft.style.bgmVolume = normalizeSelectValue(state.draft.style.bgmVolume, bgmVolumeIds, '0.18');
  state.draft.variants.count = normalizeSelectValue(state.draft.variants.count, variantCountIds, '5');
  state.silence.noiseDb = normalizeSelectValue(state.silence.noiseDb, silenceNoiseIds, '-35');
  state.silence.minDurationSec = normalizeSelectValue(state.silence.minDurationSec, silenceMinIds, '0.6');
  state.silence.paddingSec = normalizeSelectValue(state.silence.paddingSec, silencePaddingIds, '0.08');
  state.captions.language = normalizeSelectValue(state.captions.language, captionLanguageIds, 'ko');
  state.captions.model = normalizeSelectValue(state.captions.model, captionModelIds, 'base');
  state.captions.minChars = normalizeSelectValue(state.captions.minChars, captionMinCharIds, '8');
  state.captions.maxChars = normalizeSelectValue(state.captions.maxChars, captionMaxCharIds, '28');
  state.draft.publish.linkPlacement = normalizeSelectValue(state.draft.publish.linkPlacement, linkPlacementIds, 'profile_link');
  state.tts = normalizeTtsSettings(state.tts);
  if (!state.edit.autoPlan) state.edit.autoPlan = null;
  state.imageScenes = state.imageScenes.map((scene, index) => ({
    ...scene,
    narration: clean(scene.narration) || `장면 ${index + 1}`,
    caption: clean(scene.caption) || clean(scene.narration) || `장면 ${index + 1}`,
    durationSec: clean(scene.durationSec) || '4',
  }));
  const platforms = state.manifest.platforms?.length ? state.manifest.platforms : ['youtube_shorts'];
  if (!platforms.includes(state.selectedPlatform)) state.selectedPlatform = platforms[0];
  const videos = getVideoFiles();
  if (!videos.includes(state.selectedVideo)) state.selectedVideo = videos[0] ?? '';
  const clipFiles = state.draft.clips.map((clip) => clip.file).filter(Boolean);
  if (!clipFiles.includes(state.silence.clipFile)) state.silence.clipFile = clipFiles[0] ?? '';
  if (!clipFiles.includes(state.captions.clipFile)) state.captions.clipFile = clipFiles[0] ?? '';
  if (state.draft.clips.length === 0) {
    state.edit.selectedClipIndex = 0;
    state.edit.playheadSec = 0;
  } else {
    state.edit.selectedClipIndex = Math.min(Math.max(0, state.edit.selectedClipIndex), state.draft.clips.length - 1);
    state.edit.playheadSec = Math.min(Math.max(0, state.edit.playheadSec), selectedDuration());
  }
}

function getVideoFiles() {
  return unique((state.manifest?.items ?? []).map((item) => item.videoFile).filter(Boolean));
}

function getSelectedItem() {
  return (
    state.manifest?.items?.find(
      (item) => item.platform === state.selectedPlatform && item.videoFile === state.selectedVideo,
    ) ??
    state.manifest?.items?.[0] ??
    null
  );
}

function selectedDuration() {
  return buildTimelineSegments(state.draft.clips).totalDurationSec;
}

function selectedClip() {
  return state.draft.clips[state.edit.selectedClipIndex] ?? null;
}

function selectedTimelineSegment() {
  const { segments } = buildTimelineSegments(state.draft.clips);
  return segments[state.edit.selectedClipIndex] ?? null;
}

function mediaPreviewUrl(clip) {
  if (!clip?.file) return '';
  const params = new URLSearchParams({ file: clip.file });
  if (state.localProjectPath) {
    params.set('projectPath', state.localProjectPath);
  } else {
    params.set('projectName', state.draft.projectName);
  }
  return `/api/media/preview?${params.toString()}`;
}

/** 클립 구간의 오디오 파형(물결) PNG URL — 타임라인 오디오 레인 배경으로 쓴다. */
function waveformUrl(file, startSec, endSec) {
  if (!file) return '';
  const params = new URLSearchParams({ file });
  if (state.localProjectPath) {
    params.set('projectPath', state.localProjectPath);
  } else {
    params.set('projectName', state.draft.projectName);
  }
  if (Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec) {
    params.set('start', startSec.toFixed(2));
    params.set('end', endSec.toFixed(2));
  }
  return `/api/media/waveform?${params.toString()}`;
}

// ── 되돌리기/다시하기: 편집 내용(draft) 스냅숏 히스토리 ──

const draftHistory = { past: [], future: [] };
let lastHistoryTag = '';
let lastHistoryAt = 0;

/** 변경 직전에 호출해 현재 상태를 저장한다. 타이핑(-field 태그)은 900ms 안에 합쳐진다. */
function pushHistory(tag = 'action') {
  const now = Date.now();
  const mergeable = tag.endsWith('field');
  if (mergeable && tag === lastHistoryTag && now - lastHistoryAt < 900) {
    lastHistoryAt = now;
    return;
  }
  draftHistory.past.push(structuredClone(state.draft));
  if (draftHistory.past.length > 50) draftHistory.past.shift();
  draftHistory.future = [];
  lastHistoryTag = tag;
  lastHistoryAt = now;
  const undoBtn = document.getElementById('tlUndoBtn');
  if (undoBtn) undoBtn.disabled = false;
}

function afterHistoryRestore(statusText) {
  state.edit.selectedClipIndex = Math.min(state.edit.selectedClipIndex, Math.max(0, state.draft.clips.length - 1));
  state.useLoadedManifest = false;
  state.useLoadedRisk = false;
  lastHistoryTag = '';
  state.status = statusText;
  renderAll();
}

function undoDraft() {
  if (draftHistory.past.length === 0) {
    state.status = '되돌릴 작업이 없습니다.';
    refreshChrome();
    return;
  }
  draftHistory.future.push(structuredClone(state.draft));
  state.draft = draftHistory.past.pop();
  afterHistoryRestore(`되돌렸습니다. (남은 ${draftHistory.past.length}단계)`);
}

function redoDraft() {
  if (draftHistory.future.length === 0) {
    state.status = '다시 실행할 작업이 없습니다.';
    refreshChrome();
    return;
  }
  draftHistory.past.push(structuredClone(state.draft));
  state.draft = draftHistory.future.pop();
  afterHistoryRestore('다시 실행했습니다.');
}

function setDraftClips(nextClips, status) {
  pushHistory('clips');
  state.draft.clips = nextClips;
  state.useLoadedManifest = false;
  state.useLoadedRisk = false;
  if (status) state.status = status;
}

function missingEssentialRoles() {
  const used = new Set(state.draft.clips.map((clip) => clip.role));
  return essentialRoles.filter((role) => !used.has(role));
}

function validateDraft() {
  const errors = [];
  const warnings = [];
  if (!clean(state.draft.projectName)) errors.push('프로젝트명이 필요합니다.');
  if (!clean(state.draft.product.name)) errors.push('상품명이 필요합니다.');
  if (!isValidUrl(state.draft.product.affiliateUrl)) errors.push('제휴 링크는 http 또는 https URL이어야 합니다.');
  if (!clean(state.draft.disclosure.text)) errors.push('제휴/광고 고지 문구가 필요합니다.');
  if (state.draft.publish.platforms.length === 0) errors.push('업로드 플랫폼을 하나 이상 선택하세요.');
  if (state.draft.clips.length === 0) errors.push('영상 클립이 하나 이상 필요합니다.');

  const missing = missingEssentialRoles();
  if (missing.length > 0) warnings.push(`권장 장면이 부족합니다: ${missing.map((role) => roleLabels[role]).join(', ')}`);

  state.draft.clips.forEach((clip, index) => {
    if (!clean(clip.file)) errors.push(`${index + 1}번 클립 파일 경로가 비어 있습니다.`);
    const start = numberValue(clip.start);
    const end = numberValue(clip.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      errors.push(`${index + 1}번 클립의 시작/종료 시간이 올바르지 않습니다.`);
    }
  });

  const riskCount = state.risk?.summary?.risk ?? 0;
  const cautionCount = state.risk?.summary?.caution ?? 0;
  if (riskCount > 0) errors.push(`저작권 위험 소스 ${riskCount}개를 정리해야 합니다.`);
  if (cautionCount > 0) warnings.push(`권리 확인이 필요한 소스 ${cautionCount}개가 있습니다.`);
  return { errors, warnings };
}

function yamlString(value) {
  return JSON.stringify(String(value ?? ''));
}

function yamlNumber(value, fallback) {
  const parsed = numberValue(value);
  return Number.isFinite(parsed) ? String(parsed) : String(fallback);
}

function toProjectYaml() {
  const lines = [
    `projectName: ${yamlString(clean(state.draft.projectName))}`,
    '',
    'product:',
    `  name: ${yamlString(clean(state.draft.product.name))}`,
    `  category: ${yamlString(clean(state.draft.product.category))}`,
    `  priceRange: ${yamlString(draftPriceRange())}`,
    `  affiliateUrl: ${yamlString(clean(state.draft.product.affiliateUrl))}`,
    `  painPoint: ${yamlString(clean(state.draft.product.painPoint))}`,
    `  benefit: ${yamlString(clean(state.draft.product.benefit))}`,
    '',
    'disclosure:',
    `  type: ${yamlString(clean(state.draft.disclosure.type))}`,
    `  text: ${yamlString(clean(state.draft.disclosure.text))}`,
    '',
    'style:',
    `  duration: ${yamlNumber(state.draft.style.duration, 25)}`,
    `  ratio: ${yamlString(clean(state.draft.style.ratio))}`,
    `  resolution: ${yamlString(clean(state.draft.style.resolution))}`,
    `  tone: ${yamlString(clean(state.draft.style.tone))}`,
    `  captionPosition: ${yamlString(clean(state.draft.style.captionPosition))}`,
    `  captionStyle: ${yamlString(clean(state.draft.style.captionStyle) || 'basic')}`,
    `  transition: ${yamlString(clean(state.draft.style.transition) || 'none')}`,
    `  bgmVolume: ${yamlNumber(state.draft.style.bgmVolume, 0.18)}`,
  ];

  if (clean(state.draft.bgm.file)) {
    lines.push('', 'bgm:', `  file: ${yamlString(clean(state.draft.bgm.file))}`);
  }

  lines.push('', 'clips:');
  state.draft.clips.forEach((clip) => {
    lines.push(
      `  - file: ${yamlString(clean(clip.file))}`,
      `    role: ${yamlString(clip.role)}`,
      `    start: ${yamlNumber(clip.start, 0)}`,
      `    end: ${yamlNumber(clip.end, 1)}`,
    );
    if (clean(clip.speed) && clean(clip.speed) !== '1') lines.push(`    speed: ${yamlNumber(clip.speed, 1)}`);
    if (clip.mute) lines.push('    mute: true');
  });

  const stickerRows = state.draft.stickers.filter((sticker) => clean(sticker.text));
  if (stickerRows.length > 0) {
    lines.push('', 'stickers:');
    stickerRows.forEach((sticker) => {
      lines.push(
        `  - text: ${yamlString(clean(sticker.text))}`,
        `    start: ${yamlNumber(sticker.start, 0)}`,
        `    end: ${yamlNumber(sticker.end, 1)}`,
        `    position: ${yamlString(sticker.position || 'center')}`,
      );
    });
  }

  lines.push('', 'variants:', `  count: ${Math.min(20, Math.max(1, intValue(state.draft.variants.count, 1)))}`);
  lines.push('', 'publish:', `  campaignName: ${yamlString(clean(state.draft.publish.campaignName))}`, '  platforms:');
  state.draft.publish.platforms.forEach((platform) => lines.push(`    - ${platform}`));
  lines.push('  hashtags:');
  parseTags(state.draft.publish.hashtags).forEach((tag) => lines.push(`    - ${yamlString(tag)}`));
  lines.push(
    `  linkPlacement: ${yamlString(state.draft.publish.linkPlacement)}`,
    `  cta: ${yamlString(clean(state.draft.publish.cta))}`,
    `  fixedComment: ${yamlString(clean(state.draft.publish.fixedComment))}`,
    '',
    'sources:',
  );

  state.draft.sources.forEach((source) => {
    const normalized = normalizeSource(source);
    lines.push(`  - title: ${yamlString(normalized.title)}`);
    if (normalized.url) lines.push(`    url: ${yamlString(normalized.url)}`);
    if (normalized.file) lines.push(`    file: ${yamlString(normalized.file)}`);
    lines.push(
      `    rights: ${normalized.rights}`,
      `    usage: ${normalized.usage}`,
      `    notes: ${yamlString(normalized.notes)}`,
    );
  });

  return `${lines.join('\n')}\n`;
}

function splitStoryScript(script, maxChars = 150) {
  const sentences = String(script)
    .split(/(?<=[.!?。！？])\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
  const scenes = [];
  let current = '';
  sentences.forEach((sentence) => {
    const next = current ? `${current} ${sentence}` : sentence;
    if (current && [...next].length > maxChars) {
      scenes.push(current);
      current = sentence;
    } else {
      current = next;
    }
  });
  if (current) scenes.push(current);
  return scenes.length > 0 ? scenes : [String(script).trim()].filter(Boolean);
}

function buildStoryPlan() {
  const scenes = splitStoryScript(state.draft.story.script);
  return {
    projectName: `${state.draft.projectName}-story`,
    title: clean(state.draft.story.title),
    sceneCount: scenes.length,
    scenes: scenes.map((scene, index) => ({
      index: index + 1,
      narration: scene,
      caption: trimLine(scene, 72),
      imagePrompt: `${state.draft.style.ratio === '16:9' ? '가로형 16:9' : '세로형 9:16'} 영상 장면, ${state.draft.story.title}, 장면 ${index + 1}, ${scene}, 선명한 피사체, 이미지 안에 글자 없음`,
    })),
  };
}

function buildLongformPlan() {
  const durationSec = Math.max(1, numberValue(state.draft.longform.duration) || 1);
  const starts = [0, 60, 135, 210].filter((start) => start < durationSec - 8);
  const candidates = starts.slice(0, 4).map((start, index) => {
    const end = Math.min(durationSec, start + 45);
    return {
      index: index + 1,
      start,
      end,
      duration: Number((end - start).toFixed(2)),
      score: Number((100 - Math.abs(45 - (end - start))).toFixed(2)),
      reason: index === 0 ? '초반 후킹 후보' : '전환 구간 후보',
    };
  });
  return {
    projectName: `${state.draft.projectName}-longform`,
    file: clean(state.draft.longform.file),
    productName: clean(state.draft.longform.productName),
    affiliateUrl: clean(state.draft.longform.affiliateUrl),
    candidates,
  };
}

function parseCsvLine(line) {
  const cells = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parsePerformanceCsv(csv) {
  const lines = String(csv ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return { records: [], errors: [] };
  const headers = parseCsvLine(lines[0]);
  const required = ['videoFile', 'platform', 'postedUrl', 'views', 'clicks', 'orders', 'revenue', 'cost'];
  const missing = required.filter((field) => !headers.includes(field));
  if (missing.length > 0) return { records: [], errors: [`누락된 열: ${missing.join(', ')}`] };

  const records = [];
  const errors = [];
  lines.slice(1).forEach((line, index) => {
    const values = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, values[cellIndex] ?? '']));
    const numberFields = ['views', 'clicks', 'orders', 'revenue', 'cost'];
    const invalid = numberFields.find((field) => !Number.isFinite(Number(row[field])) || Number(row[field]) < 0);
    if (!platformIds.includes(row.platform)) errors.push(`${index + 2}행 플랫폼 확인`);
    else if (!isValidUrl(row.postedUrl)) errors.push(`${index + 2}행 게시 URL 확인`);
    else if (invalid) errors.push(`${index + 2}행 숫자 확인: ${invalid}`);
    else {
      records.push({
        videoFile: row.videoFile,
        platform: row.platform,
        postedUrl: row.postedUrl,
        views: Number(row.views),
        clicks: Number(row.clicks),
        orders: Number(row.orders),
        revenue: Number(row.revenue),
        cost: Number(row.cost),
        notes: row.notes ?? '',
      });
    }
  });
  return { records, errors };
}

function summarizePerformance(records) {
  const totals = records.reduce(
    (sum, record) => ({
      views: sum.views + record.views,
      clicks: sum.clicks + record.clicks,
      orders: sum.orders + record.orders,
      revenue: sum.revenue + record.revenue,
      cost: sum.cost + record.cost,
    }),
    { views: 0, clicks: 0, orders: 0, revenue: 0, cost: 0 },
  );
  return {
    recordCount: records.length,
    ...totals,
    profit: totals.revenue - totals.cost,
    ctr: totals.views > 0 ? totals.clicks / totals.views : 0,
    cvr: totals.clicks > 0 ? totals.orders / totals.clicks : 0,
  };
}

function formatNumber(value) {
  return new Intl.NumberFormat('ko-KR').format(Math.round(value));
}

function formatMoney(value) {
  return new Intl.NumberFormat('ko-KR', { style: 'currency', currency: 'KRW', maximumFractionDigits: 0 }).format(value);
}

function formatRate(value) {
  return `${(value * 100).toFixed(2)}%`;
}

function changeDraft(mutator) {
  pushHistory('draft-field');
  mutator(state.draft);
  state.useLoadedManifest = false;
  state.useLoadedRisk = false;
  refreshChrome();
}

function refreshChrome() {
  syncDerived();
  renderPreview();
  renderActionPanel();
}

function renderMainTabs() {
  const container = byId('mainTabs');
  container.replaceChildren(
    ...tabs.map((tab) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `tab-button${tab.id === state.selectedTab ? ' active' : ''}`;
      button.textContent = tab.label;
      button.addEventListener('click', () => {
        state.selectedTab = tab.id;
        renderAll();
      });
      return button;
    }),
  );
}

function renderAutoSilenceList(activeClip) {
  const container = document.getElementById('autoSilenceList');
  if (!container) return;
  const report = state.silence.report;
  const plan = report?.plan;
  if (!activeClip?.file) {
    container.innerHTML = '<p class="note">클립을 선택하면 무음구간을 분석할 수 있습니다.</p>';
    return;
  }
  if (report?.clip?.file !== activeClip.file || !plan) {
    container.innerHTML = '<p class="note">무음구간 분석을 누르면 삭제 후보가 여기에 표시됩니다.</p>';
    return;
  }
  const rows = (plan.remove ?? [])
    .slice(0, 4)
    .map(
      (range, index) => `
        <article class="preview-silence-row">
          <strong>삭제 ${pad2(index + 1)}</strong>
          <span>${Number(range.start).toFixed(2)}s - ${Number(range.end).toFixed(2)}s</span>
        </article>
      `,
    )
    .join('');
  container.innerHTML =
    rows ||
    `<p class="note">삭제 후보 없음 · 원본 ${Number(plan.sourceDurationSec).toFixed(2)}s, 결과 ${Number(plan.outputDurationSec).toFixed(2)}s</p>`;
}

function renderPreviewQuickEditor(activeSegment, activeClip, totalDurationSec) {
  const playheadField = byId('previewPlayheadField');
  const hasClip = Boolean(activeClip && activeSegment);
  const sourceStart = activeSegment?.sourceStartSec ?? 0;
  const currentSource = hasClip ? sourceTimeFromPlayhead(activeSegment) : 0;

  playheadField.max = String(Math.max(totalDurationSec, 0.01));
  playheadField.value = String(Math.min(state.edit.playheadSec, Math.max(totalDurationSec, 0.01)));
  playheadField.disabled = !hasClip;

  byId('previewPlayheadLabel').textContent = `재생 ${secLabel(state.edit.playheadSec)} · 원본 ${secLabel(currentSource)}`;
  byId('previewTrimLabel').textContent = hasClip
    ? `${roleLabels[activeClip.role] ?? activeClip.role} · ${secLabel(sourceStart)} - ${secLabel(activeSegment.sourceEndSec)}`
    : '선택된 클립 없음';
  byId('previewBgmVolumeField').value = state.draft.style.bgmVolume;
  byId('previewPlayBtn').textContent = state.previewPlayer.playing ? '⏸ 일시정지' : '▶ 재생';
  byId('previewModeBtn').textContent = state.previewPlayer.mode === 'edited' ? '편집본' : '원본';
}

function isImageFile(file) {
  return /\.(png|jpe?g|webp|gif|bmp)$/i.test(String(file ?? ''));
}

function renderPreview() {
  const { totalDurationSec } = buildTimelineSegments(state.draft.clips);
  const activeSegment = selectedTimelineSegment();
  const activeClip = selectedClip();
  const selectedName = activeClip?.file ? activeClip.file.split('/').pop() : '';
  byId('previewTitle').textContent = selectedName || '파일을 추가하세요';
  byId('previewPlatformBadge').textContent = state.draft.style.resolution;
  byId('previewRatioField').value = state.draft.style.ratio;
  byId('previewVideo').textContent = activeClip
    ? `${pad2(state.edit.selectedClipIndex + 1)}/${pad2(state.draft.clips.length)} · ${isImageFile(activeClip.file) ? '이미지' : '영상'}`
    : '선택된 파일 없음';
  byId('previewDuration').textContent = `${totalDurationSec.toFixed(1)}초`;
  byId('phoneFrame').dataset.ratio = state.draft.style.ratio;

  renderPreviewQuickEditor(activeSegment, activeClip, totalDurationSec);

  const overlay = document.getElementById('previewCaptionOverlay');
  if (overlay) {
    const cueText = clean(state.captions.report?.cues?.[0]?.text ?? '');
    const hookText = clean(state.draft.product.painPoint) || clean(state.draft.product.benefit) ? makeHook() : '';
    const overlayText = cueText || hookText;
    overlay.dataset.style = state.draft.style.captionStyle || 'basic';
    overlay.dataset.position = state.draft.style.captionPosition || 'bottom';
    overlay.hidden = !overlayText;
    byId('previewCaptionOverlayText').textContent = overlayText;
  }

  const previewMedia = document.getElementById('previewMedia');
  const previewImage = document.getElementById('previewImage');
  const showImage = isImageFile(activeClip?.file);
  if (previewImage) {
    const source = showImage ? mediaPreviewUrl(activeClip) : '';
    if (source && previewImage.getAttribute('src') !== source) previewImage.setAttribute('src', source);
    previewImage.hidden = !source;
  }
  if (previewMedia) {
    previewMedia.controls = false;
    const source = showImage ? '' : mediaPreviewUrl(activeClip);
    if (source && previewMedia.getAttribute('src') !== source) {
      previewMedia.setAttribute('src', source);
      if (Number.isFinite(activeSegment?.sourceStartSec)) previewMedia.currentTime = activeSegment.sourceStartSec;
    }
    previewMedia.playbackRate = activeSegment?.speed ?? 1;
    previewMedia.muted = !(state.previewPlayer.playing && !activeClip?.mute);
    previewMedia.hidden = !source;
  }
}

function renderActionPanel() {
  const { errors, warnings } = validateDraft();
  const risk = state.risk?.summary ?? { safe: 0, caution: 0, risk: 0 };
  const statusClass = errors.length > 0 ? 'danger' : warnings.length > 0 ? 'warn' : 'good';
  const panel = byId('actionPanelContent');
  panel.innerHTML = `
    <div class="section-stack">
      <section class="data-section">
        <div class="section-head">
          <h3>작업 상태</h3>
          <span class="soft-badge ${statusClass}">${errors.length > 0 ? '수정 필요' : warnings.length > 0 ? '확인 필요' : '준비됨'}</span>
        </div>
        <div class="metric-list">
          <div class="metric-row"><span>프로젝트</span><strong id="sideProject"></strong></div>
          <div class="metric-row"><span>상품</span><strong id="sideProduct"></strong></div>
          <div class="metric-row"><span>영상안</span><strong id="sideVariants"></strong></div>
          <div class="metric-row"><span>플랫폼</span><strong id="sidePlatforms"></strong></div>
          <div class="metric-row"><span>저작권</span><strong id="sideRisk"></strong></div>
        </div>
      </section>

      <section class="data-section">
        <div class="section-head">
          <h3>검증 메모</h3>
          <span class="soft-badge">${errors.length + warnings.length}</span>
        </div>
        <ul id="sideValidation" class="validation-list"></ul>
      </section>

      <section class="data-section">
        <details class="log-details">
          <summary>실행 로그 자세히 보기</summary>
          <textarea id="sideCommandOutput" class="command-output" readonly></textarea>
        </details>
      </section>
    </div>
  `;

  byId('sideProject').textContent = state.draft.projectName || '-';
  byId('sideProduct').textContent = state.draft.product.name || '-';
  byId('sideVariants').textContent = `${variantFiles().length}개`;
  byId('sidePlatforms').textContent = state.draft.publish.platforms.map((platform) => platformLabels[platform]).join(', ') || '-';
  byId('sideRisk').textContent = `안전 ${risk.safe}, 확인 ${risk.caution}, 위험 ${risk.risk}`;
  byId('sideCommandOutput').value = state.commandOutput || state.status;

  const rows = [];
  if (errors.length === 0 && warnings.length === 0) rows.push(['ready', '통과', '바로 저장/검증할 수 있습니다.']);
  errors.forEach((message) => rows.push(['error', '오류', message]));
  warnings.forEach((message) => rows.push(['warning', '확인', message]));
  byId('sideValidation').replaceChildren(
    ...rows.slice(0, 5).map(([level, label, message]) => {
      const item = document.createElement('li');
      item.className = level;
      item.innerHTML = '<strong></strong><span></span>';
      item.querySelector('strong').textContent = label;
      item.querySelector('span').textContent = message;
      return item;
    }),
  );
}

function setTabHead() {
  const tab = tabs.find((item) => item.id === state.selectedTab) ?? tabs[0];
  byId('tabEyebrow').textContent = tab.eyebrow;
  byId('tabTitle').textContent = tab.title;
  byId('tabStatus').textContent = state.status;
  byId('workbenchToggleBtn').textContent = state.workbenchCollapsed ? '패널 펼치기' : '패널 접기';
}

/** 옛 탭 id로 이동하는 기존 흐름을 수동편집 서브탭으로 흡수한다. */
function normalizeSelectedTab() {
  if (manualSubIds.includes(state.selectedTab)) {
    state.manualSub = state.selectedTab;
    state.selectedTab = 'manual';
  }
  if (!tabs.some((tab) => tab.id === state.selectedTab)) state.selectedTab = 'wizard';
}

function renderManualSub(content) {
  if (state.manualSub === 'guide') renderGuideTab(content);
  if (state.manualSub === 'plan') renderPlanTab(content);
  if (state.manualSub === 'edit') renderEditTab(content);
  if (state.manualSub === 'story') renderStoryTab(content);
  if (state.manualSub === 'ai') renderAiTab(content);
  if (state.manualSub === 'longform') renderLongformTab(content);
  if (state.manualSub === 'platform') renderPlatformTab(content);
  if (state.manualSub === 'sources') renderSourcesTab(content);
  if (state.manualSub === 'performance') renderPerformanceTab(content);
  if (state.manualSub === 'output') renderOutputTab(content);
}

function renderSubnav(content, subs, activeId, onPick) {
  const nav = document.createElement('nav');
  nav.className = 'subtab-row';
  for (const sub of subs) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `subtab-button${sub.id === activeId ? ' active' : ''}`;
    button.textContent = sub.label;
    button.addEventListener('click', () => onPick(sub.id));
    nav.appendChild(button);
  }
  content.appendChild(nav);
}

function manualNavActiveId() {
  return state.manualSub === 'edit' ? `edit:${state.edit.subtab}` : state.manualSub;
}

function pickManualNav(id) {
  if (id.startsWith('edit:')) {
    state.manualSub = 'edit';
    state.edit.subtab = normalizeEditSubtab(id.slice('edit:'.length));
  } else {
    state.manualSub = id;
  }
  renderAll();
}

function renderManualTab(content) {
  content.innerHTML = '';

  // 자주 쓰는 도구만 기본 노출. 나머지는 접힌 "고급 도구" 안에 둔다.
  const advanced = document.createElement('details');
  advanced.className = 'manual-advanced';
  if (state.advancedOpen) advanced.open = true;
  const summary = document.createElement('summary');
  summary.textContent = '고급 도구 (기획·플랫폼·AI·출력 등)';
  advanced.appendChild(summary);
  advanced.addEventListener('toggle', () => {
    state.advancedOpen = advanced.open;
  });

  const nav = document.createElement('nav');
  nav.className = 'manual-nav';
  const activeId = manualNavActiveId();
  for (const group of manualNavGroups) {
    const section = document.createElement('div');
    section.className = 'manual-nav-group';
    const label = document.createElement('span');
    label.className = 'manual-nav-label';
    label.textContent = group.label;
    section.appendChild(label);
    const row = document.createElement('div');
    row.className = 'subtab-row';
    for (const item of group.items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `subtab-button${item.id === activeId ? ' active' : ''}`;
      button.textContent = item.label;
      button.addEventListener('click', () => {
        state.advancedOpen = true;
        pickManualNav(item.id);
      });
      row.appendChild(button);
    }
    section.appendChild(row);
    nav.appendChild(section);
  }
  advanced.appendChild(nav);
  content.appendChild(advanced);

  const body = document.createElement('div');
  body.className = 'subtab-body';
  content.appendChild(body);
  renderManualSub(body);
}

const wizardSubs = [
  { id: 'ai', label: 'AI 숏폼 만들기' },
  { id: 'product', label: '쇼핑쇼츠 만들기' },
  { id: 'library', label: '대본 보관함' },
  { id: 'studio', label: '낭독 스튜디오' },
  { id: 'gallery', label: '이미지/영상 보관함' },
];

function renderWizardHub(content) {
  content.innerHTML = '';
  renderSubnav(content, wizardSubs, state.wizardSub, (id) => {
    state.wizardSub = id;
    renderAll();
  });
  const body = document.createElement('div');
  body.className = 'subtab-body';
  content.appendChild(body);
  if (state.wizardSub === 'product') renderProductWizardTab(body);
  else if (state.wizardSub === 'studio') renderNarrationStudioTab(body);
  else if (state.wizardSub === 'gallery') renderImageGalleryTab(body);
  else if (state.wizardSub === 'library')
    renderScriptLibraryTab(body, () => {
      state.wizardSub = 'ai';
      renderAll();
    });
  else renderStoryWizardTab(body);
}

function renderTabContent() {
  normalizeSelectedTab();
  setTabHead();
  const content = byId('tabContent');
  if (state.selectedTab === 'wizard') renderWizardHub(content);
  if (state.selectedTab === 'manual') renderManualTab(content);
  if (state.selectedTab === 'settings') renderSettingsTab(content);
}

function renderGuideTab(content) {
  const isDesktop = window.shortsFactoryDesktop?.runtime === 'electron';
  content.innerHTML = `
    <div class="section-stack">
      <section class="tool-section">
        <div class="section-head">
          <h3>오늘 테스트할 순서</h3>
          <span class="soft-badge ${isDesktop ? 'good' : 'warn'}">${isDesktop ? 'Electron 실행 중' : '브라우저 실행 중'}</span>
        </div>
        <div class="compact-list">
          <article class="compact-card note"><strong>1. 기획</strong><br />상품명, 제휴 링크, 불편 포인트, 장점을 채웁니다.</article>
          <article class="compact-card note"><strong>2. AI엔진</strong><br />테스트 생성, GPT 이미지, Gemini 이미지, 리더스 나노바나나프로 중 하나를 고릅니다.</article>
          <article class="compact-card note"><strong>3. AI 스토리</strong><br />대본을 장면으로 나누고, 선택한 AI 엔진으로 이미지를 생성합니다.</article>
          <article class="compact-card note"><strong>4. 영상편집</strong><br />영상 선택을 눌러 클립을 넣고, 위/아래 버튼으로 장면 순서를 맞춥니다.</article>
          <article class="compact-card note"><strong>5. 이미지 영상화</strong><br />생성된 이미지 순서를 확인하고 영상 클립 만들기를 눌러 썰채널용 클립을 만듭니다.</article>
          <article class="compact-card note"><strong>6. 플랫폼/저작권</strong><br />업로드 문구와 소스 권리 상태를 확인합니다.</article>
          <article class="compact-card note"><strong>7. 출력</strong><br />로컬 저장 → 검증 실행 → 렌더 실행 → 패키지 실행 순서로 눌러봅니다.</article>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-head"><h3>Electron 테스트 메모</h3></div>
        <p class="note">데스크톱 앱에서는 파일 선택 창으로 고른 영상과 이미지를 프로젝트 폴더에 자동 복사합니다. 브라우저 화면에서는 업로드 방식으로 같은 흐름을 테스트합니다.</p>
        <p class="note">렌더 실행은 실제 클립 파일과 FFmpeg가 준비되어야 성공합니다. 먼저 영상 선택, 로컬 저장, 검증 실행부터 확인하세요.</p>
      </section>
    </div>
  `;
}

function currentAiModel() {
  return state.ai.models[state.ai.provider] ?? '';
}

function renderAiTab(content) {
  content.innerHTML = `
    <div class="section-stack">
      <section class="tool-section">
        <div class="section-head">
          <h3>이미지 생성 엔진</h3>
          <span class="soft-badge">${aiProviderLabels[state.ai.provider]}</span>
        </div>
        <div id="aiProviderPicker" class="provider-grid"></div>
      </section>

      <section class="tool-section">
        <div class="section-head"><h3>연결 설정</h3></div>
        <div class="field-grid">
          <label>모델명<input id="aiModelField" type="text" autocomplete="off" /></label>
          <label>API 키<input id="aiApiKeyField" type="password" autocomplete="off" placeholder="환경변수를 쓰면 비워둬도 됩니다" /></label>
          <label class="field-wide">리더스 엔드포인트<input id="aiEndpointField" type="url" autocomplete="off" placeholder="리더스 나노바나나프로 전용 연결 주소" /></label>
        </div>
        <p class="note">키는 실행 순간에만 서버로 전달되고 프로젝트 파일에는 저장하지 않습니다. 테스트 생성은 키 없이 전체 흐름을 점검하는 용도입니다.</p>
      </section>

      <section class="tool-section">
        <div class="section-head"><h3>현재 엔진 상태</h3></div>
        <div class="metric-list">
          <div class="metric-row"><span>선택</span><strong>${aiProviderLabels[state.ai.provider]}</strong></div>
          <div class="metric-row"><span>모델</span><strong>${currentAiModel() || '-'}</strong></div>
          <div class="metric-row"><span>키 입력</span><strong>${state.ai.apiKey ? '앱에서 입력됨' : '환경변수 또는 미설정'}</strong></div>
          <div class="metric-row"><span>전용 주소</span><strong>${state.ai.endpoint ? '입력됨' : '필요 시 입력'}</strong></div>
        </div>
      </section>
    </div>
  `;
  renderAiProviderPicker();
  bindField('aiModelField', currentAiModel(), (value) => {
    state.ai.models[state.ai.provider] = value;
    refreshChrome();
  });
  bindField('aiApiKeyField', state.ai.apiKey, (value) => {
    state.ai.apiKey = value;
  });
  bindField('aiEndpointField', state.ai.endpoint, (value) => {
    state.ai.endpoint = value;
  });
}

function renderAiProviderPicker() {
  const container = document.getElementById('aiProviderPicker');
  if (!container) return;
  container.replaceChildren(
    ...aiProviderIds.map((provider) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `provider-card${provider === state.ai.provider ? ' active' : ''}`;
      button.innerHTML = '<strong></strong><span></span>';
      button.querySelector('strong').textContent = aiProviderLabels[provider];
      button.querySelector('span').textContent =
        provider === 'mock'
          ? '키 없이 이미지 생성 흐름 테스트'
          : provider === 'gpt'
            ? 'GPT 이미지 생성/편집 계열'
            : provider === 'gemini'
              ? 'Gemini 이미지 생성 계열'
              : '앱에는 표시명만 노출되는 전용 연결';
      button.addEventListener('click', () => {
        state.ai.provider = provider;
        renderAll();
      });
      return button;
    }),
  );
}

function bindField(id, value, onValue, eventName) {
  const node = byId(id);
  node.value = value ?? '';
  node.addEventListener(eventName ?? (node.tagName === 'SELECT' ? 'change' : 'input'), () => onValue(node.value));
}

function renderPlanTab(content) {
  content.innerHTML = `
    <div class="section-stack">
      <section class="tool-section">
        <div class="section-head"><h3>상품 정보</h3></div>
        <div class="field-grid">
          <label>프로젝트명<input id="projectNameField" type="text" autocomplete="off" /></label>
          <label>상품명<input id="productNameField" type="text" autocomplete="off" /></label>
          <label class="field-wide">제휴 링크<input id="affiliateUrlField" type="url" autocomplete="off" /></label>
          <label>카테고리<input id="categoryField" type="text" autocomplete="off" /></label>
          <label>캠페인명<input id="campaignField" type="text" autocomplete="off" /></label>
          <label>가격 하한<input id="priceMinField" type="number" min="0" step="100" /></label>
          <label>가격 상한<input id="priceMaxField" type="number" min="0" step="100" /></label>
          <label>링크 유도 위치<select id="linkPlacementField">${optionList(linkPlacementIds, linkPlacementLabels, state.draft.publish.linkPlacement)}</select></label>
          <label class="field-wide">불편 포인트<textarea id="painPointField" rows="3" placeholder="예: 싱크대가 좁아서 컵과 접시 둘 곳이 부족함"></textarea></label>
          <label class="field-wide">핵심 장점<textarea id="benefitField" rows="3" placeholder="예: 접으면 작고 펼치면 설거지 후 물 빠짐 공간이 생김"></textarea></label>
          <label class="field-wide">제휴 고지<textarea id="disclosureField" rows="3"></textarea></label>
        </div>
      </section>

      <section class="tool-section">
        <div class="section-head"><h3>업로드 플랫폼</h3></div>
        <div id="platformToggleRow" class="platform-pills"></div>
        <div class="field-grid">
          <label class="field-wide">해시태그<input id="hashtagsField" type="text" autocomplete="off" /></label>
          <label class="field-wide">행동 유도 문구<textarea id="ctaField" rows="3"></textarea></label>
          <label class="field-wide">고정 댓글<textarea id="fixedCommentPlanField" rows="3"></textarea></label>
        </div>
      </section>
    </div>
  `;
  bindField('projectNameField', state.draft.projectName, (value) =>
    changeDraft((draft) => {
      draft.projectName = value;
    }),
  );
  bindField('productNameField', state.draft.product.name, (value) =>
    changeDraft((draft) => {
      draft.product.name = value;
      draft.longform.productName = value;
    }),
  );
  bindField('affiliateUrlField', state.draft.product.affiliateUrl, (value) =>
    changeDraft((draft) => {
      draft.product.affiliateUrl = value;
      draft.longform.affiliateUrl = value;
    }),
  );
  bindField('categoryField', state.draft.product.category, (value) =>
    changeDraft((draft) => {
      draft.product.category = value;
    }),
  );
  bindField('campaignField', state.draft.publish.campaignName, (value) =>
    changeDraft((draft) => {
      draft.publish.campaignName = value;
    }),
  );
  bindField('priceMinField', state.draft.product.priceMin, (value) =>
    changeDraft((draft) => {
      draft.product.priceMin = value;
    }),
  );
  bindField('priceMaxField', state.draft.product.priceMax, (value) =>
    changeDraft((draft) => {
      draft.product.priceMax = value;
    }),
  );
  bindField('linkPlacementField', state.draft.publish.linkPlacement, (value) =>
    changeDraft((draft) => {
      draft.publish.linkPlacement = value;
    }),
  );
  bindField('painPointField', state.draft.product.painPoint, (value) =>
    changeDraft((draft) => {
      draft.product.painPoint = value;
    }),
  );
  bindField('benefitField', state.draft.product.benefit, (value) =>
    changeDraft((draft) => {
      draft.product.benefit = value;
    }),
  );
  bindField('disclosureField', state.draft.disclosure.text, (value) =>
    changeDraft((draft) => {
      draft.disclosure.text = value;
    }),
  );
  bindField('hashtagsField', formatTags(state.draft.publish.hashtags), (value) =>
    changeDraft((draft) => {
      draft.publish.hashtags = parseTags(value);
    }),
  );
  bindField('ctaField', state.draft.publish.cta, (value) =>
    changeDraft((draft) => {
      draft.publish.cta = value;
    }),
  );
  bindField('fixedCommentPlanField', state.draft.publish.fixedComment, (value) =>
    changeDraft((draft) => {
      draft.publish.fixedComment = value;
    }),
  );
  renderPlatformToggles();
}

function renderPlatformToggles() {
  const container = document.getElementById('platformToggleRow');
  if (!container) return;
  container.replaceChildren(
    ...platformIds.map((platform) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `platform-chip${state.draft.publish.platforms.includes(platform) ? ' active' : ''}`;
      button.textContent = platformLabels[platform];
      button.addEventListener('click', () => {
        changeDraft((draft) => {
          if (draft.publish.platforms.includes(platform)) {
            draft.publish.platforms = draft.publish.platforms.filter((item) => item !== platform);
          } else {
            draft.publish.platforms = [...draft.publish.platforms, platform];
          }
        });
        renderPlatformToggles();
      });
      return button;
    }),
  );
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function editPanelClass(id) {
  return `tool-section edit-subtab-panel${state.edit.subtab === id ? '' : ' hidden'}`;
}

function clipFileOptionList(selected) {
  const files = unique([...state.draft.clips.map((clip) => clip.file), selected].filter(Boolean));
  return files
    .map((file) => `<option value="${escapeHtml(file)}"${file === selected ? ' selected' : ''}>${escapeHtml(file)}</option>`)
    .join('');
}

function bgmFileOptionList() {
  const current = clean(state.draft.bgm.file);
  const files = current ? ['', current] : [''];
  return files
    .map((file) => {
      const label = file || 'BGM 없음';
      return `<option value="${escapeHtml(file)}"${file === current ? ' selected' : ''}>${escapeHtml(label)}</option>`;
    })
    .join('');
}

function ttsScriptPreview() {
  if (state.tts.scriptSource === 'captions') {
    const text = currentCaptionCues()
      .slice(0, 5)
      .map((cue) => clean(cue.text))
      .filter(Boolean)
      .join(' ');
    return text || '자동자막 생성 후 자막 문장을 음성 대본으로 사용할 수 있습니다.';
  }
  if (state.tts.scriptSource === 'hook') return makeHook();
  return clean(state.draft.story.script) || `${state.draft.product.name} 소개 내레이션`;
}

function renderEditTab(content) {
  const isDesktop = window.shortsFactoryDesktop?.runtime === 'electron';
  content.innerHTML = `
    <div class="section-stack">
      <section class="${editPanelClass('media')} media-ingest-section">
        <div class="section-head">
          <h3>파일 선택</h3>
          <span class="soft-badge ${isDesktop ? 'good' : 'warn'}">${isDesktop ? '데스크톱 파일 복사' : '브라우저 업로드'}</span>
        </div>
        <div class="media-import-grid">
          <button id="pickVideoBtn" class="primary-button media-import-button" type="button">
            <strong>쇼핑 영상 여러 개 선택</strong>
            <span>다운받은 상품 영상을 한 번에 넣고 짜깁기 타임라인에 추가</span>
          </button>
          <button id="pickImageBtn" class="ghost-button media-import-button" type="button">
            <strong>이미지 선택</strong>
            <span>PNG/JPG/WebP를 아래 순서표에 추가</span>
          </button>
          <button id="pickBgmBtn" class="ghost-button media-import-button" type="button">
            <strong>BGM 선택</strong>
            <span>MP3/WAV/M4A를 배경음으로 연결</span>
          </button>
        </div>
        <input id="videoFileInput" type="file" accept="video/*" multiple hidden />
        <input id="imageFileInput" type="file" accept="image/*" multiple hidden />
        <input id="audioFileInput" type="file" accept="audio/*" hidden />
        <p class="note">선택한 파일은 현재 프로젝트 폴더로 들어갑니다. 영상은 바로 편집 순서에 추가되고, 이미지는 이미지 영상화 대기열에 쌓입니다.</p>
        <div class="section-head">
          <h3>가져온 파일</h3>
          <span id="mediaLibraryCount" class="soft-badge">0개</span>
        </div>
        <div id="mediaLibraryGrid" class="media-grid"></div>
      </section>

      <section class="${editPanelClass('frame')} edit-frame-section">
        <div class="section-head">
          <h3>편집틀</h3>
          <span class="soft-badge">${state.draft.style.ratio}</span>
        </div>
        <div class="field-grid three">
          <label>길이<select id="durationField">${optionList(durationPresetIds, durationPresetLabels, state.draft.style.duration)}</select></label>
          <label>비율<select id="ratioField"><option value="9:16">9:16</option><option value="1:1">1:1</option><option value="16:9">16:9</option></select></label>
          <label>해상도<select id="resolutionField"><option value="1080x1920">1080x1920</option><option value="720x1280">720x1280</option><option value="1080x1080">1080x1080</option><option value="1920x1080">1920x1080</option></select></label>
          <label>톤<select id="toneField">${optionList(toneIds, toneLabels, state.draft.style.tone)}</select></label>
          <label>자막 위치<select id="captionPositionField"><option value="bottom">하단</option><option value="center">중앙</option><option value="top">상단</option></select></label>
          <label>자막 스타일<select id="captionStyleField">${optionList(captionStyleIds, captionStyleLabels, state.draft.style.captionStyle)}</select></label>
          <label>장면 전환<select id="transitionField">${optionList(transitionIds, transitionLabels, state.draft.style.transition)}</select></label>
          <label>영상안 개수<select id="variantCountField">${optionList(variantCountIds, variantCountLabels, state.draft.variants.count)}</select></label>
        </div>
      </section>

      <section class="${editPanelClass('timeline')}">
        <div class="section-head">
          <h3>영상 장면 순서</h3>
          <span class="soft-badge">${state.draft.clips.length}개</span>
        </div>
        <div class="button-row">
          <button id="addClipBtn" class="ghost-button" type="button">빈 장면 추가</button>
          <button id="rebuildTimingBtn" class="ghost-button" type="button">시간 자동 정리</button>
          <button id="shoppingSequenceBtn" class="primary-button" type="button">쇼핑 짜깁기 자동배치</button>
        </div>
        <p class="note">다운받은 상품 영상 여러 개를 넣으면 이 목록에서 순서, 역할, 시작/종료, 속도를 조절해 쇼핑 쇼츠로 짜깁기할 수 있습니다.</p>
        <div class="role-palette" id="rolePalette"></div>
        <div id="clipRows" class="clip-list"></div>
      </section>

      <section class="${editPanelClass('timeline')} timeline-workbench-section">
        <div class="section-head">
          <h3>타임라인 V1</h3>
          <span id="timelineSummaryBadge" class="soft-badge">대기</span>
        </div>
        <div id="timelineWorkbench" class="timeline-workbench"></div>
      </section>

      <section class="${editPanelClass('audio')}">
        <div class="section-head">
          <h3>오디오·TTS</h3>
          <span class="soft-badge">${ttsProviderLabels[state.tts.provider]}</span>
        </div>
        <div class="field-grid three">
          <label class="field-wide">BGM 파일<select id="bgmFileField">${bgmFileOptionList()}</select></label>
          <label>BGM 볼륨<select id="bgmVolumeField">${optionList(bgmVolumeIds, bgmVolumeLabels, state.draft.style.bgmVolume)}</select></label>
          <label>TTS 엔진<select id="ttsProviderField">${optionList(ttsProviderIds, ttsProviderLabels, state.tts.provider)}</select></label>
          <label>목소리<select id="ttsVoiceField">${optionList(ttsVoiceIds, ttsVoiceLabels, state.tts.voice)}</select></label>
          <label>말 속도<select id="ttsSpeedField">${optionList(ttsSpeedIds, ttsSpeedLabels, state.tts.speed)}</select></label>
          <label>대본 출처<select id="ttsScriptSourceField">${optionList(ttsScriptSourceIds, ttsScriptSourceLabels, state.tts.scriptSource)}</select></label>
          <label>음성 볼륨<select id="ttsVolumeField">${optionList(ttsVolumeIds, ttsVolumeLabels, state.tts.volume)}</select></label>
        </div>
        <div class="tts-preview">
          <strong>읽을 대본 미리보기</strong>
          <p>${escapeHtml(trimLine(ttsScriptPreview(), 220))}</p>
        </div>
        <div class="subsection-head">
          <h3>무음구간 편집</h3>
          <span id="silenceSummaryBadge" class="soft-badge">대기</span>
        </div>
        <div class="field-grid three">
          <label class="field-wide">분석할 클립<select id="silenceClipField"></select></label>
          <label>무음 기준<select id="silenceNoiseField">${optionList(silenceNoiseIds, silenceNoiseLabels, state.silence.noiseDb)}</select></label>
          <label>최소 무음<select id="silenceMinField">${optionList(silenceMinIds, silenceMinLabels, state.silence.minDurationSec)}</select></label>
          <label>말 앞뒤 여백<select id="silencePaddingField">${optionList(silencePaddingIds, silencePaddingLabels, state.silence.paddingSec)}</select></label>
        </div>
        <div class="button-row">
          <button id="analyzeSilenceBtn" class="primary-button" type="button">무음구간 분석</button>
          <button id="applySilenceBtn" class="ghost-button" type="button">말 있는 구간만 타임라인에 적용</button>
        </div>
        <div id="silenceWorkbench" class="silence-workbench"></div>
      </section>

      <section class="${editPanelClass('captions')}">
        <div class="section-head">
          <h3>자동자막</h3>
          <span id="captionSummaryBadge" class="soft-badge">대기</span>
        </div>
        <div class="field-grid three">
          <label class="field-wide">자막을 만들 클립<select id="captionClipField"></select></label>
          <label>엔진<select id="captionProviderField">${optionList(captionProviderIds, captionProviderLabels, state.captions.provider)}</select></label>
          <label>언어<select id="captionLanguageField">${optionList(captionLanguageIds, captionLanguageLabels, state.captions.language)}</select></label>
          <label>Whisper 모델<select id="captionModelField">${optionList(captionModelIds, captionModelLabels, state.captions.model)}</select></label>
          <label>최소 글자<select id="captionMinCharsField">${optionList(captionMinCharIds, captionMinCharLabels, state.captions.minChars)}</select></label>
          <label>최대 글자<select id="captionMaxCharsField">${optionList(captionMaxCharIds, captionMaxCharLabels, state.captions.maxChars)}</select></label>
        </div>
        <div class="button-row">
          <button id="checkCaptionToolsBtn" class="ghost-button" type="button">자동자막 환경 확인</button>
          <button id="generateScriptCaptionBtn" class="primary-button" type="button">대본으로 자동자막</button>
          <button id="generateCaptionBtn" class="primary-button" type="button">자동자막 생성</button>
          <button id="applyCaptionBtn" class="ghost-button" type="button">대표 문구를 자막/CTA에 반영</button>
        </div>
        <div id="captionWorkbench" class="caption-workbench"></div>
      </section>

      <section class="${editPanelClass('captions')}">
        <div class="section-head">
          <h3>텍스트 스티커</h3>
          <button id="addStickerBtn" class="primary-button" type="button">스티커 추가</button>
        </div>
        <p class="note">원하는 시간에 노란 강조 문구를 화면에 얹습니다. 렌더 실행 때 영상에 함께 구워집니다.</p>
        <div id="stickerRows" class="sticker-list"></div>
      </section>

      <section class="${editPanelClass('storyboard')}">
        <div class="section-head">
          <h3>이미지 순서 배치</h3>
          <span class="soft-badge">${state.imageScenes.length}장</span>
        </div>
        <div id="imageSceneRows" class="image-scene-list"></div>
      </section>

      <section class="${editPanelClass('storyboard')}">
        <div class="section-head">
          <h3>이미지 영상화</h3>
          <span class="soft-badge">${state.imageScenes.length > 0 ? '실행 가능' : '이미지 필요'}</span>
        </div>
        <div class="field-grid">
          <label>영상 제목<input id="storyVideoTitleField" type="text" /></label>
          <label>이미지 권리<select id="imageRightsField">${optionList(imageRightsIds, imageRightsLabels, state.imageRights)}</select></label>
        </div>
        <div class="button-row">
          <button id="renderStoryboardBtn" class="primary-button" type="button">이미지 순서로 영상 클립 만들기</button>
          <button id="applyStoryboardBtn" class="ghost-button" type="button">영상화 후 클립 순서 적용</button>
        </div>
        <textarea id="storyboardOutputField" class="yaml-field" readonly></textarea>
      </section>
    </div>
  `;
  byId('pickVideoBtn').addEventListener('click', () => importMedia('video').catch(reportApiError));
  byId('addStickerBtn').addEventListener('click', () => {
    pushHistory('stickers');
    state.draft.stickers.push({ text: '강조 문구', start: '0', end: '2', position: 'center' });
    renderAll();
  });
  renderStickerRows();
  renderMediaLibrary();
  byId('pickImageBtn').addEventListener('click', () => importMedia('image').catch(reportApiError));
  byId('pickBgmBtn').addEventListener('click', () => importMedia('audio').catch(reportApiError));
  byId('videoFileInput').addEventListener('change', (event) => uploadBrowserFiles('video', event.target.files).catch(reportApiError));
  byId('imageFileInput').addEventListener('change', (event) => uploadBrowserFiles('image', event.target.files).catch(reportApiError));
  byId('audioFileInput').addEventListener('change', (event) => uploadBrowserFiles('audio', event.target.files).catch(reportApiError));
  bindField('durationField', state.draft.style.duration, (value) =>
    changeDraft((draft) => {
      draft.style.duration = value;
    }),
  );
  bindField('ratioField', state.draft.style.ratio, (value) =>
    changeDraft((draft) => {
      draft.style.ratio = value;
    }),
  );
  bindField('resolutionField', state.draft.style.resolution, (value) =>
    changeDraft((draft) => {
      draft.style.resolution = value;
    }),
  );
  bindField('toneField', state.draft.style.tone, (value) =>
    changeDraft((draft) => {
      draft.style.tone = value;
    }),
  );
  bindField('captionStyleField', state.draft.style.captionStyle, (value) =>
    changeDraft((draft) => {
      draft.style.captionStyle = value;
    }),
  );
  bindField('transitionField', state.draft.style.transition, (value) =>
    changeDraft((draft) => {
      draft.style.transition = value;
    }),
  );
  bindField('captionPositionField', state.draft.style.captionPosition, (value) =>
    changeDraft((draft) => {
      draft.style.captionPosition = value;
    }),
  );
  bindField('bgmVolumeField', state.draft.style.bgmVolume, (value) =>
    changeDraft((draft) => {
      draft.style.bgmVolume = value;
    }),
  );
  bindField('bgmFileField', state.draft.bgm.file, (value) =>
    changeDraft((draft) => {
      draft.bgm.file = value;
    }),
  );
  bindField('variantCountField', state.draft.variants.count, (value) =>
    changeDraft((draft) => {
      draft.variants.count = value;
    }),
  );
  bindField('ttsProviderField', state.tts.provider, (value) => {
    state.tts.provider = value;
    renderAll();
  });
  bindField('ttsVoiceField', state.tts.voice, (value) => {
    state.tts.voice = value;
  });
  bindField('ttsSpeedField', state.tts.speed, (value) => {
    state.tts.speed = value;
  });
  bindField('ttsScriptSourceField', state.tts.scriptSource, (value) => {
    state.tts.scriptSource = value;
    renderAll();
  });
  bindField('ttsVolumeField', state.tts.volume, (value) => {
    state.tts.volume = value;
  });
  byId('addClipBtn').addEventListener('click', () => {
    pushHistory('clips');
    state.draft.clips.push({ file: `clips/scene-${state.draft.clips.length + 1}.mp4`, role: 'product', start: '0', end: '3' });
    state.useLoadedManifest = false;
    state.useLoadedRisk = false;
    renderAll();
  });
  byId('rebuildTimingBtn').addEventListener('click', () => {
    rebuildClipTiming();
    renderAll();
  });
  byId('shoppingSequenceBtn').addEventListener('click', () => {
    applyShoppingSequence();
    renderAll();
  });
  renderSilenceControls();
  byId('analyzeSilenceBtn').addEventListener('click', () => analyzeSilenceLocal().catch(reportApiError));
  byId('applySilenceBtn').addEventListener('click', () => {
    applySilencePlanToTimeline();
    renderAll();
  });
  renderCaptionControls();
  byId('checkCaptionToolsBtn').addEventListener('click', () => checkCaptionToolsLocal().catch(reportApiError));
  byId('generateScriptCaptionBtn').addEventListener('click', () => {
    try {
      generateScriptCaptionsLocal();
    } catch (error) {
      reportApiError(error);
    }
  });
  byId('generateCaptionBtn').addEventListener('click', () => generateCaptionsLocal().catch(reportApiError));
  byId('applyCaptionBtn').addEventListener('click', () => {
    applyCaptionReportToDraft();
    renderAll();
  });
  bindField('storyVideoTitleField', state.draft.story.title, (value) =>
    changeDraft((draft) => {
      draft.story.title = value;
      renderStoryboardOutput();
    }),
  );
  byId('imageRightsField').addEventListener('change', (event) => {
    state.imageRights = event.target.value;
    renderStoryboardOutput();
  });
  byId('renderStoryboardBtn').addEventListener('click', () => runStoryboardLocal().catch(reportApiError));
  byId('applyStoryboardBtn').addEventListener('click', () => {
    applyImageScenesToClips();
    renderAll();
  });
  renderRolePalette();
  renderClipRows();
  renderTimelineWorkbench();
  renderImageSceneRows();
  renderStoryboardOutput();
}

function mediaInputId(kind) {
  if (kind === 'image') return 'imageFileInput';
  if (kind === 'audio') return 'audioFileInput';
  return 'videoFileInput';
}

async function importMedia(kind) {
  if (window.shortsFactoryDesktop?.selectAndImportMedia) {
    state.status = kind === 'image' ? '이미지 선택 중' : kind === 'audio' ? 'BGM 선택 중' : '영상 선택 중';
    refreshChrome();
    const data = await window.shortsFactoryDesktop.selectAndImportMedia({
      kind,
      projectName: state.draft.projectName,
    });
    addImportedMedia(kind, data.imported ?? [], data.projectDir);
    renderAll();
    return;
  }
  byId(mediaInputId(kind)).click();
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(new Error(`${file.name} 파일을 읽을 수 없습니다.`)));
    reader.readAsDataURL(file);
  });
}

async function uploadBrowserFiles(kind, fileList) {
  const files = Array.from(fileList ?? []);
  if (files.length === 0) return;
  state.status = `${files.length}개 파일 가져오는 중`;
  refreshChrome();
  const payloadFiles = await Promise.all(
    files.map(async (file) => ({
      name: safeFileName(file.name),
      type: file.type,
      size: file.size,
      data: await readFileAsDataUrl(file),
    })),
  );
  const data = await apiPost('/api/media/upload', {
    projectName: state.draft.projectName,
    kind,
    files: payloadFiles,
  });
  addImportedMedia(kind, data.imported ?? [], data.projectDir);
  byId(mediaInputId(kind)).value = '';
  renderAll();
}

function addImportedMedia(kind, imported, projectDir) {
  if (projectDir) state.localProjectPath = projectDir;
  if (imported.length === 0) {
    state.status = '선택한 파일 없음';
    return;
  }
  pushHistory('import');
  if (kind === 'audio') {
    const first = imported[0];
    state.draft.bgm.file = first?.relativePath ?? '';
    state.useLoadedManifest = false;
    state.useLoadedRisk = false;
    state.status = 'BGM 연결 완료';
    return;
  }

  if (kind === 'image') {
    imported.forEach((item) => {
      const sceneLabel = `${state.draft.story.title || '장면'} ${state.imageScenes.length + 1}`;
      state.imageScenes.push({
        image: item.relativePath,
        narration: sceneLabel,
        caption: sceneLabel,
        durationSec: '4',
      });
    });
    state.status = `${imported.length}장 이미지 추가`;
    return;
  }

  imported.forEach((item) => {
    state.draft.clips.push({
      file: item.relativePath,
      role: nextRole(state.draft.clips.length),
      start: '0',
      end: '3',
    });
  });
  state.edit.selectedClipIndex = Math.max(0, state.draft.clips.length - imported.length);
  const { segments } = buildTimelineSegments(state.draft.clips);
  state.edit.playheadSec = segments[state.edit.selectedClipIndex]?.timelineStartSec ?? 0;
  state.useLoadedManifest = false;
  state.useLoadedRisk = false;
  state.status = `${imported.length}개 영상 추가`;
}

function rebuildClipTiming() {
  pushHistory('clips');
  state.draft.clips.forEach((clip) => {
    const start = Number.isFinite(numberValue(clip.start)) ? numberValue(clip.start) : 0;
    const end = Number.isFinite(numberValue(clip.end)) && numberValue(clip.end) > start ? numberValue(clip.end) : start + 3;
    clip.start = start.toFixed(1).replace(/\.0$/, '');
    clip.end = end.toFixed(1).replace(/\.0$/, '');
  });
  state.status = '장면 시간 정리 완료';
}

function applyShoppingSequence() {
  pushHistory('clips');
  const sequence = ['hook', 'problem', 'product', 'use', 'result', 'cta'];
  state.draft.clips = state.draft.clips.map((clip, index) => {
    const start = Number.isFinite(numberValue(clip.start)) ? numberValue(clip.start) : 0;
    const fallbackDuration = index === 0 ? 2.2 : index === state.draft.clips.length - 1 ? 3 : 4;
    const end =
      Number.isFinite(numberValue(clip.end)) && numberValue(clip.end) > start
        ? numberValue(clip.end)
        : start + fallbackDuration;
    return {
      ...clip,
      role: sequence[Math.min(index, sequence.length - 1)] ?? 'product',
      start: start.toFixed(1).replace(/\.0$/, ''),
      end: end.toFixed(1).replace(/\.0$/, ''),
      editNote: index === 0 ? '쇼핑 자동배치: 첫 2초 훅' : '쇼핑 자동배치',
    };
  });
  state.edit.selectedClipIndex = 0;
  state.edit.playheadSec = 0;
  state.useLoadedManifest = false;
  state.useLoadedRisk = false;
  state.status = `쇼핑 짜깁기 자동배치 완료: ${state.draft.clips.length}개 클립`;
}

function secLabel(value) {
  return `${Number(value || 0).toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')}s`;
}

function sourceTimeFromPlayhead(segment, playheadSec = state.edit.playheadSec) {
  if (!segment) return 0;
  const offset = Math.min(Math.max(playheadSec - segment.timelineStartSec, 0), segment.durationSec);
  return segment.sourceStartSec + offset * (segment.speed ?? 1);
}

function selectClipForPlayhead(playheadSec, segments) {
  const active =
    segments.find((segment) => playheadSec >= segment.timelineStartSec && playheadSec < segment.timelineEndSec) ??
    segments.at(-1);
  if (active) state.edit.selectedClipIndex = active.index;
}

function autoEditActionLabel(action) {
  if (action.kind === 'trim') return '컷 압축';
  if (action.kind === 'speed') return `${Number(action.speed || 1).toFixed(2).replace(/\.00$/, '')}x 속도`;
  if (action.kind === 'focus') return '강조 표시';
  return '자동 조정';
}

function renderAutoEditPlanSummary() {
  const plan = state.edit.autoPlan;
  if (!plan) return '';
  const actions = (plan.actions ?? [])
    .slice(0, 6)
    .map(
      (action) => `
        <article class="auto-plan-row">
          <strong>${pad2((action.index ?? 0) + 1)} ${autoEditActionLabel(action)}</strong>
          <span>${escapeHtml(action.reason || action.note || '대본 흐름에 맞춰 자동 조정')}</span>
        </article>
      `,
    )
    .join('');
  return `
    <div class="auto-plan-panel">
      <div class="drag-trim-head">
        <strong>대본 분석 자동편집 결과</strong>
        <span>${plan.captionCueCount ?? plan.cues?.length ?? 0}줄 자막 · ${plan.actions?.length ?? 0}개 조정</span>
      </div>
      ${actions || '<p class="note">대본에서 적용할 편집 조정을 찾지 못했습니다. 자막 큐만 생성했습니다.</p>'}
    </div>
  `;
}

function renderTimelineWorkbench() {
  const container = document.getElementById('timelineWorkbench');
  const badge = document.getElementById('timelineSummaryBadge');
  if (!container || !badge) return;

  const { totalDurationSec, segments } = buildTimelineSegments(state.draft.clips);
  if (segments.length === 0) {
    badge.textContent = '대기';
    container.innerHTML = '<p class="note">먼저 영상 파일을 선택하거나 장면을 추가하면 여기서 순서, 분할, 트림을 바로 조정할 수 있습니다.</p>';
    return;
  }

  const segment = selectedTimelineSegment() ?? segments[0];
  const clip = selectedClip() ?? state.draft.clips[0];
  const sourceAtPlayhead = sourceTimeFromPlayhead(segment);
  badge.textContent = `${segments.length}장면 · ${totalDurationSec.toFixed(1)}초`;
  container.innerHTML = `
    <div class="timeline-workbench-top">
      <div>
        <strong id="timelineClipTitle"></strong>
        <span id="timelineClipMeta"></span>
      </div>
      <div class="timeline-time-pair">
        <span id="timelinePlayheadLabel"></span>
        <span id="timelineSourceLabel"></span>
      </div>
    </div>
    <input id="timelinePlayheadField" class="timeline-range" type="range" min="0" max="${Math.max(totalDurationSec, 0.01)}" step="0.01" />
    <div id="timelineTrack" class="timeline-track-row"></div>
    <div class="selected-clip-editor">
      <div class="drag-trim-panel">
        <div class="drag-trim-head">
          <strong>드래그 트림</strong>
          <span id="dragTrimLabel"></span>
        </div>
        <label>시작 핸들<input id="clipStartDragField" class="timeline-range" type="range" min="0" max="${Math.max(segment.sourceEndSec, 0.01)}" step="0.01" /></label>
        <label>끝 핸들<input id="clipEndDragField" class="timeline-range" type="range" min="0" max="${Math.max(segment.sourceEndSec, 0.01)}" step="0.01" /></label>
      </div>
      <div class="speed-panel">
        <div class="drag-trim-head">
          <strong>속도</strong>
          <span id="clipSpeedLabel"></span>
        </div>
        <input id="clipSpeedField" class="timeline-range" type="range" min="0.25" max="4" step="0.05" />
        <div class="speed-presets">
          <button id="speedHalfBtn" class="ghost-button" type="button">0.5x 슬로우</button>
          <button id="speedNormalBtn" class="ghost-button" type="button">1x 원래대로</button>
          <button id="speedFastBtn" class="ghost-button" type="button">1.5x 빨리감기</button>
          <button id="speedDoubleBtn" class="ghost-button" type="button">2x 압축</button>
        </div>
      </div>
      <label>시작<input id="selectedClipStartField" type="number" min="0" step="0.01" /></label>
      <label>종료<input id="selectedClipEndField" type="number" min="0" step="0.01" /></label>
      <div class="button-row compact">
        <button id="applyClipTrimBtn" class="primary-button" type="button">트림 적용</button>
        <button id="splitSelectedClipBtn" class="ghost-button" type="button">현재 위치에서 분할</button>
        <button id="smartTrimBtn" class="ghost-button" type="button">스마트 트림</button>
        <button id="applyScriptAutoEditBtn" class="primary-button" type="button">대본 분석 자동편집</button>
        <button id="trimStartPlusBtn" class="ghost-button" type="button">앞 0.1초 컷</button>
        <button id="trimEndMinusBtn" class="ghost-button" type="button">뒤 0.1초 컷</button>
        <button id="deleteSelectedClipBtn" class="ghost-button danger-button" type="button">선택 장면 삭제</button>
      </div>
      <div class="preset-panel">
        <button id="presetFastHookBtn" class="preset-action" type="button">
          <strong>훅 압축</strong><span>초반 0.2초 제거 + 1.25x</span>
        </button>
        <button id="presetBreathBtn" class="preset-action" type="button">
          <strong>숨 쉴 여백</strong><span>전체 0.9x로 말맛 살리기</span>
        </button>
        <button id="presetDetailFocusBtn" class="preset-action" type="button">
          <strong>디테일 줌 후보</strong><span>상품 디테일 장면 표시</span>
        </button>
      </div>
      ${renderAutoEditPlanSummary()}
    </div>
  `;

  document.getElementById('timelineClipTitle').textContent = clip?.file || '선택된 장면 없음';
  document.getElementById('timelineClipMeta').textContent =
    `${roleLabels[clip?.role] ?? clip?.role ?? '-'} · 원본 ${secLabel(segment.sourceDurationSec)} · 결과 ${secLabel(segment.durationSec)} · ${segment.speed}x`;
  document.getElementById('timelinePlayheadLabel').textContent = `타임라인 ${secLabel(state.edit.playheadSec)}`;
  document.getElementById('timelineSourceLabel').textContent = `원본 ${secLabel(sourceAtPlayhead)}`;

  const playheadField = document.getElementById('timelinePlayheadField');
  playheadField.value = String(state.edit.playheadSec);
  playheadField.addEventListener('input', (event) => {
    state.edit.playheadSec = numberValue(event.target.value);
    selectClipForPlayhead(state.edit.playheadSec, segments);
    renderTimelineWorkbench();
    renderPreview();
  });

  const track = document.getElementById('timelineTrack');
  track.replaceChildren(
    ...segments.map((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `timeline-segment${item.index === state.edit.selectedClipIndex ? ' active' : ''}`;
      button.style.flexBasis = `${Math.max(7, item.widthPct)}%`;
      button.title = `${item.file} · ${secLabel(item.durationSec)}`;
      button.textContent = `${pad2(item.index + 1)} ${roleLabels[item.role] ?? item.role}`;
      button.addEventListener('click', () => {
        state.edit.selectedClipIndex = item.index;
        state.edit.playheadSec = item.timelineStartSec;
        renderAll();
      });
      return button;
    }),
  );

  const startField = document.getElementById('selectedClipStartField');
  const endField = document.getElementById('selectedClipEndField');
  const startDragField = document.getElementById('clipStartDragField');
  const endDragField = document.getElementById('clipEndDragField');
  const dragTrimLabel = document.getElementById('dragTrimLabel');
  const speedField = document.getElementById('clipSpeedField');
  const speedLabel = document.getElementById('clipSpeedLabel');
  startField.value = String(segment.sourceStartSec);
  endField.value = String(segment.sourceEndSec);
  startDragField.value = String(segment.sourceStartSec);
  endDragField.value = String(segment.sourceEndSec);
  speedField.value = String(segment.speed ?? 1);

  const updateDragLabels = () => {
    const start = numberValue(startDragField.value);
    const end = numberValue(endDragField.value);
    const speed = numberValue(speedField.value);
    dragTrimLabel.textContent = `${secLabel(start)} - ${secLabel(end)}`;
    speedLabel.textContent = `${speed.toFixed(2).replace(/\.00$/, '')}x`;
    startField.value = String(start);
    endField.value = String(end);
  };
  updateDragLabels();

  const applyTrim = (status = '선택 장면의 시작/종료 시간을 조정했습니다.') => {
    const next = trimClipRange(
      state.draft.clips,
      state.edit.selectedClipIndex,
      numberValue(startField.value),
      numberValue(endField.value),
    );
    setDraftClips(next, status);
    renderAll();
  };
  document.getElementById('applyClipTrimBtn').addEventListener('click', () => applyTrim());
  startField.addEventListener('change', () => applyTrim());
  endField.addEventListener('change', () => applyTrim());
  const applyDragTrim = () => {
    const next = dragTrimClipRange(state.draft.clips, state.edit.selectedClipIndex, {
      startSec: numberValue(startDragField.value),
      endSec: numberValue(endDragField.value),
    });
    setDraftClips(next, '드래그 트림을 적용했습니다.');
    renderAll();
  };
  startDragField.addEventListener('input', updateDragLabels);
  endDragField.addEventListener('input', updateDragLabels);
  startDragField.addEventListener('change', applyDragTrim);
  endDragField.addEventListener('change', applyDragTrim);
  const applySpeed = (speed, status = '선택 장면 속도를 조정했습니다.') => {
    setDraftClips(setClipSpeed(state.draft.clips, state.edit.selectedClipIndex, speed), status);
    renderAll();
  };
  speedField.addEventListener('input', updateDragLabels);
  speedField.addEventListener('change', () => applySpeed(numberValue(speedField.value)));
  document.getElementById('speedHalfBtn').addEventListener('click', () => applySpeed(0.5, '선택 장면을 0.5x 슬로우로 설정했습니다.'));
  document.getElementById('speedNormalBtn').addEventListener('click', () => applySpeed(1, '선택 장면 속도를 1x로 되돌렸습니다.'));
  document.getElementById('speedFastBtn').addEventListener('click', () => applySpeed(1.5, '선택 장면을 1.5x 빨리감기로 설정했습니다.'));
  document.getElementById('speedDoubleBtn').addEventListener('click', () => applySpeed(2, '선택 장면을 2x 압축했습니다.'));
  document.getElementById('splitSelectedClipBtn').addEventListener('click', () => {
    const next = splitClipAt(state.draft.clips, state.edit.selectedClipIndex, sourceTimeFromPlayhead(segment));
    if (next.length === state.draft.clips.length) {
      state.status = '너무 짧은 구간은 분할할 수 없습니다.';
      refreshChrome();
      return;
    }
    setDraftClips(next, '현재 위치에서 장면을 둘로 나눴습니다.');
    state.edit.selectedClipIndex = Math.min(state.edit.selectedClipIndex + 1, next.length - 1);
    renderAll();
  });
  document.getElementById('smartTrimBtn').addEventListener('click', () => {
    const next = dragTrimClipRange(state.draft.clips, state.edit.selectedClipIndex, {
      startSec: segment.sourceStartSec + 0.15,
      endSec: segment.sourceEndSec - 0.15,
    });
    setDraftClips(next, '양끝 0.15초를 스마트 트림했습니다.');
    renderAll();
  });
  document.getElementById('applyScriptAutoEditBtn').addEventListener('click', () => {
    try {
      applyScriptAutoEdit();
    } catch (error) {
      reportApiError(error);
    }
  });
  document.getElementById('trimStartPlusBtn').addEventListener('click', () => {
    startField.value = String(Number(segment.sourceStartSec + 0.1).toFixed(2));
    applyTrim('앞부분 0.1초를 잘라냈습니다.');
  });
  document.getElementById('trimEndMinusBtn').addEventListener('click', () => {
    endField.value = String(Math.max(segment.sourceStartSec + 0.15, segment.sourceEndSec - 0.1).toFixed(2));
    applyTrim('뒷부분 0.1초를 잘라냈습니다.');
  });
  document.getElementById('deleteSelectedClipBtn').addEventListener('click', () => {
    const next = state.draft.clips.filter((_, index) => index !== state.edit.selectedClipIndex);
    setDraftClips(next, '선택 장면을 삭제했습니다.');
    state.edit.selectedClipIndex = Math.min(state.edit.selectedClipIndex, Math.max(0, next.length - 1));
    renderAll();
  });
  document.getElementById('presetFastHookBtn').addEventListener('click', () => {
    setDraftClips(applyEditPreset(state.draft.clips, 'viral_fast_hook'), '훅 압축 프리셋을 적용했습니다.');
    state.edit.selectedClipIndex = 0;
    renderAll();
  });
  document.getElementById('presetBreathBtn').addEventListener('click', () => {
    setDraftClips(applyEditPreset(state.draft.clips, 'breath_room'), '숨 쉴 여백 프리셋을 적용했습니다.');
    renderAll();
  });
  document.getElementById('presetDetailFocusBtn').addEventListener('click', () => {
    setDraftClips(applyEditPreset(state.draft.clips, 'detail_focus'), '디테일 줌 후보를 표시했습니다.');
    renderAll();
  });
}

function renderSilenceControls() {
  const clipField = document.getElementById('silenceClipField');
  if (!clipField) return;
  clipField.replaceChildren(
    ...state.draft.clips.map((clip, index) => {
      const option = document.createElement('option');
      option.value = clip.file;
      option.textContent = `${pad2(index + 1)} ${roleLabels[clip.role] ?? clip.role} · ${clip.file}`;
      option.selected = clip.file === state.silence.clipFile;
      return option;
    }),
  );
  clipField.addEventListener('change', (event) => {
    state.silence.clipFile = event.target.value;
    state.silence.report = null;
    renderSilenceWorkbench();
  });
  bindField('silenceNoiseField', state.silence.noiseDb, (value) => {
    state.silence.noiseDb = value;
  });
  bindField('silenceMinField', state.silence.minDurationSec, (value) => {
    state.silence.minDurationSec = value;
  });
  bindField('silencePaddingField', state.silence.paddingSec, (value) => {
    state.silence.paddingSec = value;
  });
  renderSilenceWorkbench();
}

function renderSilenceWorkbench() {
  const container = document.getElementById('silenceWorkbench');
  const badge = document.getElementById('silenceSummaryBadge');
  if (!container || !badge) return;
  const report = state.silence.report;
  if (!report?.plan) {
    badge.textContent = '대기';
    container.innerHTML = '<p class="note">영상을 선택한 뒤 무음구간 분석을 누르면 삭제 후보와 남길 구간이 표시됩니다.</p>';
    return;
  }

  const plan = report.plan;
  badge.textContent = `${plan.remove.length}개 삭제 후보`;
  const removeRows = (plan.remove ?? [])
    .map(
      (range, index) => `
        <article class="silence-row remove">
          <strong>삭제 ${pad2(index + 1)}</strong>
          <span>${Number(range.start).toFixed(2)}s - ${Number(range.end).toFixed(2)}s</span>
          <em>${Math.max(0, range.end - range.start).toFixed(2)}s</em>
        </article>
      `,
    )
    .join('');
  const keepRows = (plan.keep ?? [])
    .map(
      (range, index) => `
        <article class="silence-row keep">
          <strong>유지 ${pad2(index + 1)}</strong>
          <span>${Number(range.start).toFixed(2)}s - ${Number(range.end).toFixed(2)}s</span>
          <em>${Number(range.duration).toFixed(2)}s</em>
        </article>
      `,
    )
    .join('');

  container.innerHTML = `
    <div class="silence-summary-grid">
      <div class="metric-row"><span>원본 길이</span><strong>${Number(plan.sourceDurationSec).toFixed(2)}s</strong></div>
      <div class="metric-row"><span>삭제 길이</span><strong>${Number(plan.removedDurationSec).toFixed(2)}s</strong></div>
      <div class="metric-row"><span>예상 결과</span><strong>${Number(plan.outputDurationSec).toFixed(2)}s</strong></div>
    </div>
    <div class="silence-columns">
      <div>
        <h3>삭제 후보</h3>
        <div class="compact-list">${removeRows || '<p class="note">삭제할 무음구간이 없습니다.</p>'}</div>
      </div>
      <div>
        <h3>남길 구간</h3>
        <div class="compact-list">${keepRows || '<p class="note">남길 구간이 없습니다.</p>'}</div>
      </div>
    </div>
  `;
}

async function analyzeSilenceLocal() {
  if (!state.silence.clipFile) throw new Error('먼저 분석할 클립을 선택해 주세요.');
  const projectPath = state.localProjectPath || (await saveProjectLocal());
  state.status = '무음 분석 중';
  state.commandOutput = `무음 분석 중\n${state.silence.clipFile}`;
  refreshChrome();
  const data = await apiPost('/api/silence/analyze', {
    projectPath,
    clipFile: state.silence.clipFile,
    noiseDb: state.silence.noiseDb,
    minDurationSec: state.silence.minDurationSec,
    paddingSec: state.silence.paddingSec,
  });
  state.silence.report = data.report;
  const warnings = data.report?.warnings ?? [];
  const removeCount = data.report?.plan?.remove?.length ?? 0;
  state.status = !data.ok
    ? '무음 분석 실패'
    : removeCount === 0
      ? '무음 분석 완료 — 삭제할 무음 구간 없음 (무음 기준을 -30dB 쪽으로 올리거나 최소 무음을 줄여보세요)'
      : `무음 분석 완료 — 삭제 후보 ${removeCount}개 (타임라인의 빗금 구간)`;
  state.commandOutput = warnings.length > 0 ? warnings.join('\n') : commandText(data) || state.status;
  renderAll();
}

function applySilencePlanToTimeline() {
  const report = state.silence.report;
  const keep = report?.plan?.keep ?? [];
  if (!report?.clip?.file || keep.length === 0) {
    state.status = '적용할 무음 분석 결과 없음';
    refreshChrome();
    return;
  }
  const sourceIndex = state.draft.clips.findIndex((clip) => clip.file === report.clip.file);
  if (sourceIndex < 0) {
    state.status = '원본 클립을 찾을 수 없음';
    refreshChrome();
    return;
  }
  const original = state.draft.clips[sourceIndex];
  const replacement = keep
    .filter((range) => Number(range.duration) >= 0.15)
    .map((range) => ({
      file: original.file,
      role: original.role,
      start: String(Number(range.start).toFixed(2)).replace(/\.00$/, ''),
      end: String(Number(range.end).toFixed(2)).replace(/\.00$/, ''),
    }));
  if (replacement.length === 0) {
    state.status = '남길 구간이 너무 짧음';
    refreshChrome();
    return;
  }
  pushHistory('clips');
  state.draft.clips.splice(sourceIndex, 1, ...replacement);
  state.useLoadedManifest = false;
  state.useLoadedRisk = false;
  state.status = `무음 컷 적용: ${replacement.length}개 구간`;
}

async function autocutOneClick(clipFile) {
  const targetFile = clipFile || state.silence.clipFile || state.draft.clips[0]?.file;
  if (!targetFile) throw new Error('먼저 영상 클립을 추가해 주세요.');
  state.silence.clipFile = targetFile;
  await analyzeSilenceLocal();
  const plan = state.silence.report?.plan;
  applySilencePlanToTimeline();
  if (plan?.sourceDurationSec !== undefined && plan?.outputDurationSec !== undefined) {
    const removed = Math.max(0, Number(plan.sourceDurationSec) - Number(plan.outputDurationSec));
    state.status = `원클릭 무음컷 완료: ${plan.sourceDurationSec}s → ${plan.outputDurationSec}s (${removed.toFixed(1)}s 제거)`;
  }
  renderAll();
}

function renderCaptionControls() {
  const clipField = document.getElementById('captionClipField');
  if (!clipField) return;
  clipField.replaceChildren(
    ...state.draft.clips.map((clip, index) => {
      const option = document.createElement('option');
      option.value = clip.file;
      option.textContent = `${pad2(index + 1)} ${roleLabels[clip.role] ?? clip.role} · ${clip.file}`;
      option.selected = clip.file === state.captions.clipFile;
      return option;
    }),
  );
  clipField.addEventListener('change', (event) => {
    state.captions.clipFile = event.target.value;
    state.captions.report = null;
    renderCaptionWorkbench();
  });
  bindField('captionProviderField', state.captions.provider, (value) => {
    state.captions.provider = value;
    renderCaptionWorkbench();
  });
  bindField('captionLanguageField', state.captions.language, (value) => {
    state.captions.language = value;
  });
  bindField('captionModelField', state.captions.model, (value) => {
    state.captions.model = value;
  });
  bindField('captionMinCharsField', state.captions.minChars, (value) => {
    state.captions.minChars = value;
  });
  bindField('captionMaxCharsField', state.captions.maxChars, (value) => {
    state.captions.maxChars = value;
  });
  renderCaptionWorkbench();
}

function currentCaptionCues() {
  return state.captions.report?.cues ?? [];
}

function setCaptionCues(cues, status) {
  if (!state.captions.report) return;
  state.captions.report = {
    ...state.captions.report,
    cues,
    cueCount: cues.length,
  };
  if (status) state.status = status;
}

function renderCaptionWorkbench() {
  const container = document.getElementById('captionWorkbench');
  const badge = document.getElementById('captionSummaryBadge');
  if (!container || !badge) return;
  const report = state.captions.report;
  const tools = state.captions.tools ?? report?.tools ?? [];
  const toolRows = tools
    .map(
      (tool) => `
        <article class="caption-tool-row ${tool.available ? 'ready' : 'missing'}">
          <strong>${tool.label}</strong>
          <span>${tool.available ? '사용 가능' : '설치 필요'}</span>
          <em>${tool.version || tool.installHint}</em>
        </article>
      `,
    )
    .join('');

  if (!report?.cueCount) {
    badge.textContent = tools.length > 0 ? '환경 확인됨' : '대기';
    container.innerHTML = `
      <p class="note">클립을 선택하고 자동자막을 생성하면 SRT가 프로젝트의 captions 폴더에 저장됩니다. 렌더 실행 시 이 SRT가 있으면 최종 영상에 자동으로 자막이 입혀집니다.</p>
      ${toolRows ? `<div class="caption-tool-list">${toolRows}</div>` : ''}
    `;
    return;
  }

  badge.textContent = `${report.cueCount}개 자막`;
  const warnings = (report.warnings ?? [])
    .map((warning) => `<p class="note warn">${warning}</p>`)
    .join('');
  container.innerHTML = `
    <div class="caption-summary-grid">
      <div class="metric-row"><span>엔진</span><strong>${captionProviderLabels[report.provider] ?? report.provider}</strong></div>
      <div class="metric-row"><span>SRT</span><strong>${report.srtFile}</strong></div>
      <div class="metric-row"><span>렌더 반영</span><strong>저장 후 자동 적용</strong></div>
    </div>
    ${warnings}
    <div class="button-row compact">
      <button id="saveCaptionEditsBtn" class="primary-button" type="button">자막 수정 저장</button>
      <button id="applyCaptionTextBtn" class="ghost-button" type="button">상위 3줄을 CTA에 반영</button>
    </div>
    <div id="captionCueEditor" class="caption-cue-editor"></div>
    ${toolRows ? `<div class="caption-tool-list">${toolRows}</div>` : ''}
  `;

  document.getElementById('saveCaptionEditsBtn').addEventListener('click', () => saveCaptionEditsLocal().catch(reportApiError));
  document.getElementById('applyCaptionTextBtn').addEventListener('click', () => {
    applyCaptionReportToDraft();
    renderAll();
  });

  const editor = document.getElementById('captionCueEditor');
  const cues = currentCaptionCues();
  if (cues.length === 0) {
    editor.innerHTML = '<p class="note">편집할 자막 줄이 없습니다.</p>';
    return;
  }

  editor.replaceChildren(
    ...cues.map((cue, index) => {
      const row = document.createElement('article');
      row.className = 'caption-cue-edit-row';
      row.innerHTML = `
        <strong>${pad2(index + 1)}</strong>
        <label>시작<input data-field="start" type="number" min="0" step="0.01" /></label>
        <label>종료<input data-field="end" type="number" min="0" step="0.01" /></label>
        <textarea data-field="text" rows="2"></textarea>
        <div class="mini-button-row">
          <button class="icon-button" type="button" data-action="merge" title="다음 줄과 합치기">↴</button>
          <button class="icon-button danger-button" type="button" data-action="delete" title="삭제">×</button>
        </div>
      `;
      row.querySelector('[data-field="start"]').value = msToSecText(cue.startMs);
      row.querySelector('[data-field="end"]').value = msToSecText(cue.endMs);
      row.querySelector('[data-field="text"]').value = cue.text ?? '';
      row.querySelector('[data-field="start"]').addEventListener('change', (event) => {
        setCaptionCues(updateCueAt(currentCaptionCues(), index, { startMs: secToMs(event.target.value) }), '자막 시작 시간을 수정했습니다.');
        renderCaptionWorkbench();
      });
      row.querySelector('[data-field="end"]').addEventListener('change', (event) => {
        setCaptionCues(updateCueAt(currentCaptionCues(), index, { endMs: secToMs(event.target.value) }), '자막 종료 시간을 수정했습니다.');
        renderCaptionWorkbench();
      });
      row.querySelector('[data-field="text"]').addEventListener('input', (event) => {
        setCaptionCues(updateCueAt(currentCaptionCues(), index, { text: event.target.value }));
      });
      row.querySelector('[data-action="merge"]').disabled = index >= cues.length - 1;
      row.querySelector('[data-action="merge"]').addEventListener('click', () => {
        setCaptionCues(mergeCueWithNext(currentCaptionCues(), index), '자막 두 줄을 합쳤습니다.');
        renderCaptionWorkbench();
      });
      row.querySelector('[data-action="delete"]').addEventListener('click', () => {
        setCaptionCues(deleteCueAt(currentCaptionCues(), index), '자막 줄을 삭제했습니다.');
        renderCaptionWorkbench();
      });
      return row;
    }),
  );
}

async function checkCaptionToolsLocal() {
  state.status = '자동자막 환경 확인 중';
  state.commandOutput = '자동자막 환경 확인 중';
  refreshChrome();
  const response = await fetch('/api/captions/status');
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error(data.error || '자동자막 환경 확인에 실패했습니다.');
  state.captions.tools = data.tools ?? [];
  state.status = data.localWhisperReady ? '로컬 Whisper 자동자막 준비 완료' : '자동자막 설치 확인 필요';
  const toolLines = (data.tools ?? []).map(
    (tool) => `${tool.available ? '준비됨' : '설치 필요'} · ${tool.label}${tool.available || !tool.installHint ? '' : ` — ${tool.installHint}`}`,
  );
  state.commandOutput = [state.status, ...toolLines].join('\n');
  renderAll();
}

function buildScriptCaptionReport(cues, source = 'manual') {
  return {
    provider: 'script-analysis',
    clip: {
      file: state.captions.clipFile || state.draft.clips[0]?.file || source,
    },
    srtFile: 'captions/script.auto.srt',
    cueCount: cues.length,
    cues,
    warnings: [
      '대본 기반 자동자막입니다. 실제 음성과 싱크가 다르면 자막 줄의 시작/종료 시간을 미세 조정하세요.',
    ],
  };
}

function generateScriptCaptionsLocal() {
  const script = clean(state.draft.story.script);
  if (!script) throw new Error('먼저 AI 스토리 탭에 대본을 입력해 주세요.');
  const durationSec = selectedDuration() || Math.max(3, numberValue(state.draft.style.duration) || 25);
  const cues = scriptToCaptionCues(script, {
    durationSec,
    maxChars: numberValue(state.captions.maxChars) || 28,
    minCueMs: 800,
  });
  if (cues.length === 0) throw new Error('대본에서 자막 문장을 찾지 못했습니다.');
  state.captions.report = buildScriptCaptionReport(cues, 'script');
  state.tts.scriptSource = 'captions';
  state.status = `대본 기반 자동자막 생성 완료: ${cues.length}줄`;
  state.commandOutput = `대본 기반 자동자막 ${cues.length}줄을 만들었습니다.\n저장 위치: ${state.captions.report.srtFile}`;
  renderAll();
}

function applyScriptAutoEdit() {
  const script = clean(state.draft.story.script);
  if (!script) throw new Error('먼저 AI 스토리 탭에 대본을 입력해 주세요.');
  if (state.draft.clips.length === 0) throw new Error('먼저 파일 탭에서 영상이나 이미지를 추가해 주세요.');
  const plan = analyzeScriptForAutoEdit(script, state.draft.clips, {
    maxChars: numberValue(state.captions.maxChars) || 28,
  });
  state.edit.autoPlan = plan;
  setDraftClips(
    applyAutoEditPlan(state.draft.clips, plan),
    `대본 분석 자동편집 적용: ${plan.actions.length}개 조정, 자막 ${plan.captionCueCount}줄`,
  );
  if (plan.cues.length > 0) {
    state.captions.report = buildScriptCaptionReport(plan.cues, 'script-auto-edit');
    state.tts.scriptSource = 'captions';
  }
  state.commandOutput = `대본 분석 자동편집을 적용했습니다.\n클립 조정 ${plan.actions.length}개 · 자막 ${plan.captionCueCount}줄`;
  renderAll();
}

async function generateCaptionsLocal() {
  if (!state.captions.clipFile) throw new Error('먼저 자막을 만들 클립을 선택해 주세요.');
  const projectPath = state.localProjectPath || (await saveProjectLocal());
  state.status = '자동자막 생성 중';
  state.commandOutput = `자동자막 생성 중\n${state.captions.clipFile}`;
  refreshChrome();
  const data = await apiPost('/api/captions/generate', {
    projectPath,
    clipFile: state.captions.clipFile,
    provider: state.captions.provider,
    language: state.captions.language,
    model: state.captions.model,
    minChars: state.captions.minChars,
    maxChars: state.captions.maxChars,
  });
  state.status = data.ok ? '자동자막 생성 완료' : '자동자막 생성 실패';
  state.commandOutput = commandText(data) || state.status;
  state.captions.report = data.report;
  state.captions.tools = data.report?.tools ?? state.captions.tools;
  renderAll();
}

async function saveCaptionEditsLocal() {
  const report = state.captions.report;
  if (!report?.srtFile) throw new Error('저장할 SRT 파일이 없습니다. 먼저 자동자막을 생성해 주세요.');
  const projectPath = state.localProjectPath || (await saveProjectLocal());
  state.status = '자막 수정 저장 중';
  refreshChrome();
  const data = await apiPost('/api/captions/save', {
    projectPath,
    srtFile: report.srtFile,
    cues: currentCaptionCues(),
  });
  state.status = data.ok ? '자막 수정 저장 완료' : '자막 수정 저장 실패';
  state.commandOutput = data.srtFile ? `SRT 저장 완료\n${data.srtFile}` : state.status;
  renderAll();
}

function applyCaptionReportToDraft() {
  const cues = state.captions.report?.cues ?? [];
  const text = cues
    .slice(0, 3)
    .map((cue) => clean(cue.text))
    .filter(Boolean)
    .join(' ');
  if (!text) {
    state.status = '반영할 자동자막 결과가 없습니다.';
    refreshChrome();
    return;
  }
  changeDraft((draft) => {
    draft.publish.cta = trimLine(text, 110);
  });
  state.status = '자동자막 대표 문구를 CTA에 반영했습니다.';
}

function renderRolePalette() {
  const container = document.getElementById('rolePalette');
  if (!container) return;
  container.replaceChildren(
    ...roleIds.map((role) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `role-chip${essentialRoles.includes(role) ? ' active' : ''}`;
      button.textContent = roleLabels[role];
      button.addEventListener('click', () => {
        pushHistory('clips');
        state.draft.clips.push({ file: `clips/${role}-${state.draft.clips.length + 1}.mp4`, role, start: '0', end: '3' });
        state.useLoadedManifest = false;
        state.useLoadedRisk = false;
        renderAll();
      });
      return button;
    }),
  );
}

function optionList(values, labels, selected) {
  return values
    .map((value) => `<option value="${value}"${value === selected ? ' selected' : ''}>${labels[value] ?? value}</option>`)
    .join('');
}

function renderClipRows() {
  const container = document.getElementById('clipRows');
  if (!container) return;
  container.replaceChildren(
    ...state.draft.clips.map((clip, index) => {
      const row = document.createElement('article');
      row.className = `clip-row clip-row-editor${index === state.edit.selectedClipIndex ? ' active' : ''}`;
      row.innerHTML = `
        <div class="order-cell">
          <strong>${pad2(index + 1)}</strong>
          <div class="mini-button-row">
            <button class="icon-button" type="button" data-action="up" title="위로 이동">↑</button>
            <button class="icon-button" type="button" data-action="down" title="아래로 이동">↓</button>
            <button class="icon-button" type="button" data-action="mute" title="${clip.mute ? '음성 다시 켜기' : '이 클립 음성 없애기'}">${clip.mute ? '🔇' : '🔊'}</button>
          </div>
        </div>
        <label>파일<select data-field="file">${clipFileOptionList(clip.file)}</select></label>
        <label>역할<select data-field="role">${optionList(roleIds, roleLabels, clip.role)}</select></label>
        <label>시작<input type="number" min="0" step="0.1" data-field="start" /></label>
        <label>종료<input type="number" min="0" step="0.1" data-field="end" /></label>
        <button class="icon-button danger-button" type="button" data-action="delete" title="삭제">×</button>
      `;
      row.querySelector('[data-field="start"]').value = clip.start;
      row.querySelector('[data-field="end"]').value = clip.end;
      row.querySelector('[data-action="up"]').disabled = index === 0;
      row.querySelector('[data-action="down"]').disabled = index === state.draft.clips.length - 1;
      row.querySelectorAll('[data-field]').forEach((field) => {
        field.addEventListener(field.tagName === 'SELECT' ? 'change' : 'input', () => {
          pushHistory('clip-field');
          state.edit.selectedClipIndex = index;
          state.draft.clips[index][field.dataset.field] = field.value;
          state.useLoadedManifest = false;
          state.useLoadedRisk = false;
          refreshChrome();
        });
      });
      row.querySelector('[data-action="up"]').addEventListener('click', () => {
        moveClip(index, -1);
      });
      row.querySelector('[data-action="down"]').addEventListener('click', () => {
        moveClip(index, 1);
      });
      row.querySelector('[data-action="mute"]').addEventListener('click', () => {
        pushHistory('clips');
        state.draft.clips[index].mute = !state.draft.clips[index].mute;
        state.useLoadedManifest = false;
        state.status = state.draft.clips[index].mute ? '클립 음성을 없앴습니다. 렌더에 반영됩니다.' : '클립 음성을 다시 켰습니다.';
        renderAll();
      });
      row.querySelector('[data-action="delete"]').addEventListener('click', () => {
        pushHistory('clips');
        state.draft.clips.splice(index, 1);
        state.edit.selectedClipIndex = Math.min(state.edit.selectedClipIndex, Math.max(0, state.draft.clips.length - 1));
        state.useLoadedManifest = false;
        state.useLoadedRisk = false;
        renderAll();
      });
      row.addEventListener('click', (event) => {
        if (event.target.closest('button, input, select')) return;
        state.edit.selectedClipIndex = index;
        const { segments } = buildTimelineSegments(state.draft.clips);
        state.edit.playheadSec = segments[index]?.timelineStartSec ?? 0;
        renderAll();
      });
      return row;
    }),
  );
}

function moveClip(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= state.draft.clips.length) return;
  pushHistory('clips');
  state.draft.clips = moveWorkbenchItem(state.draft.clips, index, direction);
  state.edit.selectedClipIndex = target;
  state.useLoadedManifest = false;
  state.useLoadedRisk = false;
  renderAll();
}

function renderImageSceneRows() {
  const container = document.getElementById('imageSceneRows');
  if (!container) return;
  if (state.imageScenes.length === 0) {
    container.innerHTML = '<p class="note">이미지를 선택하면 이곳에 순서표가 생깁니다. 위/아래 버튼으로 장면 순서를 바꿀 수 있습니다.</p>';
    return;
  }
  container.replaceChildren(
    ...state.imageScenes.map((scene, index) => {
      const row = document.createElement('article');
      row.className = 'image-scene-row';
      row.innerHTML = `
        <div class="order-cell">
          <strong>${pad2(index + 1)}</strong>
          <div class="mini-button-row">
            <button class="icon-button" type="button" data-action="up" title="위로 이동">↑</button>
            <button class="icon-button" type="button" data-action="down" title="아래로 이동">↓</button>
          </div>
        </div>
        <label>이미지<input type="text" data-field="image" /></label>
        <label>길이(초)<input type="number" min="1" max="30" step="0.5" data-field="durationSec" /></label>
        <button class="icon-button danger-button" type="button" data-action="delete" title="삭제">×</button>
        <label class="field-wide">내레이션<textarea rows="2" data-field="narration"></textarea></label>
        <label class="field-wide">화면 자막<textarea rows="2" data-field="caption"></textarea></label>
      `;
      row.querySelector('[data-field="image"]').value = scene.image;
      row.querySelector('[data-field="durationSec"]').value = scene.durationSec;
      row.querySelector('[data-field="narration"]').value = scene.narration;
      row.querySelector('[data-field="caption"]').value = scene.caption;
      row.querySelector('[data-action="up"]').disabled = index === 0;
      row.querySelector('[data-action="down"]').disabled = index === state.imageScenes.length - 1;
      row.querySelectorAll('[data-field]').forEach((field) => {
        field.addEventListener('input', () => {
          state.imageScenes[index][field.dataset.field] = field.value;
          renderStoryboardOutput();
        });
      });
      row.querySelector('[data-action="up"]').addEventListener('click', () => moveImageScene(index, -1));
      row.querySelector('[data-action="down"]').addEventListener('click', () => moveImageScene(index, 1));
      row.querySelector('[data-action="delete"]').addEventListener('click', () => {
        state.imageScenes.splice(index, 1);
        renderAll();
      });
      return row;
    }),
  );
}

function moveImageScene(index, direction) {
  const target = index + direction;
  if (target < 0 || target >= state.imageScenes.length) return;
  const [scene] = state.imageScenes.splice(index, 1);
  state.imageScenes.splice(target, 0, scene);
  renderAll();
}

function buildStoryboardBundle() {
  return {
    projectName: `${state.draft.projectName || 'story'}-storyboard`,
    title: clean(state.draft.story.title) || clean(state.draft.product.name) || '이미지 영상',
    productName: clean(state.draft.product.name) || 'Story Channel',
    affiliateUrl: clean(state.draft.product.affiliateUrl) || 'https://example.com/story',
    disclosure: clean(state.draft.disclosure.text) || 'AI 생성 또는 사용자가 제공한 이미지로 만든 영상입니다.',
    imageRights: state.imageRights,
    scenes: state.imageScenes
      .filter((scene) => clean(scene.image))
      .map((scene, index) => ({
        image: clean(scene.image),
        narration: clean(scene.narration) || `장면 ${index + 1}`,
        caption: clean(scene.caption) || clean(scene.narration) || `장면 ${index + 1}`,
        durationSec: Math.max(1, numberValue(scene.durationSec) || 4),
      })),
  };
}

function renderStoryboardOutput() {
  const output = document.getElementById('storyboardOutputField');
  if (!output) return;
  const bundle = buildStoryboardBundle();
  output.value =
    bundle.scenes.length > 0
      ? bundle.scenes
          .map((scene, index) => `장면 ${index + 1} · ${scene.durationSec}초 · ${scene.image}\n${scene.narration}`)
          .join('\n\n')
      : '이미지를 추가하면 영상화할 장면 순서가 여기에 표시됩니다.';
}

function applyImageScenesToClips() {
  const scenes = buildStoryboardBundle().scenes;
  if (scenes.length === 0) {
    state.status = '적용할 이미지 없음';
    refreshChrome();
    return;
  }
  pushHistory('clips');
  state.draft.clips = scenes.map((scene, index) => ({
    file: `clips/scene_${pad2(index + 1)}.mp4`,
    role: roleForStoryScene(index, scenes.length),
    start: '0',
    end: String(scene.durationSec),
  }));
  state.useLoadedManifest = false;
  state.useLoadedRisk = false;
  state.status = '영상화 클립 순서 적용';
}

async function runStoryboardLocal() {
  const bundle = buildStoryboardBundle();
  if (bundle.scenes.length === 0) throw new Error('먼저 이미지를 선택해 주세요.');
  state.status = '이미지 영상화 실행 중';
  state.commandOutput = '이미지를 영상 클립으로 만드는 중입니다.';
  refreshChrome();
  const data = await apiPost('/api/storyboard/render', bundle);
  state.localProjectPath = data.outputDir;
  applyImageScenesToClips();
  state.status = data.ok ? '이미지 영상화 완료' : '이미지 영상화 실패';
  state.commandOutput = commandText(data) || `${state.status}\n${data.outputDir}`;
  state.selectedTab = 'output';
  renderAll();
}

function renderStoryTab(content) {
  content.innerHTML = `
    <div class="section-stack">
      <section class="tool-section">
        <div class="section-head">
          <h3>스토리 입력</h3>
          <button id="buildStoryBtn" class="primary-button" type="button">장면 설계</button>
        </div>
        <div class="field-grid">
          <label class="field-wide">제목<input id="storyTitleField" type="text" /></label>
          <label class="field-wide">대본<textarea id="storyScriptField" rows="7"></textarea></label>
        </div>
      </section>
      <section class="tool-section">
        <div class="section-head"><h3>장면 설계안</h3><span id="storyCountBadge" class="soft-badge"></span></div>
        <textarea id="storyOutputField" class="yaml-field" readonly></textarea>
      </section>
      <section class="tool-section">
        <div class="section-head">
          <h3>AI 이미지 생성</h3>
          <span class="soft-badge">${aiProviderLabels[state.ai.provider]}</span>
        </div>
        <div class="button-row">
          <button id="generateStoryImagesBtn" class="primary-button" type="button">현재 대본으로 이미지 생성</button>
          <button id="goAiSettingsBtn" class="ghost-button" type="button">AI 엔진 설정</button>
        </div>
        <textarea id="imageGenerationOutputField" class="command-output" readonly></textarea>
      </section>
    </div>
  `;
  bindField('storyTitleField', state.draft.story.title, (value) =>
    changeDraft((draft) => {
      draft.story.title = value;
      renderStoryOutput();
    }),
  );
  bindField('storyScriptField', state.draft.story.script, (value) =>
    changeDraft((draft) => {
      draft.story.script = value;
      renderStoryOutput();
    }),
  );
  byId('buildStoryBtn').addEventListener('click', renderStoryOutput);
  byId('generateStoryImagesBtn').addEventListener('click', () => runStoryImageGeneration().catch(reportApiError));
  byId('goAiSettingsBtn').addEventListener('click', () => {
    state.selectedTab = 'ai';
    renderAll();
  });
  renderStoryOutput();
  renderImageGenerationOutput();
}

function renderStoryOutput() {
  const output = document.getElementById('storyOutputField');
  const badge = document.getElementById('storyCountBadge');
  if (!output) return;
  const plan = buildStoryPlan();
  output.value =
    plan.scenes.length > 0 && clean(state.draft.story.script)
      ? plan.scenes.map((scene) => `장면 ${scene.index}. ${scene.narration}`).join('\n\n')
      : '대본을 입력하고 장면 설계를 누르면 장면별 구성이 여기에 표시됩니다.';
  if (badge) badge.textContent = `${plan.sceneCount}장면`;
}

function buildStoryImageGenerationPayload() {
  return {
    projectName: `${state.draft.projectName || 'story'}-images`,
    title: clean(state.draft.story.title) || clean(state.draft.product.name) || 'AI 스토리',
    script: clean(state.draft.story.script),
    productName: clean(state.draft.product.name) || 'Story Channel',
    affiliateUrl: clean(state.draft.product.affiliateUrl) || 'https://example.com/story',
    sceneDurationSec: 4,
    provider: state.ai.provider,
    model: currentAiModel(),
    apiKey: state.ai.apiKey,
    endpoint: state.ai.endpoint,
  };
}

function renderImageGenerationOutput() {
  const output = document.getElementById('imageGenerationOutputField');
  if (!output) return;
  output.value = state.commandOutput || `${aiProviderLabels[state.ai.provider]} 준비됨`;
}

async function runStoryImageGeneration() {
  const payload = buildStoryImageGenerationPayload();
  if (!payload.script) throw new Error('먼저 AI 스토리 대본을 입력해 주세요.');
  state.status = 'AI 이미지 생성 중';
  state.commandOutput = `${aiProviderLabels[state.ai.provider]} 이미지 생성 중\n${payload.title}`;
  refreshChrome();
  renderImageGenerationOutput();
  const data = await apiPost('/api/story-images/generate', payload);
  if (data.storyboard?.scenes?.length) {
    state.imageScenes = data.storyboard.scenes.map((scene) => ({
      image: scene.image,
      narration: scene.narration,
      caption: scene.caption,
      durationSec: String(scene.durationSec ?? 4),
    }));
  }
  state.localProjectPath = data.outDir || state.localProjectPath;
  state.status = data.ok ? 'AI 이미지 생성 완료' : 'AI 이미지 생성 실패';
  state.commandOutput = commandText(data) || `${state.status}\n${data.outDir ?? ''}`;
  state.selectedTab = data.storyboard?.scenes?.length ? 'edit' : 'story';
  renderAll();
}

function renderLongformTab(content) {
  content.innerHTML = `
    <div class="section-stack">
      <section class="tool-section">
        <div class="section-head">
          <h3>롱폼 소스</h3>
          <button id="buildLongformBtn" class="primary-button" type="button">후보 만들기</button>
        </div>
        <div class="field-grid">
          <label class="field-wide">영상 파일<input id="longformFileField" type="text" /></label>
          <label>길이(초)<input id="longformDurationField" type="number" min="1" step="1" /></label>
          <label>상품명<input id="longformProductField" type="text" /></label>
          <label class="field-wide">제휴 링크<input id="longformUrlField" type="url" /></label>
        </div>
      </section>
      <section class="tool-section">
        <div class="section-head"><h3>하이라이트 후보</h3></div>
        <textarea id="longformOutputField" class="yaml-field" readonly></textarea>
      </section>
    </div>
  `;
  bindField('longformFileField', state.draft.longform.file, (value) =>
    changeDraft((draft) => {
      draft.longform.file = value;
      renderLongformOutput();
    }),
  );
  bindField('longformDurationField', state.draft.longform.duration, (value) =>
    changeDraft((draft) => {
      draft.longform.duration = value;
      renderLongformOutput();
    }),
  );
  bindField('longformProductField', state.draft.longform.productName, (value) =>
    changeDraft((draft) => {
      draft.longform.productName = value;
      renderLongformOutput();
    }),
  );
  bindField('longformUrlField', state.draft.longform.affiliateUrl, (value) =>
    changeDraft((draft) => {
      draft.longform.affiliateUrl = value;
      renderLongformOutput();
    }),
  );
  byId('buildLongformBtn').addEventListener('click', renderLongformOutput);
  renderLongformOutput();
}

function renderLongformOutput() {
  const output = document.getElementById('longformOutputField');
  if (!output) return;
  const plan = buildLongformPlan();
  output.value =
    plan.candidates.length > 0
      ? plan.candidates
          .map((candidate) => `후보 ${candidate.index} · ${candidate.start}초~${candidate.end}초 (${candidate.duration}초) · ${candidate.reason}`)
          .join('\n')
      : '영상 파일과 길이를 입력하고 후보 만들기를 누르면 하이라이트 후보가 표시됩니다.';
}

function renderPlatformTab(content) {
  const item = getSelectedItem();
  content.innerHTML = `
    <div class="section-stack">
      <section class="tool-section">
        <div class="section-head">
          <h3>플랫폼 선택</h3>
          <button id="loadManifestBtn" class="ghost-button" type="button">업로드안 불러오기</button>
        </div>
        <div id="platformPicker" class="platform-pills"></div>
      </section>
      <section class="tool-section">
        <div class="section-head"><h3>영상안 선택</h3><span class="soft-badge">${getVideoFiles().length}개</span></div>
        <div id="variantRows" class="variant-list"></div>
      </section>
      <section class="tool-section">
        <div class="section-head"><h3>업로드 문구</h3><button id="copyCaptionBtn" class="ghost-button" type="button">캡션 복사</button></div>
        <div class="field-grid">
          <label class="field-wide">제목<input id="uploadTitleField" type="text" /></label>
          <label class="field-wide">캡션<textarea id="uploadCaptionField" rows="7"></textarea></label>
          <label class="field-wide">고정 댓글<textarea id="fixedCommentField" rows="4"></textarea></label>
          <label class="field-wide">해시태그<input id="uploadHashtagsField" type="text" /></label>
        </div>
      </section>
    </div>
  `;
  renderPlatformPicker();
  renderVariantRows();
  if (item) {
    bindField('uploadTitleField', item.title, (value) => updateSelectedManifestItem((selected) => (selected.title = value)));
    bindField('uploadCaptionField', item.caption, (value) => updateSelectedManifestItem((selected) => (selected.caption = value)));
    bindField('fixedCommentField', item.fixedComment, (value) => updateSelectedManifestItem((selected) => (selected.fixedComment = value)));
    bindField('uploadHashtagsField', formatTags(item.hashtags), (value) =>
      updateSelectedManifestItem((selected) => {
        selected.hashtags = parseTags(value);
      }),
    );
  }
  byId('copyCaptionBtn').addEventListener('click', () => {
    copyText(byId('uploadCaptionField').value, '캡션을 복사했습니다.').catch(() => {
      state.status = '복사 실패';
      refreshChrome();
    });
  });
  byId('loadManifestBtn').addEventListener('click', () => byId('manifestInput').click());
}

function renderPlatformPicker() {
  const container = document.getElementById('platformPicker');
  if (!container) return;
  container.replaceChildren(
    ...(state.manifest.platforms ?? []).map((platform) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `platform-chip${platform === state.selectedPlatform ? ' active' : ''}`;
      button.textContent = platformLabels[platform] ?? platform;
      button.addEventListener('click', () => {
        state.selectedPlatform = platform;
        renderAll();
      });
      return button;
    }),
  );
}

function renderVariantRows() {
  const container = document.getElementById('variantRows');
  if (!container) return;
  container.replaceChildren(
    ...getVideoFiles().map((videoFile) => {
      const item = state.manifest.items.find(
        (candidate) => candidate.videoFile === videoFile && candidate.platform === state.selectedPlatform,
      );
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `variant-row${videoFile === state.selectedVideo ? ' active' : ''}`;
      button.innerHTML = '<strong></strong><span></span>';
      button.querySelector('strong').textContent = videoFile;
      button.querySelector('span').textContent = item?.hook ?? '-';
      button.addEventListener('click', () => {
        state.selectedVideo = videoFile;
        renderAll();
      });
      return button;
    }),
  );
}

function updateSelectedManifestItem(updater) {
  state.useLoadedManifest = true;
  const item = getSelectedItem();
  if (!item) return;
  updater(item);
  renderPreview();
  renderActionPanel();
}

function renderSourcesTab(content) {
  const risk = state.risk?.summary ?? { safe: 0, caution: 0, risk: 0 };
  content.innerHTML = `
    <div class="section-stack">
      <section class="tool-section">
        <div class="section-head">
          <h3>소스 보드</h3>
          <div class="button-row compact">
            <button id="loadRiskBtn" class="ghost-button" type="button">저작권표 불러오기</button>
            <button id="addSourceBtn" class="primary-button" type="button">소스 추가</button>
          </div>
        </div>
        <div id="sourceRows" class="source-list"></div>
      </section>
      <section class="tool-section">
        <div class="section-head">
          <h3>저작권 점검</h3>
          <span class="soft-badge">안전 ${risk.safe} · 확인 ${risk.caution} · 위험 ${risk.risk}</span>
        </div>
        <div id="riskRows" class="risk-list"></div>
      </section>
    </div>
  `;
  byId('loadRiskBtn').addEventListener('click', () => byId('riskInput').click());
  byId('addSourceBtn').addEventListener('click', () => {
    pushHistory('sources');
    state.draft.sources.push({
      title: `참고 소스 ${state.draft.sources.length + 1}`,
      url: 'https://example.com/reference',
      file: '',
      rights: 'reference_only',
      usage: 'reference',
      notes: '구조만 참고',
    });
    state.useLoadedRisk = false;
    renderAll();
  });
  renderSourceRows();
  renderRiskRows();
}

function renderMediaLibrary() {
  const container = document.getElementById('mediaLibraryGrid');
  if (!container) return;
  const tiles = [];
  const seen = new Set();
  state.draft.clips.forEach((clip, index) => {
    if (!clean(clip.file) || seen.has(clip.file)) return;
    seen.add(clip.file);
    tiles.push({ kind: isImageFile(clip.file) ? 'image' : 'video', file: clip.file, clipIndex: index });
  });
  state.imageScenes.forEach((scene) => {
    if (!clean(scene.image) || seen.has(scene.image)) return;
    seen.add(scene.image);
    tiles.push({ kind: 'image', file: scene.image });
  });
  if (clean(state.draft.bgm.file)) tiles.push({ kind: 'audio', file: state.draft.bgm.file });

  const badge = document.getElementById('mediaLibraryCount');
  if (badge) badge.textContent = `${tiles.length}개`;
  if (tiles.length === 0) {
    container.innerHTML = '<p class="note">아직 가져온 파일이 없습니다. 위 버튼으로 영상·이미지·BGM을 추가하세요.</p>';
    return;
  }
  container.replaceChildren(
    ...tiles.map((tile) => {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = `media-tile${tile.clipIndex === state.edit.selectedClipIndex ? ' active' : ''}`;
      const name = tile.file.split('/').pop();
      const url = escapeHtml(mediaPreviewUrl({ file: tile.file }));
      card.innerHTML =
        tile.kind === 'video'
          ? `<video src="${url}" preload="metadata" muted></video><span>${escapeHtml(name)}</span>`
          : tile.kind === 'image'
            ? `<img src="${url}" alt="" loading="lazy" /><span>${escapeHtml(name)}</span>`
            : `<div class="media-tile-audio">🎵</div><span>${escapeHtml(name)}</span>`;
      if (tile.clipIndex !== undefined) {
        card.title = '클릭하면 타임라인에서 이 클립을 선택합니다';
        card.addEventListener('click', () => {
          state.edit.selectedClipIndex = tile.clipIndex;
          const { segments } = buildTimelineSegments(state.draft.clips);
          state.edit.playheadSec = segments[tile.clipIndex]?.timelineStartSec ?? 0;
          renderAll();
        });
      }
      return card;
    }),
  );
}

function renderStickerRows() {
  const container = document.getElementById('stickerRows');
  if (!container) return;
  if (state.draft.stickers.length === 0) {
    container.innerHTML = '<p class="note">아직 스티커가 없습니다. 스티커 추가를 눌러 시작하세요.</p>';
    return;
  }
  container.replaceChildren(
    ...state.draft.stickers.map((sticker, index) => {
      const row = document.createElement('article');
      row.className = 'sticker-row';
      row.innerHTML = `
        <label>문구<input type="text" data-field="text" /></label>
        <label>시작(초)<input type="number" min="0" step="0.1" data-field="start" /></label>
        <label>끝(초)<input type="number" min="0" step="0.1" data-field="end" /></label>
        <label>위치<select data-field="position">${optionList(stickerPositionIds, stickerPositionLabels, sticker.position)}</select></label>
        <button class="icon-button danger-button" type="button">×</button>
      `;
      row.querySelector('[data-field="text"]').value = sticker.text;
      row.querySelector('[data-field="start"]').value = sticker.start;
      row.querySelector('[data-field="end"]').value = sticker.end;
      row.querySelectorAll('[data-field]').forEach((field) => {
        field.addEventListener(field.tagName === 'SELECT' ? 'change' : 'input', () => {
          pushHistory('sticker-field');
          state.draft.stickers[index][field.dataset.field] = field.value;
        });
      });
      row.querySelector('button.icon-button').addEventListener('click', () => {
        pushHistory('stickers');
        state.draft.stickers.splice(index, 1);
        renderAll();
      });
      return row;
    }),
  );
}

function renderSourceRows() {
  const container = document.getElementById('sourceRows');
  if (!container) return;
  container.replaceChildren(
    ...state.draft.sources.map((source, index) => {
      const row = document.createElement('article');
      row.className = 'source-row';
      row.innerHTML = `
        <label>이름<input type="text" data-field="title" /></label>
        <label>URL 또는 파일<input type="text" data-field="locator" /></label>
        <label>권리<select data-field="rights">${optionList(rightsIds, rightsLabels, source.rights)}</select></label>
        <label>용도<select data-field="usage">${optionList(usageIds, usageLabels, source.usage)}</select></label>
        <button class="icon-button danger-button" type="button">×</button>
      `;
      row.querySelector('[data-field="title"]').value = source.title;
      row.querySelector('[data-field="locator"]').value = source.url || source.file || '';
      row.querySelectorAll('[data-field]').forEach((field) => {
        field.addEventListener(field.tagName === 'SELECT' ? 'change' : 'input', () => {
          pushHistory('source-field');
          if (field.dataset.field === 'locator') {
            if (isValidUrl(field.value)) {
              state.draft.sources[index].url = field.value;
              state.draft.sources[index].file = '';
            } else {
              state.draft.sources[index].file = field.value;
              state.draft.sources[index].url = '';
            }
          } else {
            state.draft.sources[index][field.dataset.field] = field.value;
          }
          state.useLoadedRisk = false;
          refreshChrome();
          renderRiskRows();
        });
      });
      row.querySelector('button').addEventListener('click', () => {
        pushHistory('sources');
        state.draft.sources.splice(index, 1);
        state.useLoadedRisk = false;
        renderAll();
      });
      return row;
    }),
  );
}

function renderRiskRows() {
  const container = document.getElementById('riskRows');
  if (!container) return;
  const items = state.risk?.items ?? [];
  container.replaceChildren(
    ...items.map((item) => {
      const row = document.createElement('article');
      row.className = 'risk-item';
      row.innerHTML = '<div class="section-head"><strong></strong><span></span></div><p class="note"></p>';
      row.querySelector('strong').textContent = item.title;
      const badge = row.querySelector('span');
      badge.className = `risk-badge ${item.level}`;
      badge.textContent = item.level === 'safe' ? '안전' : item.level === 'caution' ? '확인' : '위험';
      row.querySelector('p').textContent = item.reason;
      return row;
    }),
  );
}

function renderPerformanceTab(content) {
  content.innerHTML = `
    <div class="section-stack">
      <section class="tool-section">
        <div class="section-head">
          <h3>성과 CSV</h3>
          <span id="performanceGate" class="soft-badge">0/5</span>
        </div>
        <textarea id="performanceCsvField" class="yaml-field performance-field"></textarea>
        <div class="button-row">
          <button id="performanceTemplateBtn" class="ghost-button" type="button">샘플 채우기</button>
          <button id="performanceClearBtn" class="danger-button" type="button">비우기</button>
        </div>
      </section>
      <section class="tool-section">
        <div class="section-head"><h3>요약</h3></div>
        <div id="performanceSummary" class="performance-summary"></div>
      </section>
    </div>
  `;
  byId('performanceCsvField').value = state.performanceCsv;
  byId('performanceCsvField').addEventListener('input', (event) => {
    state.performanceCsv = event.target.value;
    renderPerformanceSummary();
  });
  byId('performanceTemplateBtn').addEventListener('click', () => {
    state.performanceCsv = performanceTemplate;
    byId('performanceCsvField').value = state.performanceCsv;
    renderPerformanceSummary();
  });
  byId('performanceClearBtn').addEventListener('click', () => {
    state.performanceCsv = '';
    byId('performanceCsvField').value = '';
    renderPerformanceSummary();
  });
  renderPerformanceSummary();
}

function renderPerformanceSummary() {
  const gate = document.getElementById('performanceGate');
  const container = document.getElementById('performanceSummary');
  if (!gate || !container) return;
  const { records, errors } = parsePerformanceCsv(state.performanceCsv);
  gate.textContent = `${records.length}/${minimumPerformanceRecords}`;
  if (!state.performanceCsv.trim()) {
    container.innerHTML = '<p class="note">실제 게시 후 성과 데이터를 붙여 넣으면 요약됩니다.</p>';
    return;
  }
  if (errors.length > 0) {
    container.replaceChildren(
      ...errors.slice(0, 4).map((message) => {
        const note = document.createElement('p');
        note.className = 'note danger';
        note.textContent = message;
        return note;
      }),
    );
    return;
  }
  const summary = summarizePerformance(records);
  container.innerHTML = `
    <div class="metric-list">
      <div class="metric-row"><span>기록</span><strong>${summary.recordCount}개</strong></div>
      <div class="metric-row"><span>조회수</span><strong>${formatNumber(summary.views)}</strong></div>
      <div class="metric-row"><span>클릭</span><strong>${formatNumber(summary.clicks)}</strong></div>
      <div class="metric-row"><span>주문</span><strong>${formatNumber(summary.orders)}</strong></div>
      <div class="metric-row"><span>매출</span><strong>${formatMoney(summary.revenue)}</strong></div>
      <div class="metric-row"><span>이익</span><strong>${formatMoney(summary.profit)}</strong></div>
      <div class="metric-row"><span>CTR</span><strong>${formatRate(summary.ctr)}</strong></div>
      <div class="metric-row"><span>CVR</span><strong>${formatRate(summary.cvr)}</strong></div>
    </div>
    <p class="note ${records.length >= minimumPerformanceRecords ? 'good' : ''}">
      ${records.length >= minimumPerformanceRecords ? '성과 비교가 가능한 기록 수입니다.' : `${minimumPerformanceRecords - records.length}개 기록이 더 필요합니다.`}
    </p>
  `;
}

function renderOutputTab(content) {
  const { errors, warnings } = validateDraft();
  content.innerHTML = `
    <div class="section-stack">
      <section class="tool-section">
        <div class="section-head">
          <h3>검증 결과</h3>
          <span class="soft-badge ${errors.length > 0 ? 'danger' : warnings.length > 0 ? 'warn' : 'good'}">${errors.length > 0 ? '오류 있음' : warnings.length > 0 ? '확인 필요' : '통과'}</span>
        </div>
        <ul id="outputValidation" class="validation-list"></ul>
      </section>
      <section class="tool-section">
        <div class="section-head"><h3>프로젝트 YAML</h3></div>
        <textarea id="yamlOutputField" class="yaml-field" readonly></textarea>
        <div class="button-row">
          <button id="copyYamlBtn" class="ghost-button" type="button">YAML 복사</button>
          <button id="downloadYamlBtn" class="ghost-button" type="button">프로젝트 YAML 저장</button>
          <button id="downloadManifestBtn" class="ghost-button" type="button">업로드안 파일 저장</button>
          <button id="saveLocalBtn" class="ghost-button" type="button">로컬 저장</button>
          <button id="validateLocalBtn" class="ghost-button" type="button">검증 실행</button>
          <button id="renderLocalBtn" class="ghost-button" type="button">렌더 실행</button>
          <button id="packageLocalBtn" class="primary-button" type="button">패키지 실행</button>
        </div>
      </section>
      <section class="tool-section">
        <div class="section-head"><h3>실행 로그</h3></div>
        <textarea id="commandOutputField" class="command-output" readonly></textarea>
      </section>
    </div>
  `;
  const rows = [];
  if (errors.length === 0 && warnings.length === 0) rows.push(['ready', '통과', '저장과 검증을 진행할 수 있습니다.']);
  errors.forEach((message) => rows.push(['error', '오류', message]));
  warnings.forEach((message) => rows.push(['warning', '확인', message]));
  byId('outputValidation').replaceChildren(
    ...rows.map(([level, label, message]) => {
      const item = document.createElement('li');
      item.className = level;
      item.innerHTML = '<strong></strong><span></span>';
      item.querySelector('strong').textContent = label;
      item.querySelector('span').textContent = message;
      return item;
    }),
  );
  byId('yamlOutputField').value = toProjectYaml();
  byId('commandOutputField').value = state.commandOutput || state.status;
  byId('copyYamlBtn').addEventListener('click', () => copyText(toProjectYaml(), 'YAML을 복사했습니다.').catch(reportApiError));
  byId('downloadYamlBtn').addEventListener('click', downloadProjectYaml);
  byId('downloadManifestBtn').addEventListener('click', exportManifest);
  byId('saveLocalBtn').addEventListener('click', () => saveProjectLocal().catch(reportApiError));
  byId('validateLocalBtn').addEventListener('click', () => runLocalCommand('validate').catch(reportApiError));
  byId('renderLocalBtn').addEventListener('click', () => runLocalCommand('render').catch(reportApiError));
  byId('packageLocalBtn').addEventListener('click', () => runLocalCommand('package').catch(reportApiError));
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.append(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

function exportManifest() {
  syncDerived();
  downloadText(`${state.manifest.projectName || 'upload-plan'}-manifest.json`, JSON.stringify(state.manifest, null, 2), 'application/json;charset=utf-8');
}

function downloadProjectYaml() {
  downloadText(`${state.draft.projectName || 'project'}.yaml`, toProjectYaml(), 'text/yaml;charset=utf-8');
}

function readJsonFile(file, onLoad) {
  const reader = new FileReader();
  reader.addEventListener('load', () => {
    try {
      onLoad(JSON.parse(String(reader.result)));
      renderAll();
    } catch {
      window.alert('JSON 파일을 읽을 수 없습니다.');
    }
  });
  reader.readAsText(file);
}

async function apiPost(path, body) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok || data.ok === false) {
    // 서버가 실패 원인을 준 경우 그대로 보여준다 — report 안에 묻힌 error까지 확인.
    throw new Error(data.error || data.report?.error || `${path} 요청 실패`);
  }
  return data;
}

function commandText(data) {
  return [data.stdout, data.stderr].filter(Boolean).join('\n').trim();
}

async function saveProjectLocal() {
  state.status = '저장 중';
  refreshChrome();
  const data = await apiPost('/api/project/write', { yaml: toProjectYaml() });
  state.localProjectPath = data.projectDir;
  state.status = '저장 완료';
  state.commandOutput = `project.yaml 저장 완료\n${data.projectFile}`;
  renderAll();
  return data.projectDir;
}

async function runLocalCommand(command) {
  const projectPath = state.localProjectPath || (await saveProjectLocal());
  state.status = `${command} 실행 중`;
  state.commandOutput = `${command} 실행 중\n${projectPath}`;
  refreshChrome();
  const data = await apiPost(`/api/${command}`, { projectPath });
  state.status = data.ok ? `${command} 통과` : `${command} 실패`;
  state.commandOutput = commandText(data) || state.status;
  renderAll();
}

function reportApiError(error) {
  state.status = '실행 실패';
  // 네트워크 자체가 죽었을 때만 서버 실행 안내를 붙인다 — 서버가 준 실제 원인을 가리면 안 된다.
  const isNetworkError = error instanceof TypeError;
  state.commandOutput = isNetworkError
    ? `${error.message}\n\n로컬 서버(앱)와 통신하지 못했습니다 — 데스크톱 앱(또는 npm run app)이 실행 중인지 확인하세요.`
    : error.message;
  renderAll();
}

async function copyText(value, message) {
  await navigator.clipboard.writeText(value);
  state.status = message;
  refreshChrome();
}

/** 재생 헤드 위치 기준으로 선택 클립의 앞/뒤를 잘라낸다(타임라인 도구). */
function trimSelectedClipToPlayhead(edge) {
  const segment = selectedTimelineSegment();
  if (!segment) {
    state.status = '자를 클립이 없습니다. 먼저 파일을 추가하세요.';
    refreshChrome();
    return;
  }
  const cutAt = sourceTimeFromPlayhead(segment);
  const start = edge === 'start' ? Math.min(cutAt, segment.sourceEndSec - 0.1) : segment.sourceStartSec;
  const end = edge === 'end' ? Math.max(cutAt, segment.sourceStartSec + 0.1) : segment.sourceEndSec;
  pushHistory('clips');
  state.draft.clips = trimClipRange(state.draft.clips, state.edit.selectedClipIndex, start, end);
  state.useLoadedManifest = false;
  state.useLoadedRisk = false;
  state.status = edge === 'start' ? '재생 헤드 앞부분을 잘랐습니다.' : '재생 헤드 뒷부분을 잘랐습니다.';
  renderAll();
}

function splitPreviewClip() {
  const segment = selectedTimelineSegment();
  if (!segment) {
    state.status = '분할할 클립이 없습니다.';
    refreshChrome();
    return;
  }
  const next = splitClipAt(state.draft.clips, state.edit.selectedClipIndex, sourceTimeFromPlayhead(segment));
  if (next.length === state.draft.clips.length) {
    state.status = '너무 짧은 구간은 분할할 수 없습니다.';
    refreshChrome();
    return;
  }
  pushHistory('clips');
  state.draft.clips = next;
  state.edit.selectedClipIndex = Math.min(state.edit.selectedClipIndex + 1, next.length - 1);
  state.useLoadedManifest = false;
  state.useLoadedRisk = false;
  state.status = '미리보기 위치에서 클립을 분할했습니다.';
  renderAll();
}

function resetDraft() {
  draftHistory.past = [];
  draftHistory.future = [];
  lastHistoryTag = '';
  state.draft = structuredClone(defaultDraft);
  state.useLoadedManifest = false;
  state.useLoadedRisk = false;
  state.localProjectPath = '';
  state.status = '새 프로젝트';
  state.commandOutput = '';
  state.performanceCsv = '';
  state.imageScenes = [];
  state.imageRights = 'ai_generated';
  state.silence = {
    clipFile: '',
    noiseDb: '-35',
    minDurationSec: '0.6',
    paddingSec: '0.08',
    report: null,
  };
  state.captions = {
    clipFile: '',
    provider: 'local-whisper',
    language: 'ko',
    model: 'base',
    minChars: '8',
    maxChars: '28',
    report: null,
    tools: null,
  };
  state.edit = {
    selectedClipIndex: 0,
    playheadSec: 0,
    subtab: 'media',
    autoPlan: null,
  };
  state.tts = {
    provider: 'mock',
    voice: 'ko-female-bright',
    speed: '1',
    scriptSource: 'story',
    volume: '0.9',
  };
  renderAll();
}

// ── 미리보기 플레이어: 편집본(트림 적용 순차 재생) / 원본 재생 ──

function stopPreviewPlayback(render = true) {
  const media = document.getElementById('previewMedia');
  state.previewPlayer.playing = false;
  if (media) media.pause();
  if (render) renderPreview();
}

function startPreviewPlayback() {
  const media = document.getElementById('previewMedia');
  const segment = selectedTimelineSegment();
  const clip = selectedClip();
  if (!media || !clip?.file || !segment) {
    state.status = '재생할 클립이 없습니다. 먼저 파일을 추가하세요.';
    refreshChrome();
    return;
  }
  state.previewPlayer.playing = true;
  if (state.previewPlayer.mode === 'edited') {
    const current = sourceTimeFromPlayhead(segment);
    media.currentTime = Math.min(Math.max(current, segment.sourceStartSec), Math.max(segment.sourceStartSec, segment.sourceEndSec - 0.05));
  }
  media.muted = state.previewPlayer.mode === 'edited' && Boolean(clip.mute);
  media.play().catch(() => {});
  renderPreview();
}

function advancePreviewSegment() {
  const { segments } = buildTimelineSegments(state.draft.clips);
  const nextIndex = state.edit.selectedClipIndex + 1;
  if (nextIndex >= segments.length) {
    state.edit.selectedClipIndex = 0;
    state.edit.playheadSec = 0;
    stopPreviewPlayback(false);
    renderAll();
    return;
  }
  state.edit.selectedClipIndex = nextIndex;
  state.edit.playheadSec = segments[nextIndex].timelineStartSec;
  renderAll();
  const media = document.getElementById('previewMedia');
  if (media) {
    media.currentTime = segments[nextIndex].sourceStartSec;
    media.play().catch(() => {});
  }
}

function handlePreviewTimeUpdate() {
  const media = document.getElementById('previewMedia');
  if (!media || !state.previewPlayer.playing || state.previewPlayer.mode !== 'edited') return;
  const segment = selectedTimelineSegment();
  if (!segment) return;
  const offset = Math.max(0, media.currentTime - segment.sourceStartSec) / (segment.speed ?? 1);
  state.edit.playheadSec = segment.timelineStartSec + Math.min(offset, segment.durationSec);
  const playheadField = document.getElementById('previewPlayheadField');
  if (playheadField) playheadField.value = String(state.edit.playheadSec);
  const label = document.getElementById('previewPlayheadLabel');
  if (label) label.textContent = `재생 ${secLabel(state.edit.playheadSec)} · 원본 ${secLabel(media.currentTime)}`;
  positionTimelinePlayhead();
  if (media.currentTime >= segment.sourceEndSec - 0.04) advancePreviewSegment();
}

function togglePreviewMode() {
  state.previewPlayer.mode = state.previewPlayer.mode === 'edited' ? 'original' : 'edited';
  stopPreviewPlayback(false);
  const media = document.getElementById('previewMedia');
  const segment = selectedTimelineSegment();
  if (media && segment) media.currentTime = state.previewPlayer.mode === 'edited' ? segment.sourceStartSec : 0;
  renderPreview();
}

// ── 내보내기: 저장 → 렌더 → (GIF면 변환) ──

async function exportVideo(kind) {
  try {
    state.status = kind === 'gif' ? 'GIF 내보내는 중 (렌더 후 변환)' : 'MP4 내보내는 중 (저장 후 렌더)';
    refreshChrome();
    const projectPath = await saveProjectLocal();
    await runLocalCommand('render');
    if (kind === 'gif') {
      const data = await apiPost('/api/export/gif', { projectPath });
      state.status = 'GIF 내보내기 완료';
      state.commandOutput = `GIF 저장 위치:\n${data.gifFile}`;
    } else {
      state.status = 'MP4 내보내기 완료';
      state.commandOutput = `MP4 저장 위치:\n${projectPath}/output/video_01.mp4`;
    }
  } catch (error) {
    state.status = '내보내기 실패';
    state.commandOutput = `${error.message}\n\n클립 파일이 프로젝트에 있어야 렌더가 성공합니다.`;
  }
  renderAll();
}

// ── 하단 자동 편집 도구(무음컷/자막/음성/속도) ──

let voiceListRequested = false;

function ensureVoiceList() {
  if (voiceListRequested) return;
  voiceListRequested = true;
  const typecastKey = (getSettings().typecastApiKey || '').trim();
  Promise.all([
    fetch('/api/voices').then((response) => response.json()),
    typecastKey
      ? fetch('/api/typecast/voices', { headers: { 'x-typecast-key': typecastKey } })
          .then((response) => response.json())
          .catch(() => ({ voices: [] }))
      : Promise.resolve({ voices: [] }),
  ])
    .then(([data, typecastData]) => {
      state.voiceList = data.voices ?? [];
      state.typecastVoiceList = typecastData.ok ? (typecastData.voices ?? []) : [];
      renderAutomationDeck();
    })
    .catch(() => {
      state.voiceList = [];
      state.typecastVoiceList = [];
    });
}

async function playNarrateSample() {
  const voice = document.getElementById('autoVoiceField')?.value;
  if (!voice) throw new Error('먼저 원클릭 제작 → 내 목소리에서 목소리를 등록하세요.');
  state.status = '음성 생성 중 (30초~1분)';
  refreshChrome();
  const typecastKey = (getSettings().typecastApiKey || '').trim();
  const data = await apiPost('/api/voices/test', {
    voice,
    text: trimLine(ttsScriptPreview(), 200),
    ...(typecastKey ? { typecastApiKey: typecastKey } : {}),
  });
  const audio = document.getElementById('autoNarrateAudio');
  if (audio) {
    audio.src = `${data.audioUrl}&t=${Date.now()}`;
    audio.hidden = false;
    audio.play().catch(() => {});
  }
  state.status = '음성 미리듣기 준비 완료';
  refreshChrome();
}

function voiceOptionListForAutomation() {
  const voices = Array.isArray(state.voiceList) ? state.voiceList : [];
  const typecastVoices = Array.isArray(state.typecastVoiceList) ? state.typecastVoiceList : [];
  if (voices.length === 0 && typecastVoices.length === 0) return '<option value="">등록된 목소리 없음</option>';
  const mine = voices
    .map((voice) => `<option value="${escapeHtml(voice.name)}">${escapeHtml(voice.name)}</option>`)
    .join('');
  const typecast =
    typecastVoices.length === 0
      ? ''
      : `<optgroup label="🎭 타입캐스트 AI 성우">${typecastVoices
          .map((voice) => `<option value="typecast:${escapeHtml(voice.id)}">${escapeHtml(voice.name)}</option>`)
          .join('')}</optgroup>`;
  return mine + typecast;
}

/** 텍스트 컷 편집: 자막 문장 목록. 문장 클릭=이동, × 클릭=그 구간을 영상에서 잘라냄. */
function renderTextCutRows() {
  const container = document.getElementById('textCutRows');
  if (!container) return;
  const report = state.captions.report;
  const cues = report?.cues ?? [];
  const file = report?.clip?.file ?? '';
  if (!file || cues.length === 0) {
    container.innerHTML = '<p class="note">위 자동 자막에서 "선택 클립 자동자막"을 먼저 실행하면 문장 단위로 컷 편집할 수 있습니다.</p>';
    return;
  }
  container.replaceChildren(
    ...cues.map((cue, index) => {
      const row = document.createElement('div');
      row.className = 'textcut-row';
      row.innerHTML = `
        <button class="textcut-text" type="button" title="이 문장 위치로 이동">
          <em>${msToSecText(cue.startMs)}s</em><span>${escapeHtml(cue.text)}</span>
        </button>
        <button class="icon-button danger-button" type="button" title="이 문장 구간을 영상에서 잘라내기">×</button>
      `;
      row.querySelector('.textcut-text').addEventListener('click', () => {
        const sourceSec = cue.startMs / 1000;
        const { segments } = buildTimelineSegments(state.draft.clips);
        const segment = segments.find(
          (item) => item.file === file && sourceSec >= item.sourceStartSec && sourceSec < item.sourceEndSec,
        );
        if (!segment) {
          state.status = '이 문장 구간은 이미 잘려나갔습니다.';
          refreshChrome();
          return;
        }
        state.edit.selectedClipIndex = segment.index;
        state.edit.playheadSec = segment.timelineStartSec + (sourceSec - segment.sourceStartSec) / (segment.speed ?? 1);
        renderAll();
      });
      row.querySelector('.danger-button').addEventListener('click', () => {
        pushHistory('clips');
        state.draft.clips = cutSourceRangeFromClips(state.draft.clips, file, cue.startMs / 1000, cue.endMs / 1000);
        state.captions.report = { ...report, cues: deleteCueAt(cues, index) };
        state.edit.selectedClipIndex = Math.min(state.edit.selectedClipIndex, Math.max(0, state.draft.clips.length - 1));
        state.useLoadedManifest = false;
        state.useLoadedRisk = false;
        state.status = `"${trimLine(cue.text, 20)}" 문장 구간(${msToSecText(cue.endMs - cue.startMs)}초)을 잘라냈습니다.`;
        renderAll();
      });
      return row;
    }),
  );
}

function positionTimelinePlayhead() {
  const playhead = document.getElementById('timelinePlayhead');
  if (!playhead) return;
  const { totalDurationSec } = buildTimelineSegments(state.draft.clips);
  const ratio = totalDurationSec > 0 ? Math.min(1, state.edit.playheadSec / totalDurationSec) : 0;
  playhead.style.left = `${(ratio * 100).toFixed(2)}%`;
}

function timelineRulerTicks(totalDurationSec) {
  if (totalDurationSec <= 0) return '';
  const step = totalDurationSec <= 15 ? 2 : totalDurationSec <= 40 ? 5 : 10;
  const ticks = [];
  for (let t = 0; t <= totalDurationSec; t += step) {
    ticks.push(`<span style="left:${((t / totalDurationSec) * 100).toFixed(2)}%">${t}s</span>`);
  }
  return ticks.join('');
}

function timelineBlocksHtml(segments, totalDurationSec) {
  if (totalDurationSec <= 0 || segments.length === 0) {
    return { video: '<p class="note">파일을 추가하면 타임라인이 생깁니다.</p>', audio: '' };
  }
  const video = segments
    .map((segment) => {
      const clip = state.draft.clips[segment.index];
      const width = ((segment.durationSec / totalDurationSec) * 100).toFixed(3);
      const active = segment.index === state.edit.selectedClipIndex ? ' active' : '';
      return `
        <button class="timeline-block${active}" type="button" data-clip-index="${segment.index}" style="width:${width}%" title="${escapeHtml(clip?.file ?? '')}">
          <strong>${roleLabels[segment.role] ?? segment.role}</strong>
          <span>${segment.durationSec.toFixed(1)}s${segment.speed && segment.speed !== 1 ? ` · ${segment.speed}x` : ''}</span>
        </button>
      `;
    })
    .join('');
  const audio = segments
    .map((segment) => {
      const clip = state.draft.clips[segment.index];
      const width = ((segment.durationSec / totalDurationSec) * 100).toFixed(3);
      // 소리/무음이 물결(파형)로 보이게 구간별 파형 PNG를 배경으로 깐다.
      const wave =
        clip?.file && !clip?.mute
          ? `;background-image:url('${waveformUrl(clip.file, segment.sourceStartSec, segment.sourceEndSec)}')`
          : '';
      return `<div class="timeline-audio-block${clip?.mute ? ' muted' : ''}" style="width:${width}%${wave}">${clip?.mute ? '무음' : ''}</div>`;
    })
    .join('');
  return { video, audio };
}

/**
 * 무음 분석 결과(plan.remove)를 타임라인 좌표의 빗금 오버레이로 바꾼다.
 * 원본 소스 초 → 세그먼트 교집합 → 타임라인 초 변환(배속 반영).
 */
function silenceOverlayHtml(segments, totalDurationSec) {
  const report = state.silence.report;
  const remove = report?.plan?.remove ?? [];
  if (!report?.clip?.file || remove.length === 0 || totalDurationSec <= 0) return '';
  return segments
    .filter((segment) => state.draft.clips[segment.index]?.file === report.clip.file)
    .flatMap((segment) =>
      remove.map((range) => {
        const overlapStart = Math.max(Number(range.start), segment.sourceStartSec);
        const overlapEnd = Math.min(Number(range.end), segment.sourceEndSec);
        if (overlapEnd <= overlapStart) return '';
        const speed = segment.speed || 1;
        const timelineStart = segment.timelineStartSec + (overlapStart - segment.sourceStartSec) / speed;
        const timelineWidth = (overlapEnd - overlapStart) / speed;
        return `<div class="timeline-silence-cut" style="left:${((timelineStart / totalDurationSec) * 100).toFixed(2)}%;width:${((timelineWidth / totalDurationSec) * 100).toFixed(2)}%" title="무음 ${overlapStart.toFixed(1)}~${overlapEnd.toFixed(1)}s — 컷 적용 시 잘립니다"></div>`;
      }),
    )
    .join('');
}

let timelineScrubbing = false;

function scrubTimelineTo(event, lanes) {
  const rect = lanes.getBoundingClientRect();
  const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const { totalDurationSec, segments } = buildTimelineSegments(state.draft.clips);
  state.edit.playheadSec = ratio * totalDurationSec;
  selectClipForPlayhead(state.edit.playheadSec, segments);
  renderPreview();
  const media = document.getElementById('previewMedia');
  const segment = selectedTimelineSegment();
  if (media && segment && media.getAttribute('src')) media.currentTime = sourceTimeFromPlayhead(segment);
  positionTimelinePlayhead();
}

function renderAutomationDeck() {
  const container = document.getElementById('automationDeck');
  if (!container) return;
  if (state.voiceList === null) ensureVoiceList();
  const clip = selectedClip();
  const clipLabel = clip?.file ? clip.file.split('/').pop() : '클립 없음';
  const cueCount = state.captions.report?.cues?.length ?? 0;
  const currentSpeed = Number(clip?.speed ?? 1);
  const { totalDurationSec, segments } = buildTimelineSegments(state.draft.clips);
  const blocks = timelineBlocksHtml(segments, totalDurationSec);

  container.innerHTML = `
    <div class="timeline-strip">
      <div class="timeline-strip-head">
        <span>타임라인</span>
        <div class="timeline-toolbar">
          <button id="tlUndoBtn" type="button" title="되돌리기 (Ctrl+Z)" ${draftHistory.past.length === 0 ? 'disabled' : ''}>↶ 되돌리기</button>
          <button id="tlRedoBtn" type="button" title="다시하기 (Ctrl+Y)" ${draftHistory.future.length === 0 ? 'disabled' : ''}>↷</button>
          <button id="tlAddBtn" type="button" title="영상 파일 추가">➕ 추가</button>
          <button id="tlSplitBtn" type="button" title="재생 헤드 위치에서 둘로 나누기">✂ 분할</button>
          <button id="tlTrimStartBtn" type="button" title="재생 헤드 앞부분 잘라내기">⇤ 앞 자르기</button>
          <button id="tlTrimEndBtn" type="button" title="재생 헤드 뒷부분 잘라내기">⇥ 뒤 자르기</button>
          <button id="tlMuteBtn" type="button" title="선택 클립 음성 켜기/끄기">${clip?.mute ? '🔇 무음' : '🔊 소리'}</button>
          <button id="tlMoveLeftBtn" type="button" title="선택 클립을 앞으로">◀</button>
          <button id="tlMoveRightBtn" type="button" title="선택 클립을 뒤로">▶</button>
          <button id="tlDeleteBtn" type="button" title="선택 클립 삭제">🗑</button>
        </div>
        <strong>${totalDurationSec.toFixed(1)}초 · <span id="timelineZoomLabel">${Math.round(state.timelineZoom * 100)}%</span></strong>
      </div>
      <div class="timeline-scroll" id="timelineScroll">
        <div class="timeline-lanes" id="timelineLanes" style="width:${(state.timelineZoom * 100).toFixed(0)}%">
          <div class="timeline-ruler">${timelineRulerTicks(totalDurationSec)}</div>
          <div class="timeline-lane video">${blocks.video}</div>
          <div class="timeline-lane audio">${blocks.audio}</div>
          ${
            clean(state.draft.bgm.file)
              ? `<div class="timeline-lane bgm"><div class="timeline-bgm-block">♫ BGM · ${escapeHtml(state.draft.bgm.file.split('/').pop())} · ${bgmVolumeLabels[state.draft.style.bgmVolume] ?? '기본'}</div></div>`
              : ''
          }
          ${silenceOverlayHtml(segments, totalDurationSec)}
          <div class="timeline-playhead" id="timelinePlayhead"></div>
        </div>
      </div>
    </div>
  `;
  container.insertAdjacentHTML('beforeend', `
    <div class="automation-grid">
      <details class="automation-card" data-card="silence"${state.automationOpen.silence ? ' open' : ''}>
        <summary><h3>무음 자동컷</h3><span class="soft-badge">${escapeHtml(clipLabel)}</span></summary>
        <div class="button-row compact">
          <button id="autoAutocutBtn" class="primary-button" type="button">원클릭 무음컷</button>
          <button id="autoAnalyzeBtn" class="ghost-button" type="button">무음 분석</button>
          <button id="autoApplyBtn" class="ghost-button" type="button">컷 적용</button>
        </div>
        <div class="field-grid three">
          <label>무음 기준<select id="autoSilenceNoiseField">${optionList(silenceNoiseIds, silenceNoiseLabels, state.silence.noiseDb)}</select></label>
          <label>최소 무음<select id="autoSilenceMinField">${optionList(silenceMinIds, silenceMinLabels, state.silence.minDurationSec)}</select></label>
          <label>말 앞뒤 여백<select id="autoSilencePaddingField">${optionList(silencePaddingIds, silencePaddingLabels, state.silence.paddingSec)}</select></label>
        </div>
        <div id="autoSilenceList" class="preview-silence-list"></div>
      </details>

      <details class="automation-card" data-card="captions"${state.automationOpen.captions ? ' open' : ''}>
        <summary><h3>자동 자막</h3><span class="soft-badge">${cueCount > 0 ? `${cueCount}줄` : '대기'}</span></summary>
        <label>엔진<select id="autoCaptionProviderField">${optionList(captionProviderIds, captionProviderLabels, state.captions.provider)}</select></label>
        <div class="button-row compact">
          <button id="autoCaptionBtn" class="primary-button" type="button">선택 클립 자동자막</button>
          <button id="autoScriptCaptionBtn" class="ghost-button" type="button">대본으로 자막</button>
        </div>
        <p class="note">자막 문구 수정은 고급 도구 → 자막에서 할 수 있습니다.</p>
      </details>

      <details class="automation-card" data-card="textedit"${state.automationOpen.textedit ? ' open' : ''}>
        <summary><h3>텍스트 컷 편집</h3><span class="soft-badge">${cueCount > 0 ? `${cueCount}문장` : '자막 필요'}</span></summary>
        <p class="note">문장의 ×를 누르면 영상에서 그 구간이 잘립니다. 문장을 클릭하면 그 위치로 이동합니다.</p>
        <div id="textCutRows" class="textcut-list"></div>
      </details>

      <details class="automation-card" data-card="voice"${state.automationOpen.voice ? ' open' : ''}>
        <summary><h3>자동 음성</h3><span class="soft-badge">${Array.isArray(state.voiceList) ? `${state.voiceList.length}개 목소리` : '불러오는 중'}</span></summary>
        <label>목소리<select id="autoVoiceField">${voiceOptionListForAutomation()}</select></label>
        <div class="button-row compact">
          <button id="autoNarrateTestBtn" class="primary-button" type="button">대본 음성 미리듣기</button>
        </div>
        <audio id="autoNarrateAudio" controls hidden></audio>
      </details>

      <details class="automation-card" data-card="speed"${state.automationOpen.speed ? ' open' : ''}>
        <summary><h3>속도 조절</h3><span class="soft-badge">${clip ? `${currentSpeed}x` : '클립 없음'}</span></summary>
        <div class="button-row compact">
          ${[0.5, 0.75, 1, 1.25, 1.5, 2]
            .map(
              (speed) =>
                `<button class="${speed === currentSpeed ? 'primary-button' : 'ghost-button'}" type="button" data-auto-speed="${speed}">${speed}x</button>`,
            )
            .join('')}
        </div>
        <p class="note">선택한 클립에만 적용됩니다.</p>
      </details>
    </div>
  `);

  container.querySelectorAll('.automation-card').forEach((card) => {
    card.addEventListener('toggle', () => {
      state.automationOpen[card.dataset.card] = card.open;
    });
  });

  byId('autoAutocutBtn').addEventListener('click', () => autocutOneClick(selectedClip()?.file).catch(reportApiError));
  byId('autoAnalyzeBtn').addEventListener('click', () => {
    const target = selectedClip();
    if (target?.file) state.silence.clipFile = target.file;
    analyzeSilenceLocal().catch(reportApiError);
  });
  byId('autoApplyBtn').addEventListener('click', () => {
    applySilencePlanToTimeline();
    renderAll();
  });
  bindField('autoSilenceNoiseField', state.silence.noiseDb, (value) => {
    state.silence.noiseDb = value;
  });
  bindField('autoSilenceMinField', state.silence.minDurationSec, (value) => {
    state.silence.minDurationSec = value;
  });
  bindField('autoSilencePaddingField', state.silence.paddingSec, (value) => {
    state.silence.paddingSec = value;
  });
  bindField('autoCaptionProviderField', state.captions.provider, (value) => {
    state.captions.provider = value;
  });
  byId('autoCaptionBtn').addEventListener('click', () => {
    const target = selectedClip();
    if (target?.file) state.captions.clipFile = target.file;
    generateCaptionsLocal().catch(reportApiError);
  });
  byId('autoScriptCaptionBtn').addEventListener('click', () => {
    try {
      generateScriptCaptionsLocal();
    } catch (error) {
      reportApiError(error);
    }
  });
  byId('autoNarrateTestBtn').addEventListener('click', () => playNarrateSample().catch(reportApiError));
  container.querySelectorAll('[data-auto-speed]').forEach((button) => {
    button.addEventListener('click', () => {
      const speed = numberValue(button.dataset.autoSpeed) || 1;
      setDraftClips(setClipSpeed(state.draft.clips, state.edit.selectedClipIndex, speed), `선택 장면 속도를 ${speed}x로 설정했습니다.`);
      renderAll();
    });
  });
  renderAutoSilenceList(clip);
  renderTextCutRows();

  byId('tlUndoBtn').addEventListener('click', undoDraft);
  byId('tlRedoBtn').addEventListener('click', redoDraft);
  byId('tlAddBtn').addEventListener('click', () => importMedia('video').catch(reportApiError));
  byId('tlSplitBtn').addEventListener('click', splitPreviewClip);
  byId('tlTrimStartBtn').addEventListener('click', () => trimSelectedClipToPlayhead('start'));
  byId('tlTrimEndBtn').addEventListener('click', () => trimSelectedClipToPlayhead('end'));
  byId('tlMuteBtn').addEventListener('click', () => {
    const target = selectedClip();
    if (!target) {
      state.status = '음소거할 클립이 없습니다.';
      refreshChrome();
      return;
    }
    pushHistory('clips');
    target.mute = !target.mute;
    state.useLoadedManifest = false;
    state.status = target.mute ? '클립 음성을 없앴습니다.' : '클립 음성을 다시 켰습니다.';
    renderAll();
  });
  byId('tlMoveLeftBtn').addEventListener('click', () => moveClip(state.edit.selectedClipIndex, -1));
  byId('tlMoveRightBtn').addEventListener('click', () => moveClip(state.edit.selectedClipIndex, 1));
  byId('tlDeleteBtn').addEventListener('click', () => {
    if (!selectedClip()) {
      state.status = '삭제할 클립이 없습니다.';
      refreshChrome();
      return;
    }
    pushHistory('clips');
    state.draft.clips.splice(state.edit.selectedClipIndex, 1);
    state.edit.selectedClipIndex = Math.min(state.edit.selectedClipIndex, Math.max(0, state.draft.clips.length - 1));
    state.useLoadedManifest = false;
    state.status = '클립을 삭제했습니다.';
    renderAll();
  });

  container.querySelectorAll('.timeline-block').forEach((block) => {
    block.addEventListener('click', () => {
      const index = Number(block.dataset.clipIndex);
      const { segments: currentSegments } = buildTimelineSegments(state.draft.clips);
      state.edit.selectedClipIndex = index;
      state.edit.playheadSec = currentSegments[index]?.timelineStartSec ?? 0;
      renderAll();
    });
  });
  const lanes = document.getElementById('timelineLanes');
  if (lanes) {
    lanes.addEventListener('pointerdown', (event) => {
      if (event.target.closest('.timeline-block')) return;
      timelineScrubbing = true;
      lanes.setPointerCapture(event.pointerId);
      scrubTimelineTo(event, lanes);
    });
    lanes.addEventListener('pointermove', (event) => {
      if (timelineScrubbing) scrubTimelineTo(event, lanes);
    });
    lanes.addEventListener('pointerup', () => {
      if (!timelineScrubbing) return;
      timelineScrubbing = false;
      renderAll();
    });
  }
  const scroll = document.getElementById('timelineScroll');
  if (scroll) {
    scroll.addEventListener(
      'wheel',
      (event) => {
        if (!event.ctrlKey) return;
        event.preventDefault();
        const lanesEl = document.getElementById('timelineLanes');
        if (!lanesEl) return;
        const rect = scroll.getBoundingClientRect();
        const pointerRatio = lanesEl.offsetWidth > 0 ? (scroll.scrollLeft + event.clientX - rect.left) / lanesEl.offsetWidth : 0;
        const factor = event.deltaY < 0 ? 1.2 : 1 / 1.2;
        state.timelineZoom = Math.min(8, Math.max(1, state.timelineZoom * factor));
        lanesEl.style.width = `${(state.timelineZoom * 100).toFixed(0)}%`;
        scroll.scrollLeft = pointerRatio * lanesEl.offsetWidth - (event.clientX - rect.left);
        const zoomLabel = document.getElementById('timelineZoomLabel');
        if (zoomLabel) zoomLabel.textContent = `${Math.round(state.timelineZoom * 100)}%`;
      },
      { passive: false },
    );
  }
  positionTimelinePlayhead();
}

function bindStaticEvents() {
  byId('newProjectBtn').addEventListener('click', resetDraft);
  byId('workbenchToggleBtn').addEventListener('click', () => {
    state.workbenchCollapsed = !state.workbenchCollapsed;
    renderAll();
  });
  const resizeHandle = byId('timelineResizeHandle');
  const timelineDeck = byId('timelineDeck');
  let deckDrag = null;
  resizeHandle.addEventListener('pointerdown', (event) => {
    deckDrag = { startY: event.clientY, startHeight: timelineDeck.getBoundingClientRect().height };
    resizeHandle.setPointerCapture(event.pointerId);
  });
  resizeHandle.addEventListener('pointermove', (event) => {
    if (!deckDrag) return;
    const next = Math.min(window.innerHeight * 0.72, Math.max(150, deckDrag.startHeight + (deckDrag.startY - event.clientY)));
    timelineDeck.style.height = `${Math.round(next)}px`;
  });
  resizeHandle.addEventListener('pointerup', () => {
    deckDrag = null;
  });
  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    // 입력창 안에서는 브라우저 기본 텍스트 되돌리기를 그대로 쓴다.
    if (event.target.closest?.('input, textarea, select, [contenteditable]')) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      undoDraft();
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      redoDraft();
    }
  });
  byId('previewPlayheadField').addEventListener('input', (event) => {
    const { segments } = buildTimelineSegments(state.draft.clips);
    state.edit.playheadSec = numberValue(event.target.value);
    selectClipForPlayhead(state.edit.playheadSec, segments);
    renderPreview();
  });
  byId('previewRatioField').addEventListener('change', (event) =>
    changeDraft((draft) => {
      draft.style.ratio = event.target.value;
      // 비율에 맞는 표준 해상도를 함께 맞춰준다.
      draft.style.resolution =
        event.target.value === '16:9' ? '1920x1080' : event.target.value === '1:1' ? '1080x1080' : '1080x1920';
    }),
  );
  byId('previewBgmBtn').addEventListener('click', () => {
    if (window.shortsFactoryDesktop?.selectAndImportMedia) {
      importMedia('audio').catch(reportApiError);
      return;
    }
    byId('quickAudioFileInput').click();
  });
  byId('quickAudioFileInput').addEventListener('change', (event) => {
    uploadBrowserFiles('audio', event.target.files)
      .then(() => {
        event.target.value = '';
      })
      .catch(reportApiError);
  });
  byId('previewBgmVolumeField').addEventListener('change', (event) =>
    changeDraft((draft) => {
      draft.style.bgmVolume = event.target.value;
    }),
  );
  byId('previewPlayBtn').addEventListener('click', () => {
    if (state.previewPlayer.playing) stopPreviewPlayback();
    else startPreviewPlayback();
  });
  byId('previewModeBtn').addEventListener('click', togglePreviewMode);
  byId('previewMedia').addEventListener('timeupdate', handlePreviewTimeUpdate);
  byId('previewMedia').addEventListener('ended', () => stopPreviewPlayback());
  byId('exportMp4Btn').addEventListener('click', () => exportVideo('mp4'));
  byId('exportGifBtn').addEventListener('click', () => exportVideo('gif'));
  byId('manifestInput').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    readJsonFile(file, (data) => {
      state.manifest = data;
      state.useLoadedManifest = true;
      state.selectedPlatform = data.platforms?.[0] ?? 'youtube_shorts';
      state.selectedVideo = data.items?.[0]?.videoFile ?? '';
      state.status = '업로드안을 불러왔습니다.';
      state.selectedTab = 'platform';
    });
  });
  byId('riskInput').addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    readJsonFile(file, (data) => {
      state.risk = data;
      state.useLoadedRisk = true;
      state.status = '저작권표를 불러왔습니다.';
      state.selectedTab = 'sources';
    });
  });
}

function renderAll() {
  syncDerived();
  normalizeSelectedTab();
  // 수동편집만 4분할(미리보기/타임라인/실행 패널), 나머지는 세로 1열
  document.body.dataset.mode = state.selectedTab === 'manual' ? 'manual' : 'simple';
  document.body.dataset.workbench = state.workbenchCollapsed ? 'collapsed' : 'open';
  renderMainTabs();
  renderPreview();
  renderTabContent();
  renderAutomationDeck();
  renderActionPanel();
}

bindStaticEvents();
renderAll();
mountAssistant({ trigger: byId('assistantBtn') });
