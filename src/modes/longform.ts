import { z } from 'zod'
import { basename, extname } from 'node:path'
import { execa } from 'execa'
import type { ClipRole, Project } from '../config/schema.js'
import { FFMPEG_BIN, ensureFfmpeg } from '../video/ffmpeg.js'
import { probeClip } from '../video/ffprobe.js'
import { detectSilences, type DetectSilenceOptions, type SilenceRange } from '../video/silence.js'
import type { Cue } from '../subtitles/srt.js'

export { parseSilencedetectLog } from '../video/silence.js'

export const longformSourceSchema = z.object({
  projectName: z.string().min(1),
  file: z.string().min(1),
  durationSec: z.number().positive(),
  productName: z.string().min(1),
  affiliateUrl: z.string().url(),
})

export interface HighlightCandidate {
  index: number
  start: number
  end: number
  duration: number
  score: number
  reason: string
  transcriptText?: string
  semanticScore?: {
    keywordHits: string[]
    productHits: string[]
    hookHits: string[]
  }
  visualScore?: {
    sceneChangeCount: number
    sceneChangeTimes: number[]
    activityBonus: number
  }
}

export type LongformSource = z.infer<typeof longformSourceSchema>

export interface AnalyzeLongformOptions extends DetectSilenceOptions {
  file: string
  projectName?: string
  productName: string
  affiliateUrl: string
  targetDurationSec?: number
  generatedAt?: string
  transcript?: TranscriptSegment[]
  visionScoring?: boolean
  sceneThreshold?: number
}

export interface LongformAnalysisReport {
  generatedAt: string
  source: LongformSource
  media: {
    durationSec: number
    width: number
    height: number
    hasAudio: boolean
  }
  silenceOptions: Required<DetectSilenceOptions>
  silences: SilenceRange[]
  candidates: HighlightCandidate[]
  transcript?: {
    segmentCount: number
    scoring: 'keyword_overlap'
  }
  visual?: {
    scoring: 'ffmpeg_scene_change'
    signalCount: number
    sceneThreshold: number
  }
  warnings: string[]
}

export interface TranscriptSegment {
  start: number
  end: number
  text: string
}

export interface VisualSignal {
  timestamp: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function round2(value: number): number {
  return Number(value.toFixed(2))
}

function numberFromMatch(line: string, pattern: RegExp): number | null {
  const match = pattern.exec(line)
  if (!match?.[1]) return null
  const value = Number(match[1])
  return Number.isFinite(value) ? value : null
}

function projectNameFromFile(file: string): string {
  const name = basename(file, extname(file)).trim()
  return name || 'longform-source'
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}

function productKeywords(productName: string): string[] {
  return unique(
    productName
      .split(/\s+/)
      .map((word) => normalizeText(word).trim())
      .filter((word) => [...word].length >= 2),
  )
}

function keywordHits(text: string, keywords: string[]): string[] {
  const normalized = normalizeText(text)
  return keywords.filter((keyword) => normalized.includes(normalizeText(keyword)))
}

function transcriptTextForCandidate(candidate: HighlightCandidate, transcript: TranscriptSegment[]): string {
  return transcript
    .filter((segment) => segment.end > candidate.start && segment.start < candidate.end)
    .map((segment) => segment.text)
    .join(' ')
    .trim()
}

export function cuesToTranscriptSegments(cues: Cue[]): TranscriptSegment[] {
  return cues.map((cue) => ({
    start: round2(cue.startMs / 1000),
    end: round2(cue.endMs / 1000),
    text: cue.text,
  }))
}

export function parseSceneChangeLog(log: string): VisualSignal[] {
  const times = unique(
    log
      .split(/\r?\n/)
      .map((line) => numberFromMatch(line, /pts_time:([0-9.]+)/))
      .filter((value) => value !== null)
      .map((value) => round2(value)),
  )
  return times.map((timestamp) => ({ timestamp }))
}

export async function detectSceneChanges(
  file: string,
  threshold = 0.18,
): Promise<VisualSignal[]> {
  try {
    const { stderr } = await execa(FFMPEG_BIN, [
      '-hide_banner',
      '-nostats',
      '-i',
      file,
      '-vf',
      `select=gt(scene\\,${threshold}),showinfo`,
      '-an',
      '-f',
      'null',
      '-',
    ])
    return parseSceneChangeLog(stderr)
  } catch (err) {
    const e = err as { stderr?: string; shortMessage?: string }
    throw new Error(`longform visual scene analysis failed: ${e.shortMessage ?? e.stderr ?? 'unknown error'}`)
  }
}

export function scoreHighlightCandidatesWithVisualSignals(
  candidates: HighlightCandidate[],
  signals: VisualSignal[],
): HighlightCandidate[] {
  return candidates
    .map((candidate) => {
      const sceneChangeTimes = signals
        .filter((signal) => signal.timestamp >= candidate.start && signal.timestamp <= candidate.end)
        .map((signal) => signal.timestamp)
      const activityBonus = round2(Math.min(18, sceneChangeTimes.length * 4))
      return {
        ...candidate,
        score: round2(candidate.score + activityBonus),
        reason:
          sceneChangeTimes.length > 0
            ? `${candidate.reason}; visual scene changes: ${sceneChangeTimes.length}`
            : `${candidate.reason}; visual scene review found no cuts`,
        visualScore: {
          sceneChangeCount: sceneChangeTimes.length,
          sceneChangeTimes,
          activityBonus,
        },
      }
    })
    .sort((a, b) => b.score - a.score)
    .map((candidate, index) => ({ ...candidate, index: index + 1 }))
}

export function scoreHighlightCandidatesWithTranscript(
  sourceInput: LongformSource,
  candidates: HighlightCandidate[],
  transcript: TranscriptSegment[],
): HighlightCandidate[] {
  const source = longformSourceSchema.parse(sourceInput)
  const productHitsList = productKeywords(source.productName)
  const hookKeywords = [
    'review',
    'price',
    'discount',
    'buy',
    'link',
    'result',
    'before',
    'after',
    'problem',
    'recommend',
    'secret',
    'best',
    '후기',
    '리뷰',
    '가격',
    '할인',
    '구매',
    '링크',
    '결과',
    '전후',
    '문제',
    '추천',
    '꿀팁',
  ]

  return candidates
    .map((candidate) => {
      const transcriptText = transcriptTextForCandidate(candidate, transcript)
      const productHits = keywordHits(transcriptText, productHitsList)
      const hookHits = keywordHits(transcriptText, hookKeywords)
      const keywordHitList = unique([...productHits, ...hookHits])
      const transcriptBonus =
        productHits.length * 10 + hookHits.length * 6 + Math.min(12, transcriptText.length / 35)
      const semanticScore = {
        keywordHits: keywordHitList,
        productHits,
        hookHits,
      }
      return {
        ...candidate,
        score: round2(candidate.score + transcriptBonus),
        reason: keywordHitList.length
          ? `${candidate.reason}; transcript keywords: ${keywordHitList.slice(0, 6).join(', ')}`
          : `${candidate.reason}; transcript overlap reviewed`,
        transcriptText,
        semanticScore,
      }
    })
    .sort((a, b) => b.score - a.score)
    .map((candidate, index) => ({ ...candidate, index: index + 1 }))
}

export async function analyzeLongformMedia(
  options: AnalyzeLongformOptions,
): Promise<LongformAnalysisReport> {
  await ensureFfmpeg()
  const media = await probeClip(options.file)
  const silenceOptions = {
    noiseDb: options.noiseDb ?? -35,
    minDurationSec: options.minDurationSec ?? 0.6,
  }
  const warnings: string[] = []
  const silences = media.hasAudio
    ? await detectSilences(options.file, media.duration, silenceOptions)
    : []

  if (!media.hasAudio) {
    warnings.push('No audio stream was found, so fixed-length highlight candidates were created.')
  }

  const source = longformSourceSchema.parse({
    projectName: options.projectName ?? projectNameFromFile(options.file),
    file: options.file,
    durationSec: Math.max(0.01, round2(media.duration)),
    productName: options.productName,
    affiliateUrl: options.affiliateUrl,
  })
  const baseCandidates = buildHighlightCandidates(source, silences, options.targetDurationSec ?? 45)
  const sceneThreshold = options.sceneThreshold ?? 0.18
  let visualSignals: VisualSignal[] | undefined
  if (options.visionScoring) {
    try {
      visualSignals = await detectSceneChanges(options.file, sceneThreshold)
    } catch (err) {
      warnings.push((err as Error).message)
      visualSignals = []
    }
  }
  const visualCandidates = visualSignals
    ? scoreHighlightCandidatesWithVisualSignals(baseCandidates, visualSignals)
    : baseCandidates
  const candidates = options.transcript?.length
    ? scoreHighlightCandidatesWithTranscript(source, visualCandidates, options.transcript)
    : visualCandidates

  if (silences.length === 0 && media.hasAudio) {
    warnings.push('No silence boundaries were detected, so fixed-length candidates were created.')
  }
  if (candidates.length === 0) {
    warnings.push('No highlight candidates were long enough for shorts conversion.')
  }

  return {
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source,
    media: {
      durationSec: source.durationSec,
      width: media.width,
      height: media.height,
      hasAudio: media.hasAudio,
    },
    silenceOptions,
    silences,
    candidates,
    transcript: options.transcript?.length
      ? {
          segmentCount: options.transcript.length,
          scoring: 'keyword_overlap',
        }
      : undefined,
    visual: visualSignals
      ? {
          scoring: 'ffmpeg_scene_change',
          signalCount: visualSignals.length,
          sceneThreshold,
        }
      : undefined,
    warnings,
  }
}

export function buildHighlightCandidates(
  sourceInput: LongformSource,
  silences: SilenceRange[] = [],
  targetDurationSec = 45,
): HighlightCandidate[] {
  const source = longformSourceSchema.parse(sourceInput)
  const cutPoints = [0, ...silences.map((silence) => silence.end), source.durationSec]
    .map((point) => clamp(point, 0, source.durationSec))
    .sort((a, b) => a - b)
  const candidates: HighlightCandidate[] = []

  for (let index = 0; index < cutPoints.length - 1; index++) {
    const start = cutPoints[index] as number
    const windowEnd = clamp(start + targetDurationSec, start + 5, source.durationSec)
    const nextCut = cutPoints[index + 1] as number
    const end = Math.max(windowEnd, Math.min(source.durationSec, nextCut))
    const duration = end - start
    if (duration < 8) continue
    const score = 100 - Math.abs(targetDurationSec - duration)
    candidates.push({
      index: candidates.length + 1,
      start: round2(start),
      end: round2(end),
      duration: round2(duration),
      score: round2(score),
      reason: silences.length > 0 ? '무음 이후 새 구간 후보' : '고정 길이 하이라이트 후보',
    })
  }

  return candidates.slice(0, 10)
}

export function candidateToShortsProject(
  sourceInput: LongformSource,
  candidate: HighlightCandidate,
): Pick<Project, 'projectName' | 'product' | 'disclosure' | 'style' | 'clips' | 'variants' | 'publish' | 'sources'> {
  const source = longformSourceSchema.parse(sourceInput)
  const roles: ClipRole[] = ['hook', 'use', 'result']
  const segment = candidate.duration / roles.length
  return {
    projectName: `${source.projectName}-highlight-${String(candidate.index).padStart(2, '0')}`,
    product: {
      name: source.productName,
      category: 'longform-highlight',
      priceRange: '0-0',
      affiliateUrl: source.affiliateUrl,
      painPoint: '긴 영상에서 핵심 구간을 빠르게 찾기 어려움',
      benefit: '조회수용 하이라이트 후보를 쇼츠 프로젝트로 변환',
    },
    disclosure: {
      type: 'affiliate',
      text: '이 콘텐츠는 제휴 링크를 포함할 수 있습니다.',
    },
    style: {
      duration: Math.min(60, candidate.duration),
      ratio: '9:16',
      resolution: '1080x1920',
      tone: 'highlight',
      captionPosition: 'bottom',
      captionStyle: 'basic',
      transition: 'none',
      bgmVolume: 0.12,
    },
    clips: roles.map((role, index) => ({
      file: source.file,
      role,
      start: round2(candidate.start + segment * index),
      end: round2(index === roles.length - 1 ? candidate.end : candidate.start + segment * (index + 1)),
    })),
    variants: { count: 3 },
    publish: {
      campaignName: `${source.projectName}-highlight`,
      platforms: ['youtube_shorts', 'instagram_reels', 'tiktok'],
      hashtags: ['하이라이트', '쇼츠', source.productName],
      linkPlacement: 'profile_link',
      cta: '자세한 정보는 링크에서 확인하세요.',
    },
    sources: [
      {
        title: '원본 롱폼 영상',
        file: source.file,
        rights: 'owned',
        usage: 'edit',
        notes: `하이라이트 후보 ${candidate.index}: ${candidate.start}s-${candidate.end}s`,
      },
    ],
  }
}
