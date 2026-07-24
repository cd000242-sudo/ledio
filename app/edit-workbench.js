/* global window */

const MIN_CLIP_DURATION_SEC = 0.15;
export const EDIT_SUBTAB_IDS = ['media', 'frame', 'timeline', 'audio', 'captions', 'storyboard'];

const DEFAULT_TTS_SETTINGS = {
  provider: 'mock',
  voice: 'ko-female-bright',
  speed: '1',
  scriptSource: 'story',
  volume: '0.9',
};

function toNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundSec(value) {
  return Math.round(Math.max(0, value) * 100) / 100;
}

function secText(value) {
  return String(roundSec(value)).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
}

function speedValue(clip) {
  const parsed = toNumber(clip.speed, 1);
  return Math.min(4, Math.max(0.25, parsed || 1));
}

function cloneClip(clip) {
  return { ...clip };
}

function cloneCue(cue) {
  return {
    startMs: Math.max(0, Math.round(toNumber(cue.startMs, 0))),
    endMs: Math.max(0, Math.round(toNumber(cue.endMs, 0))),
    text: String(cue.text ?? '').trim(),
  };
}

function scriptCharLength(text) {
  return [...String(text ?? '')].length;
}

function splitLongCaptionText(text, maxChars) {
  const cleanText = String(text ?? '').replace(/\s+/gu, ' ').trim();
  if (!cleanText) return [];
  if (scriptCharLength(cleanText) <= maxChars) return [cleanText];

  const words = cleanText.split(/\s+/u).filter(Boolean);
  if (words.length <= 1) {
    const chars = [...cleanText];
    const chunks = [];
    for (let index = 0; index < chars.length; index += maxChars) {
      chunks.push(chars.slice(index, index + maxChars).join('').trim());
    }
    return chunks.filter(Boolean);
  }

  const chunks = [];
  let current = '';
  words.forEach((word) => {
    const candidate = current ? `${current} ${word}` : word;
    if (current && scriptCharLength(candidate) > maxChars) {
      chunks.push(current);
      current = word;
    } else {
      current = candidate;
    }
  });
  if (current) chunks.push(current);
  return chunks.flatMap((chunk) => splitLongCaptionText(chunk, maxChars)).filter(Boolean);
}

function splitScriptIntoCaptionLines(script, maxChars) {
  const source = String(script ?? '').replace(/\r\n?/gu, '\n').trim();
  if (!source) return [];
  const lines = [];
  let buffer = '';
  const flush = () => {
    const text = buffer.replace(/\s+/gu, ' ').trim();
    buffer = '';
    if (text) lines.push(...splitLongCaptionText(text, maxChars));
  };

  [...source].forEach((char) => {
    if (char === '\n') {
      flush();
      return;
    }
    buffer += char;
    if (/[.!?。！？]/u.test(char)) flush();
  });
  flush();
  return lines;
}

function keywordHits(text, keywords) {
  const haystack = String(text ?? '').toLocaleLowerCase();
  return keywords.filter((keyword) => haystack.includes(keyword.toLocaleLowerCase())).length;
}

export function normalizeSelectValue(value, values, fallback = '') {
  const ids = values.map((item) => String(item)).filter(Boolean);
  const current = String(value ?? '');
  const defaultValue = String(fallback ?? '');
  if (ids.includes(current)) return current;
  if (ids.includes(defaultValue)) return defaultValue;
  return ids[0] ?? defaultValue;
}

export function normalizeEditSubtab(value) {
  return normalizeSelectValue(value, EDIT_SUBTAB_IDS, 'media');
}

export function normalizeTtsSettings(settings = {}) {
  return {
    provider: normalizeSelectValue(settings.provider, ['mock', 'openai', 'elevenlabs', 'system'], DEFAULT_TTS_SETTINGS.provider),
    voice: normalizeSelectValue(
      settings.voice,
      ['ko-female-bright', 'ko-male-calm', 'ko-story-warm', 'ko-news-clear'],
      DEFAULT_TTS_SETTINGS.voice,
    ),
    speed: normalizeSelectValue(settings.speed, ['0.85', '1', '1.1', '1.25'], DEFAULT_TTS_SETTINGS.speed),
    scriptSource: normalizeSelectValue(settings.scriptSource, ['story', 'captions', 'hook'], DEFAULT_TTS_SETTINGS.scriptSource),
    volume: normalizeSelectValue(settings.volume, ['0.7', '0.8', '0.9', '1'], DEFAULT_TTS_SETTINGS.volume),
  };
}

export function clipDurationSec(clip) {
  return Math.max(0, (toNumber(clip.end, 0) - toNumber(clip.start, 0)) / speedValue(clip));
}

export function buildTimelineSegments(clips) {
  const normalized = clips.map(cloneClip);
  const totalDurationSec = normalized.reduce((sum, clip) => sum + clipDurationSec(clip), 0);
  let cursor = 0;
  const safeTotal = Math.max(totalDurationSec, 0.0001);
  const segments = normalized.map((clip, index) => {
    const durationSec = clipDurationSec(clip);
    const sourceDurationSec = Math.max(0, toNumber(clip.end, 0) - toNumber(clip.start, 0));
    const speed = speedValue(clip);
    const timelineStartSec = cursor;
    const timelineEndSec = cursor + durationSec;
    cursor = timelineEndSec;
    return {
      index,
      file: String(clip.file ?? ''),
      role: String(clip.role ?? ''),
      sourceStartSec: toNumber(clip.start, 0),
      sourceEndSec: toNumber(clip.end, 0),
      sourceDurationSec,
      durationSec,
      speed,
      timelineStartSec: roundSec(timelineStartSec),
      timelineEndSec: roundSec(timelineEndSec),
      leftPct: (timelineStartSec / safeTotal) * 100,
      widthPct: Math.max(0, (durationSec / safeTotal) * 100),
    };
  });
  return { totalDurationSec: roundSec(totalDurationSec), segments };
}

export function setClipSpeed(clips, index, speed) {
  if (index < 0 || index >= clips.length) return clips.map(cloneClip);
  const next = clips.map(cloneClip);
  next[index] = { ...next[index], speed: secText(speedValue({ speed })) };
  return next;
}

export function moveItem(items, index, direction) {
  const target = index + direction;
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) {
    return items.map((item) => ({ ...item }));
  }
  const next = items.map((item) => ({ ...item }));
  const [item] = next.splice(index, 1);
  if (item) next.splice(target, 0, item);
  return next;
}

export function splitClipAt(clips, index, sourceTimeSec) {
  if (index < 0 || index >= clips.length) return clips.map(cloneClip);
  const clip = cloneClip(clips[index]);
  const start = toNumber(clip.start, 0);
  const end = toNumber(clip.end, start);
  const splitAt = roundSec(sourceTimeSec);
  if (splitAt - start < MIN_CLIP_DURATION_SEC || end - splitAt < MIN_CLIP_DURATION_SEC) {
    return clips.map(cloneClip);
  }
  const left = { ...clip, end: secText(splitAt) };
  const right = { ...clip, start: secText(splitAt) };
  return [...clips.slice(0, index).map(cloneClip), left, right, ...clips.slice(index + 1).map(cloneClip)];
}

export function trimClipRange(clips, index, startSec, endSec) {
  if (index < 0 || index >= clips.length) return clips.map(cloneClip);
  const next = clips.map(cloneClip);
  const start = roundSec(startSec);
  const rawEnd = roundSec(endSec);
  const end = Math.max(rawEnd, roundSec(start + MIN_CLIP_DURATION_SEC));
  next[index] = { ...next[index], start: secText(start), end: secText(end) };
  return next;
}

/**
 * 텍스트 기반 컷 편집: 같은 파일을 쓰는 모든 클립 조각에서 원본 [cutStartSec, cutEndSec] 구간을 잘라낸다.
 * 구간이 조각 중간이면 앞/뒤 두 조각으로 나뉘고, 남는 조각이 minPieceSec보다 짧으면 버린다.
 */
export function cutSourceRangeFromClips(clips, file, cutStartSec, cutEndSec, minPieceSec = 0.15) {
  const next = [];
  for (const clip of clips) {
    if (clip.file !== file) {
      next.push(cloneClip(clip));
      continue;
    }
    const start = toNumber(clip.start, 0);
    const end = toNumber(clip.end, 0);
    const overlapStart = Math.max(start, roundSec(cutStartSec));
    const overlapEnd = Math.min(end, roundSec(cutEndSec));
    if (overlapEnd <= overlapStart) {
      next.push(cloneClip(clip));
      continue;
    }
    if (overlapStart - start >= minPieceSec) {
      next.push({ ...cloneClip(clip), start: secText(start), end: secText(overlapStart) });
    }
    if (end - overlapEnd >= minPieceSec) {
      next.push({ ...cloneClip(clip), start: secText(overlapEnd), end: secText(end) });
    }
  }
  return next;
}

export function dragTrimClipRange(clips, index, range) {
  if (index < 0 || index >= clips.length) return clips.map(cloneClip);
  const clip = clips[index];
  const currentStart = toNumber(clip.start, 0);
  const currentEnd = toNumber(clip.end, currentStart + MIN_CLIP_DURATION_SEC);
  const rawStart = range.startSec === undefined ? currentStart : roundSec(range.startSec);
  const rawEnd = range.endSec === undefined ? currentEnd : roundSec(range.endSec);
  const end = Math.max(currentStart + MIN_CLIP_DURATION_SEC, Math.min(rawEnd, currentEnd));
  const start = Math.min(Math.max(0, rawStart), roundSec(end - MIN_CLIP_DURATION_SEC));
  return trimClipRange(clips, index, start, end);
}

export function applyEditPreset(clips, preset) {
  if (preset === 'viral_fast_hook') {
    return clips.map((clip, index) => {
      const next = cloneClip(clip);
      if (index === 0) {
        const start = toNumber(next.start, 0);
        const end = toNumber(next.end, start + MIN_CLIP_DURATION_SEC);
        next.start = secText(Math.min(end - MIN_CLIP_DURATION_SEC, start + 0.2));
        next.speed = '1.25';
        next.editNote = '초반 훅 압축';
      }
      return next;
    });
  }
  if (preset === 'breath_room') {
    return clips.map((clip) => ({ ...cloneClip(clip), speed: '0.9', editNote: '숨 쉴 여백' }));
  }
  if (preset === 'detail_focus') {
    return clips.map((clip, index) => ({
      ...cloneClip(clip),
      focusMode: index === 0 ? 'detail_zoom' : 'keep',
      editNote: index === 0 ? '디테일 줌 후보' : '유지',
    }));
  }
  return clips.map(cloneClip);
}

export function updateCueAt(cues, index, patch) {
  return cues.map((cue, cueIndex) => {
    if (cueIndex !== index) return cloneCue(cue);
    const next = cloneCue({ ...cue, ...patch });
    if (next.endMs <= next.startMs) next.endMs = next.startMs + 250;
    return next;
  });
}

export function mergeCueWithNext(cues, index) {
  if (index < 0 || index >= cues.length - 1) return cues.map(cloneCue);
  const current = cloneCue(cues[index]);
  const nextCue = cloneCue(cues[index + 1]);
  const merged = {
    startMs: current.startMs,
    endMs: Math.max(current.endMs, nextCue.endMs),
    text: [current.text, nextCue.text].filter(Boolean).join(' ').trim(),
  };
  return [...cues.slice(0, index).map(cloneCue), merged, ...cues.slice(index + 2).map(cloneCue)];
}

export function deleteCueAt(cues, index) {
  return cues.filter((_, cueIndex) => cueIndex !== index).map(cloneCue);
}

export function scriptToCaptionCues(script, options = {}) {
  const maxChars = Math.max(8, Math.round(toNumber(options.maxChars, 28)));
  const minCueMs = Math.max(500, Math.round(toNumber(options.minCueMs, 900)));
  const lines = splitScriptIntoCaptionLines(script, maxChars);
  if (lines.length === 0) return [];

  const requestedMs = Math.max(0, Math.round(toNumber(options.durationSec, 0) * 1000));
  const averageCueMs = Math.max(minCueMs, Math.round(toNumber(options.averageCueMs, 1800)));
  const totalMs = Math.max(requestedMs || lines.length * averageCueMs, lines.length * minCueMs);
  const weights = lines.map((line) => Math.max(1, scriptCharLength(line)));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let elapsedWeight = 0;
  let cursor = 0;

  return lines.map((line, index) => {
    elapsedWeight += weights[index];
    const remainingMinMs = (lines.length - index - 1) * minCueMs;
    const weightedEndMs = Math.round((elapsedWeight / totalWeight) * totalMs);
    const endMs =
      index === lines.length - 1
        ? totalMs
        : Math.min(totalMs - remainingMinMs, Math.max(cursor + minCueMs, weightedEndMs));
    const cue = {
      startMs: cursor,
      endMs,
      text: line,
    };
    cursor = endMs;
    return cue;
  });
}

export function analyzeScriptForAutoEdit(script, clips, options = {}) {
  const normalizedClips = Array.isArray(clips) ? clips.map(cloneClip) : [];
  const timeline = buildTimelineSegments(normalizedClips);
  const fallbackDurationSec = Math.max(3, splitScriptIntoCaptionLines(script, 36).length * 1.8);
  const totalDurationSec = timeline.totalDurationSec || toNumber(options.durationSec, fallbackDurationSec) || fallbackDurationSec;
  const maxChars = Math.max(8, Math.round(toNumber(options.maxChars, 28)));
  const cues = scriptToCaptionCues(script, { durationSec: totalDurationSec, maxChars });
  const actions = [];
  const hookScore = keywordHits(script, [
    '충격',
    '반전',
    '처음',
    '갑자기',
    '알고보니',
    '비밀',
    '문제',
    'shock',
    'reveal',
    'secret',
  ]);
  const sellingScore = keywordHits(script, [
    '가격',
    '할인',
    '구매',
    '링크',
    '후기',
    '비교',
    '추천',
    'price',
    'discount',
    'proof',
    'link',
  ]);
  const turnScore = keywordHits(script, ['그런데', '하지만', '결국', '알고 보니', '반대로', 'however', 'but']);

  if (normalizedClips.length > 0 && (hookScore > 0 || cues.length > 1)) {
    actions.push({
      kind: 'trim',
      index: 0,
      startOffsetSec: 0.15,
      endOffsetSec: 0,
      reason: '대본 초반 훅을 바로 시작하도록 앞부분을 압축',
    });
    actions.push({
      kind: 'speed',
      index: 0,
      speed: hookScore > 1 ? 1.35 : 1.25,
      reason: '첫 문장의 체감 속도를 높여 이탈을 줄임',
    });
  }

  if (normalizedClips.length > 2 && cues.length > normalizedClips.length) {
    normalizedClips.slice(1, -1).forEach((_, offset) => {
      actions.push({
        kind: 'speed',
        index: offset + 1,
        speed: 1.15,
        reason: '대본 밀도가 높아 중간 장면을 가볍게 압축',
      });
    });
  }

  if (normalizedClips.length > 0 && (sellingScore > 0 || turnScore > 0)) {
    const preferredIndex = normalizedClips.findIndex((clip) => ['product', 'use', 'result', 'cta'].includes(clip.role));
    const index = preferredIndex >= 0 ? preferredIndex : Math.min(normalizedClips.length - 1, Math.max(0, Math.floor(normalizedClips.length / 2)));
    actions.push({
      kind: 'focus',
      index,
      focusMode: sellingScore > 0 ? 'detail_zoom' : 'story_turn',
      note: sellingScore > 0 ? '대본 자동분석: 상품/증거 강조' : '대본 자동분석: 반전 지점 강조',
      reason: sellingScore > 0 ? '구매/증거 키워드가 있어 상품 디테일을 강조' : '이야기 전환 키워드가 있어 장면 전환을 강조',
    });
  }

  return {
    captionCueCount: cues.length,
    cues,
    actions,
    summary: {
      actionCount: actions.length,
      cueCount: cues.length,
      intent: sellingScore > 0 ? 'conversion' : turnScore > 0 ? 'story' : 'general',
      totalDurationSec,
    },
  };
}

export function applyAutoEditPlan(clips, plan = {}) {
  let next = Array.isArray(clips) ? clips.map(cloneClip) : [];
  (plan.actions ?? []).forEach((action) => {
    const index = Number(action.index);
    if (!Number.isInteger(index) || index < 0 || index >= next.length) return;
    if (action.kind === 'trim') {
      const clip = next[index];
      const start = toNumber(clip.start, 0);
      const end = toNumber(clip.end, start + MIN_CLIP_DURATION_SEC);
      next = dragTrimClipRange(next, index, {
        startSec: action.startSec === undefined ? start + toNumber(action.startOffsetSec, 0) : toNumber(action.startSec, start),
        endSec: action.endSec === undefined ? end - toNumber(action.endOffsetSec, 0) : toNumber(action.endSec, end),
      });
    }
    if (action.kind === 'speed') {
      next = setClipSpeed(next, index, toNumber(action.speed, 1));
    }
    if (action.kind === 'focus') {
      next[index] = {
        ...next[index],
        focusMode: action.focusMode ?? 'detail_zoom',
        editNote: action.note ?? action.reason ?? '대본 자동분석 강조',
      };
    }
  });
  return next;
}

export function msToSecText(ms) {
  return (Math.max(0, toNumber(ms, 0)) / 1000).toFixed(2).replace(/\.00$/, '');
}

export function secToMs(sec) {
  return Math.max(0, Math.round(toNumber(sec, 0) * 1000));
}

if (typeof window !== 'undefined') {
  window.EditWorkbench = {
    applyEditPreset,
    analyzeScriptForAutoEdit,
    applyAutoEditPlan,
    buildTimelineSegments,
    clipDurationSec,
    deleteCueAt,
    dragTrimClipRange,
    EDIT_SUBTAB_IDS,
    mergeCueWithNext,
    moveItem,
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
  };
}
