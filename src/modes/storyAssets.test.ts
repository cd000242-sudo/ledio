import { describe, expect, it } from 'vitest'
import {
  buildCaptionDrawtextFilters,
  buildStoryClipArgs,
  buildStoryProjectFromAssets,
  storyAssetSceneSchema,
} from './storyAssets.js'
import { escapeFilterPath } from '../video/ffmpeg.js'
import { wrapText } from '../utils/text.js'

const storyboard = {
  projectName: 'midnight-story',
  title: 'Midnight Delivery',
  productName: 'Story Channel',
  affiliateUrl: 'https://example.com/story',
  scenes: [
    {
      image: 'images/scene-01.png',
      narration: 'A box was waiting outside the door.',
      durationSec: 3,
    },
    {
      image: 'images/scene-02.png',
      narration: 'The label had tomorrow night written on it.',
      durationSec: 4,
    },
    {
      image: 'images/scene-03.png',
      narration: 'The hallway light turned off by itself.',
      durationSec: 5,
    },
  ],
}

describe('story asset video bridge', () => {
  it('turns scene assets into a shorts project contract', () => {
    const project = buildStoryProjectFromAssets(storyboard, [
      'clips/scene_01.mp4',
      'clips/scene_02.mp4',
      'clips/scene_03.mp4',
    ])

    expect(project.projectName).toBe('midnight-story')
    expect(project.style.duration).toBe(12)
    expect(project.clips.map((clip) => clip.role)).toEqual(['hook', 'use', 'result'])
    expect(project.sources).toHaveLength(3)
    expect(project.sources[0]?.rights).toBe('ai_generated')
    expect(project.publish.platforms).toContain('youtube_shorts')
  })

  it('롱폼(16:9) 스토리보드는 가로 해상도로 렌더 계약을 만든다', () => {
    const clips = ['clips/scene_01.mp4', 'clips/scene_02.mp4', 'clips/scene_03.mp4']
    const wide = buildStoryProjectFromAssets({ ...storyboard, ratio: '16:9' }, clips)
    expect(wide.style.ratio).toBe('16:9')
    expect(wide.style.resolution).toBe('1920x1080')
    const tall = buildStoryProjectFromAssets(storyboard, clips)
    expect(tall.style.resolution).toBe('1080x1920')
  })

  it('BGM 파일을 주면 프로젝트에 bgm으로 실린다', () => {
    const clips = ['clips/scene_01.mp4', 'clips/scene_02.mp4', 'clips/scene_03.mp4']
    const withBgm = buildStoryProjectFromAssets(storyboard, clips, 'audio/bgm.mp3')
    expect(withBgm.bgm?.file).toBe('audio/bgm.mp3')
    const withoutBgm = buildStoryProjectFromAssets(storyboard, clips)
    expect(withoutBgm.bgm).toBeUndefined()
  })

  it('requires one generated clip for every scene', () => {
    expect(() => buildStoryProjectFromAssets(storyboard, ['clips/scene_01.mp4'])).toThrow(
      'clipFiles must match',
    )
  })

  it('accepts optional narrationAudio on a scene', () => {
    const parsed = storyAssetSceneSchema.parse({
      image: 'images/scene-01.png',
      narration: 'hello',
      durationSec: 3,
      narrationAudio: 'narration/narration_01.wav',
    })
    expect(parsed.narrationAudio).toBe('narration/narration_01.wav')
  })
})

describe('buildStoryClipArgs', () => {
  const base = {
    imagePath: 'img.png',
    outPath: 'out.mp4',
    durationSec: 4,
    vf: 'scale=1080:1920',
  }

  it('나레이션이 없으면 무음 트랙 + shortest를 쓴다', () => {
    const args = buildStoryClipArgs(base)
    expect(args.join(' ')).toContain('anullsrc')
    expect(args).toContain('-shortest')
    expect(args).toContain('-t')
    expect(args[args.indexOf('-t') + 1]).toBe('4')
  })

  it('나레이션이 있으면 wav를 오디오 입력으로 쓰고 apad로 길이를 채운다', () => {
    const args = buildStoryClipArgs({ ...base, narrationAudio: 'n1.wav' })
    expect(args).toContain('n1.wav')
    expect(args.join(' ')).not.toContain('anullsrc')
    expect(args.join(' ')).toContain('apad')
    expect(args).not.toContain('-shortest')
    expect(args[args.indexOf('-t') + 1]).toBe('4')
  })

  it('두 경로 모두 이미지 루프와 최종 출력 경로를 포함한다', () => {
    for (const args of [buildStoryClipArgs(base), buildStoryClipArgs({ ...base, narrationAudio: 'n1.wav' })]) {
      expect(args).toContain('-loop')
      expect(args.at(-1)).toBe('out.mp4')
    }
  })

  it('motion 영상이 있으면 정지 이미지 대신 영상을 입력으로 쓰고 장면 길이만큼 반복한다', () => {
    const args = buildStoryClipArgs({ ...base, motionVideoPath: 'motion/scene_01.mp4' })
    expect(args).toContain('motion/scene_01.mp4')
    expect(args).not.toContain('img.png')
    expect(args).not.toContain('-loop')
    expect(args).toContain('-stream_loop')
    expect(args[args.indexOf('-t') + 1]).toBe('4')
  })

  it('motion 영상 + 나레이션 조합도 동작한다', () => {
    const args = buildStoryClipArgs({ ...base, motionVideoPath: 'm.mp4', narrationAudio: 'n1.wav' })
    expect(args).toContain('m.mp4')
    expect(args).toContain('n1.wav')
    expect(args.join(' ')).toContain('apad')
  })
})

describe('buildCaptionDrawtextFilters', () => {
  const fontPath = 'C:/Windows/Fonts/malgun.ttf'

  it('단일 caption 기본 경로는 종전 drawtext 문자열과 완전히 동일하다', () => {
    const result = buildCaptionDrawtextFilters({
      caption: '한 문장짜리 자막입니다',
      fontPath,
      captionFileBase: 'out.mp4.caption',
      height: 1920,
    })
    expect(result.files).toEqual([
      { path: 'out.mp4.caption.txt', text: wrapText('한 문장짜리 자막입니다', 18) },
    ])
    expect(result.filters).toEqual([
      [
        `drawtext=fontfile='${escapeFilterPath(fontPath)}'`,
        `textfile='${escapeFilterPath('out.mp4.caption.txt')}'`,
        'fontcolor=white',
        'fontsize=48',
        'box=1',
        'boxcolor=black@0.58',
        'boxborderw=18',
        'line_spacing=12',
        'x=(w-text_w)/2',
        'y=h-538',
      ].join(':'),
    ])
  })

  it('cue 배열이 있으면 cue별 enable 구간과 파일이 생긴다', () => {
    const result = buildCaptionDrawtextFilters({
      captionCues: [
        { text: '첫 조각', start: 0, end: 1.5 },
        { text: '둘째 조각', start: 1.5, end: 4.2 },
      ],
      fontPath,
      captionFileBase: 'out.mp4.caption',
      height: 1920,
      position: 'center',
      fontSize: 66,
    })
    expect(result.files.map((file) => file.path)).toEqual([
      'out.mp4.caption.01.txt',
      'out.mp4.caption.02.txt',
    ])
    expect(result.files[0]?.text).toBe('첫 조각')
    expect(result.filters).toHaveLength(2)
    expect(result.filters[0]).toContain("enable='between(t,0.000,1.500)'")
    expect(result.filters[1]).toContain("enable='between(t,1.500,4.200)'")
    expect(result.filters[0]).toContain('y=(h-text_h)/2')
    expect(result.filters[0]).toContain('fontsize=66')
  })

  it('position을 지정하면 단일 caption도 해당 위치로 간다', () => {
    const result = buildCaptionDrawtextFilters({
      caption: '센터 자막',
      fontPath,
      captionFileBase: 'x.caption',
      height: 1920,
      position: 'center',
    })
    expect(result.filters[0]).toContain('y=(h-text_h)/2')
  })

  it('caption도 cue도 없으면 빈 결과', () => {
    const result = buildCaptionDrawtextFilters({
      fontPath,
      captionFileBase: 'x.caption',
      height: 1920,
    })
    expect(result.files).toEqual([])
    expect(result.filters).toEqual([])
  })
})
