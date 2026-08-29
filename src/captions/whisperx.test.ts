import { describe, expect, it } from 'vitest'
import { buildWhisperxArgs, parseWhisperxJson, resolveCompute, torchLibDir } from './whisperx.js'

describe('WhisperX 인자', () => {
  const base = { mediaPath: 'C:/영상.mp4', outputDir: 'C:/out', scriptPath: 'C:/repo/scripts/whisperx_stt.py', outJson: 'C:/out/영상.json' }

  it('전용 스크립트를 부르고 결과 경로를 넘긴다', () => {
    const args = buildWhisperxArgs(base)
    expect(args[0]).toBe('C:/repo/scripts/whisperx_stt.py')
    expect(args[1]).toBe('C:/영상.mp4')
    expect(args[args.indexOf('--out') + 1]).toBe('C:/out/영상.json')
    expect(args[args.indexOf('--model') + 1]).toBe('large-v3')
  })

  it('정렬은 기본이 CPU다 — GPU에서 전사와 겹치면 프로세스가 즉사한다', () => {
    expect(buildWhisperxArgs(base)[buildWhisperxArgs(base).indexOf('--align-device') + 1]).toBe('cpu')
    expect(buildWhisperxArgs({ ...base, device: 'cuda' })).toContain('cuda')
  })

  it('언어를 비우면 ko로 채운다', () => {
    expect(buildWhisperxArgs({ ...base, language: '' })[buildWhisperxArgs(base).indexOf('--language') + 1]).toBe('ko')
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
