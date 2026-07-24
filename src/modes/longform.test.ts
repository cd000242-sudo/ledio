import { describe, expect, it } from 'vitest'
import {
  buildHighlightCandidates,
  candidateToShortsProject,
  cuesToTranscriptSegments,
  parseSceneChangeLog,
  parseSilencedetectLog,
  scoreHighlightCandidatesWithVisualSignals,
  scoreHighlightCandidatesWithTranscript,
} from './longform.js'

const source = {
  projectName: 'review-live',
  file: 'clips/live-review.mp4',
  durationSec: 420,
  productName: '접이식 선반',
  affiliateUrl: 'https://example.com/product',
}

describe('longform mode', () => {
  it('parses FFmpeg silencedetect output into ranges', () => {
    const ranges = parseSilencedetectLog(
      [
        '[silencedetect @ 000001] silence_start: 18.42',
        '[silencedetect @ 000001] silence_end: 20.91 | silence_duration: 2.49',
        '[silencedetect @ 000001] silence_start: 46.1',
      ].join('\n'),
      50,
    )

    expect(ranges).toEqual([
      { start: 18.42, end: 20.91 },
      { start: 46.1, end: 50 },
    ])
  })

  it('creates highlight candidates from silence boundaries', () => {
    const candidates = buildHighlightCandidates(source, [
      { start: 58, end: 60 },
      { start: 132, end: 135 },
    ])
    expect(candidates.length).toBeGreaterThan(1)
    expect(candidates[0]?.duration).toBeGreaterThan(8)
    expect(candidates[1]?.reason).toContain('무음')
  })

  it('re-ranks candidates with transcript keyword overlap', () => {
    const candidates = buildHighlightCandidates(source, [
      { start: 18, end: 20 },
      { start: 43, end: 45 },
    ], 20)
    const scored = scoreHighlightCandidatesWithTranscript(
      { ...source, productName: 'folding shelf' },
      candidates,
      cuesToTranscriptSegments([
        {
          startMs: 21_000,
          endMs: 38_000,
          text: 'This folding shelf review shows the price, discount, result, and why I recommend the link.',
        },
      ]),
    )

    expect(scored[0]?.start).toBe(20)
    expect(scored[0]?.semanticScore?.hookHits).toContain('review')
    expect(scored[0]?.semanticScore?.productHits).toContain('folding')
    expect(scored[0]?.score).toBeGreaterThan(candidates[0]?.score ?? 0)
  })

  it('adds visual scene-change activity scoring', () => {
    const candidates = buildHighlightCandidates(source, [
      { start: 18, end: 20 },
      { start: 43, end: 45 },
    ], 20)
    const signals = parseSceneChangeLog(
      [
        '[Parsed_showinfo_1 @ 000001] n:   0 pts: 921600 pts_time:20',
        '[Parsed_showinfo_1 @ 000001] n:   1 pts: 1981440 pts_time:43',
        '[Parsed_showinfo_1 @ 000001] n:   2 pts: 2073600 pts_time:45',
      ].join('\n'),
    )
    const scored = scoreHighlightCandidatesWithVisualSignals(candidates, signals)

    expect(signals).toEqual([{ timestamp: 20 }, { timestamp: 43 }, { timestamp: 45 }])
    expect(scored[0]?.visualScore?.sceneChangeCount).toBeGreaterThan(0)
    expect(scored[0]?.reason).toContain('visual scene changes')
    expect(scored[0]?.score).toBeGreaterThan(candidates[0]?.score ?? 0)
  })

  it('converts a candidate into a shorts project contract', () => {
    const [candidate] = buildHighlightCandidates(source, [{ start: 58, end: 60 }])
    if (!candidate) throw new Error('missing candidate')
    const project = candidateToShortsProject(source, candidate)
    expect(project.projectName).toContain('highlight')
    expect(project.clips).toHaveLength(3)
    expect(project.clips[0]?.role).toBe('hook')
    expect(project.sources[0]?.notes).toContain(`${candidate.start}s`)
  })
})
