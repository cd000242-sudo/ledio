import { describe, expect, it } from 'vitest'
import {
  buildAlignArgs,
  buildAudioExtractArgs,
  buildInitialPrompt,
  buildTranscribeArgs,
  parseWhisperxJson,
  resolveCompute,
  torchLibDir,
} from './whisperx.js'

describe('WhisperX 단계 인자', () => {
  const base = {
    mediaPath: 'C:/영상.mp4',
    outputDir: 'C:/out',
    scriptPath: 'C:/repo/scripts/whisperx_stt.py',
    segmentsJson: 'C:/out/영상.segments.json',
    outJson: 'C:/out/영상.aligned.json',
  }

  it('1단계는 전사 — 모델·배치·결과 경로를 넘긴다', () => {
    const args = buildTranscribeArgs(base)
    expect(args[1]).toBe('transcribe')
    expect(args[args.indexOf('--out') + 1]).toBe('C:/out/영상.segments.json')
    expect(args[args.indexOf('--model') + 1]).toBe('large-v3')
    expect(args[args.indexOf('--batch-size') + 1]).toBe('16')
  })

  it('대본이 있으면 STT 힌트로 넘긴다 — 고유명사·숫자 정확도가 올라간다', () => {
    const args = buildTranscribeArgs({ ...base, initialPrompt: '서울대학교 AI 대학원 입학기' })
    expect(args[args.indexOf('--initial-prompt') + 1]).toBe('서울대학교 AI 대학원 입학기')
    // 대본이 없으면 아예 넘기지 않는다
    expect(buildTranscribeArgs(base)).not.toContain('--initial-prompt')
  })

  it('힌트는 앞부분만 잘라 쓴다(모델이 긴 프롬프트를 잘라버린다)', () => {
    const long = '가나다 '.repeat(500)
    expect(buildInitialPrompt(long).length).toBe(400)
    expect(buildInitialPrompt('  여러   공백 줄바꿈  ')).toBe('여러 공백 줄바꿈')

  })

  it('2단계는 정렬 — 전사 결과를 읽어 GPU에서 맞춘다', () => {
    const args = buildAlignArgs(base)
    expect(args[1]).toBe('align')
    expect(args[args.indexOf('--segments') + 1]).toBe('C:/out/영상.segments.json')
    expect(args[args.indexOf('--device') + 1]).toBe('cuda')
    // 필요하면 정렬만 CPU로 물러설 수 있다
    expect(buildAlignArgs({ ...base, alignDevice: 'cpu' })[args.indexOf('--device') + 1]).toBe('cpu')
  })
})

describe('WhisperX 결과 파싱', () => {
  it('단어 시각이 있으면 단어 단위 큐로 뽑는다 — 가장 세밀한 타임스탬프', () => {
    const cues = parseWhisperxJson(
      JSON.stringify({
        segments: [
          {
            start: 0,
            end: 1.5,
            text: '안녕하세요 여러분',
            words: [
              { word: '안녕하세요', start: 0.12, end: 0.83 },
              { word: '여러분', start: 0.9, end: 1.5 },
            ],
          },
        ],
      }),
    )
    expect(cues).toEqual([
      { startMs: 120, endMs: 830, text: '안녕하세요' },
      { startMs: 900, endMs: 1500, text: '여러분' },
    ])
  })

  it('단어 시각이 없으면 문장 단위로 물러선다', () => {
    const cues = parseWhisperxJson(
      JSON.stringify({ segments: [{ start: 2, end: 4.25, text: '문장만 있는 경우' }] }),
    )
    expect(cues).toEqual([{ startMs: 2000, endMs: 4250, text: '문장만 있는 경우' }])
  })

  it('시간이 뒤섞여 있어도 시간순으로 세운다', () => {
    const cues = parseWhisperxJson(
      JSON.stringify({
        segments: [
          { start: 5, end: 6, text: '뒤' },
          { start: 1, end: 2, text: '앞' },
        ],
      }),
    )
    expect(cues.map((cue) => cue.text)).toEqual(['앞', '뒤'])
  })

  it('빈 텍스트는 버리고, 깨진 JSON은 한국어로 알린다', () => {
    expect(parseWhisperxJson(JSON.stringify({ segments: [{ start: 0, end: 1, text: '   ' }] }))).toEqual([])
    expect(() => parseWhisperxJson('깨짐')).toThrow('해석하지 못했습니다')
  })
})

describe('실행 장치 결정', () => {
  it('GPU가 있으면 cuda+float16, 없으면 cpu+int8로 물러선다', () => {
    expect(resolveCompute(true)).toEqual({ device: 'cuda', computeType: 'float16' })
    // CPU에서 float16을 쓰면 ctranslate2가 거부한다
    expect(resolveCompute(false)).toEqual({ device: 'cpu', computeType: 'int8' })
  })

  it('사용자가 지정한 compute_type은 그대로 쓴다', () => {
    expect(resolveCompute(true, 'int8').computeType).toBe('int8')
  })
})

describe('cuDNN 경로', () => {
  it('venv 파이썬 경로에서 torch/lib을 유도한다', () => {
    // 이 경로를 PATH에 안 넣으면 ctranslate2가 GPU 실행에서 즉사한다
    const dir = torchLibDir('C:/repo/.venv-stt/Scripts/python.exe')
    const normalized = dir.split(String.fromCharCode(92)).join('/')
    expect(normalized).toContain('.venv-stt/Lib/site-packages/torch/lib')
  })
})

describe('음성 추출', () => {
  it('16kHz 모노 wav로 뽑는다 — 영상 컨테이너를 직접 물리면 프로세스가 죽는 경우가 있다', () => {
    const args = buildAudioExtractArgs('C:/영상/a.mp4', 'C:/out/a.16k.wav')
    expect(args).toContain('-vn')
    expect(args[args.indexOf('-ar') + 1]).toBe('16000')
    expect(args[args.indexOf('-ac') + 1]).toBe('1')
    expect(args.at(-1)).toBe('C:/out/a.16k.wav')
  })
})
