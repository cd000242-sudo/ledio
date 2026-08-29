import { describe, expect, it } from 'vitest'
import { buildBurnArgs, buildForceStyle, burnedOutputName, escapeFilterPath } from './burnCaptions.js'

describe('필터 경로 이스케이프', () => {
  it('윈도우 드라이브 콜론을 이스케이프한다 — 안 하면 필터 파서가 옵션으로 읽어 실패한다', () => {
    expect(escapeFilterPath('C:\\영상\\자막.srt')).toBe('C\\:/영상/자막.srt')
  })

  it('따옴표·대괄호·쉼표도 막는다', () => {
    expect(escapeFilterPath("D:/a'b[c],d.srt")).toBe("D\\:/a\\'b\\[c\\]\\,d.srt")
  })
})

describe('자막 모양', () => {
  it('기본은 한글 폰트에 테두리 있는 하단 중앙', () => {
    const style = buildForceStyle()
    expect(style).toContain('FontName=Malgun Gothic')
    expect(style).toContain('Alignment=2')
    expect(style).toContain('Outline=2')
  })

  it('크기·여백을 바꿀 수 있다', () => {
    const style = buildForceStyle({ fontSize: 24, marginV: 80 })
    expect(style).toContain('FontSize=24')
    expect(style).toContain('MarginV=80')
  })
})

describe('ffmpeg 인자', () => {
  const base = { videoPath: 'C:/영상/a.mp4', srtPath: 'C:/영상/a_정렬.srt', outPath: 'C:/영상/a_자막.mp4' }

  it('태워넣기는 subtitles 필터로 재인코딩하고 오디오는 그대로 복사한다', () => {
    const args = buildBurnArgs(base)
    expect(args.join(' ')).toContain('subtitles=')
    expect(args[args.indexOf('-c:a') + 1]).toBe('copy')
    expect(args[args.indexOf('-c:v') + 1]).toBe('libx264')
    expect(args.at(-1)).toBe('C:/영상/a_자막.mp4')
  })

  it('자막 트랙 방식은 재인코딩하지 않는다 — 몇 초면 끝난다', () => {
    const args = buildBurnArgs({ ...base, mode: 'mux' })
    expect(args[args.indexOf('-c') + 1]).toBe('copy')
    expect(args[args.indexOf('-c:s') + 1]).toBe('mov_text')
    expect(args.join(' ')).not.toContain('subtitles=')
  })

  it('화질 옵션을 넘길 수 있다', () => {
    expect(buildBurnArgs({ ...base, crf: 18 })[buildBurnArgs(base).indexOf('-crf') + 1]).toBe('18')
  })
})

describe('출력 파일 이름', () => {
  it('원본 옆에 두고 덮어쓰지 않는다', () => {
    expect(burnedOutputName('C:/영상/강의 1편.mp4')).toBe('C:/영상/강의 1편_자막.mp4')
    expect(burnedOutputName('C:/영상/강의.mkv', 'mux')).toBe('C:/영상/강의_자막트랙.mkv')
  })
})
