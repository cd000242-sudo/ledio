import { describe, expect, it } from 'vitest'
import {
  applyEditPreset,
  cutSourceRangeFromClips,
  analyzeScriptForAutoEdit,
  applyAutoEditPlan,
  buildTimelineSegments,
  deleteCueAt,
  dragTrimClipRange,
  normalizeEditSubtab,
  normalizeSelectValue,
  normalizeTtsSettings,
  mergeCueWithNext,
  moveItem,
  setClipSpeed,
  scriptToCaptionCues,
  splitClipAt,
  trimClipRange,
  updateCueAt,
} from '../app/edit-workbench.js'

describe('cutSourceRangeFromClips (텍스트 기반 컷 편집)', () => {
  const clips = [
    { file: 'clips/talk.mp4', role: 'hook', start: '0', end: '10' },
    { file: 'clips/other.mp4', role: 'use', start: '0', end: '3' },
  ]

  it('문장 구간을 지우면 클립이 앞/뒤 두 조각으로 나뉜다', () => {
    const next = cutSourceRangeFromClips(clips, 'clips/talk.mp4', 4, 6)
    expect(next).toHaveLength(3)
    expect(next[0]).toMatchObject({ file: 'clips/talk.mp4', start: '0', end: '4' })
    expect(next[1]).toMatchObject({ file: 'clips/talk.mp4', start: '6', end: '10' })
    expect(next[2].file).toBe('clips/other.mp4')
  })

  it('클립 머리 부분을 지우면 한 조각만 남는다', () => {
    const next = cutSourceRangeFromClips(clips, 'clips/talk.mp4', 0, 3)
    expect(next[0]).toMatchObject({ file: 'clips/talk.mp4', start: '3', end: '10' })
  })

  it('구간이 겹치지 않으면 그대로 둔다', () => {
    const next = cutSourceRangeFromClips(clips, 'clips/talk.mp4', 20, 25)
    expect(next).toHaveLength(2)
    expect(next[0]).toMatchObject({ start: '0', end: '10' })
  })

  it('이미 잘려 여러 조각인 클립에서도 해당 조각만 자른다', () => {
    const pieces = [
      { file: 'clips/talk.mp4', role: 'hook', start: '0', end: '4' },
      { file: 'clips/talk.mp4', role: 'hook', start: '6', end: '10' },
    ]
    const next = cutSourceRangeFromClips(pieces, 'clips/talk.mp4', 7, 8)
    expect(next).toHaveLength(3)
    expect(next[1]).toMatchObject({ start: '6', end: '7' })
    expect(next[2]).toMatchObject({ start: '8', end: '10' })
  })

  it('남는 조각이 너무 짧으면 버린다 (전체 컷 = 클립 삭제)', () => {
    const next = cutSourceRangeFromClips(clips, 'clips/talk.mp4', 0.05, 9.95)
    expect(next).toHaveLength(1)
    expect(next[0].file).toBe('clips/other.mp4')
  })
})

describe('edit workbench model', () => {
  const clips = [
    { file: 'clips/a.mp4', role: 'hook', start: '0', end: '2.5' },
    { file: 'clips/b.mp4', role: 'use', start: '1', end: '5' },
  ]

  it('builds timeline segments with cumulative positions', () => {
    const timeline = buildTimelineSegments(clips)

    expect(timeline.totalDurationSec).toBe(6.5)
    expect(timeline.segments).toMatchObject([
      { index: 0, timelineStartSec: 0, timelineEndSec: 2.5, durationSec: 2.5 },
      { index: 1, timelineStartSec: 2.5, timelineEndSec: 6.5, durationSec: 4 },
    ])
    expect(timeline.segments[0].widthPct).toBeCloseTo(38.46, 1)
  })

  it('moves items without mutating the original array', () => {
    const moved = moveItem(clips, 1, -1)

    expect(moved.map((clip) => clip.file)).toEqual(['clips/b.mp4', 'clips/a.mp4'])
    expect(clips.map((clip) => clip.file)).toEqual(['clips/a.mp4', 'clips/b.mp4'])
  })

  it('splits a clip at a source timestamp', () => {
    const split = splitClipAt(clips, 1, 3)

    expect(split).toHaveLength(3)
    expect(split[1]).toMatchObject({ file: 'clips/b.mp4', start: '1', end: '3' })
    expect(split[2]).toMatchObject({ file: 'clips/b.mp4', start: '3', end: '5' })
  })

  it('trims a clip while enforcing a minimum duration', () => {
    const trimmed = trimClipRange(clips, 0, 1.2, 1.25)

    expect(trimmed[0]).toMatchObject({ start: '1.2', end: '1.35' })
  })

  it('trims with drag handles while keeping handles from crossing', () => {
    const dragged = dragTrimClipRange(clips, 1, { startSec: 4.95, endSec: 5.2 })

    expect(dragged[1]).toMatchObject({ start: '4.85', end: '5' })
  })

  it('stores clip speed and updates timeline duration', () => {
    const fast = setClipSpeed(clips, 1, 2)
    const timeline = buildTimelineSegments(fast)

    expect(fast[1]).toMatchObject({ speed: '2' })
    expect(timeline.segments[1]).toMatchObject({ sourceDurationSec: 4, durationSec: 2, speed: 2 })
    expect(timeline.totalDurationSec).toBe(4.5)
  })

  it('applies convenience edit presets without mutating source clips', () => {
    const fastHook = applyEditPreset(clips, 'viral_fast_hook')
    const breath = applyEditPreset(clips, 'breath_room')
    const focus = applyEditPreset(clips, 'detail_focus')

    expect(fastHook[0]).toMatchObject({ start: '0.2', speed: '1.25', editNote: '초반 훅 압축' })
    expect(breath.every((clip) => clip.speed === '0.9')).toBe(true)
    expect(focus[0]).toMatchObject({ focusMode: 'detail_zoom', editNote: '디테일 줌 후보' })
    expect(clips[0]).not.toHaveProperty('speed')
  })

  it('edits, merges, and deletes caption cues', () => {
    const cues = [
      { startMs: 0, endMs: 1000, text: '첫 문장' },
      { startMs: 1000, endMs: 2200, text: '두 번째' },
      { startMs: 2200, endMs: 3000, text: '삭제할 문장' },
    ]

    const updated = updateCueAt(cues, 0, { text: '수정된 문장', endMs: 1200 })
    const merged = mergeCueWithNext(updated, 0)
    const deleted = deleteCueAt(merged, 1)

    expect(updated[0]).toEqual({ startMs: 0, endMs: 1200, text: '수정된 문장' })
    expect(merged[0]).toEqual({ startMs: 0, endMs: 2200, text: '수정된 문장 두 번째' })
    expect(deleted).toHaveLength(1)
  })

  it('turns a supplied script into timed caption cues', () => {
    const cues = scriptToCaptionCues('First. Again.', { durationSec: 6, maxChars: 20 })

    expect(cues).toEqual([
      { startMs: 0, endMs: 3000, text: 'First.' },
      { startMs: 3000, endMs: 6000, text: 'Again.' },
    ])
  })

  it('analyzes a script into automatic edit actions and caption cues', () => {
    const plan = analyzeScriptForAutoEdit('Shock reveal. Price discount proof. Link now.', clips, {
      maxChars: 24,
    })

    expect(plan.captionCueCount).toBeGreaterThan(1)
    expect(plan.actions.some((action) => action.kind === 'trim')).toBe(true)
    expect(plan.actions.some((action) => action.kind === 'speed')).toBe(true)
    expect(plan.actions.some((action) => action.kind === 'focus')).toBe(true)
    expect(plan.summary.actionCount).toBe(plan.actions.length)
  })

  it('applies automatic edit plans without mutating source clips', () => {
    const plan = {
      actions: [
        { kind: 'trim', index: 0, startOffsetSec: 0.2, endOffsetSec: 0 },
        { kind: 'speed', index: 0, speed: 1.35 },
        { kind: 'focus', index: 1, focusMode: 'detail_zoom', note: 'proof focus' },
      ],
    }

    const edited = applyAutoEditPlan(clips, plan)

    expect(edited[0]).toMatchObject({ start: '0.2', end: '2.5', speed: '1.35' })
    expect(edited[1]).toMatchObject({ focusMode: 'detail_zoom', editNote: 'proof focus' })
    expect(clips[0]).toEqual({ file: 'clips/a.mp4', role: 'hook', start: '0', end: '2.5' })
  })

  it('normalizes edit subtab state to a known workspace', () => {
    expect(normalizeEditSubtab('captions')).toBe('captions')
    expect(normalizeEditSubtab('unknown')).toBe('media')
    expect(normalizeEditSubtab('')).toBe('media')
  })

  it('keeps selectable fields from falling back to blank values', () => {
    expect(normalizeSelectValue('', ['a', 'b'], 'fallback')).toBe('a')
    expect(normalizeSelectValue('b', ['a', 'b'], 'fallback')).toBe('b')
    expect(normalizeSelectValue('', [], 'fallback')).toBe('fallback')
  })

  it('fills missing TTS settings with usable defaults', () => {
    expect(normalizeTtsSettings({ provider: '', voice: '', speed: '', scriptSource: '' })).toEqual({
      provider: 'mock',
      voice: 'ko-female-bright',
      speed: '1',
      scriptSource: 'story',
      volume: '0.9',
    })
  })
})
