import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { TtsItemResult, TtsProvider, TtsRequest, TtsResult } from './provider.js'

/** 목소리 문자열이 이 접두사로 시작하면 타입캐스트 성우를 뜻한다(예: typecast:tc_abc). */
export const TYPECAST_VOICE_PREFIX = 'typecast:'

export interface TypecastOptions {
  /** 기본: TYPECAST_API_KEY 환경변수 */
  apiKey?: string
  /** 기본: https://api.typecast.ai (테스트에서 재정의) */
  apiBase?: string
  /** 기본: ssfm-v30 (TYPECAST_TTS_MODEL로 재정의) */
  model?: string
}

/** typecast: 접두사를 떼고 성우 id만 돌려준다. */
export function typecastVoiceId(voice: string): string {
  return voice.startsWith(TYPECAST_VOICE_PREFIX) ? voice.slice(TYPECAST_VOICE_PREFIX.length) : voice
}

// 타입캐스트 API는 ISO-639-3 언어 코드를 받는다. 프로젝트의 언어 표기를 변환한다.
const LANGUAGE_CODES: Record<string, string> = {
  korean: 'kor',
  kor: 'kor',
  ko: 'kor',
  english: 'eng',
  eng: 'eng',
  en: 'eng',
  japanese: 'jpn',
  jpn: 'jpn',
  ja: 'jpn',
  chinese: 'cmn',
  cmn: 'cmn',
  zh: 'cmn',
}

/**
 * wav 헤더에서 재생 길이를 읽는다(fmt 청크의 byteRate ÷ data 청크 크기).
 * 나레이션 길이가 장면 길이·자막 타이밍의 기준이라 ffprobe 없이도 정확해야 한다.
 */
export function wavDurationSec(buffer: Buffer): number {
  if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF') return 0
  let byteRate = 0
  let dataSize = 0
  let offset = 12
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4)
    const chunkSize = buffer.readUInt32LE(offset + 4)
    if (chunkId === 'fmt ' && offset + 16 <= buffer.length) {
      byteRate = buffer.readUInt32LE(offset + 16)
    } else if (chunkId === 'data') {
      dataSize = chunkSize
    }
    offset += 8 + chunkSize + (chunkSize % 2)
  }
  return byteRate > 0 ? dataSize / byteRate : 0
}

function friendlyHttpError(status: number, detail: string): Error {
  if (status === 401 || status === 403) {
    return new Error('타입캐스트 API 키가 올바르지 않거나 권한이 없습니다. 환경설정에서 키를 확인하세요.')
  }
  if (status === 402) {
    return new Error('타입캐스트 크레딧이 부족합니다. typecast.ai에서 크레딧을 확인하세요.')
  }
  if (status === 429) {
    return new Error('타입캐스트 요청이 너무 잦습니다. 잠시 후 다시 시도하세요.')
  }
  return new Error(`타입캐스트 생성 실패(HTTP ${status}): ${detail.slice(0, 200)}`)
}

interface SynthesizeOneParams {
  apiBase: string
  apiKey: string
  model: string
  voiceId: string
  language: string
  text: string
  previousText?: string
  nextText?: string
}

async function synthesizeOne(params: SynthesizeOneParams): Promise<Buffer> {
  const url = `${params.apiBase}/v1/text-to-speech`
  const buildBody = (withPrompt: boolean) => {
    const body: Record<string, unknown> = {
      voice_id: params.voiceId,
      text: params.text,
      model: params.model,
      language: params.language,
      output: { audio_format: 'wav' },
    }
    // 앞뒤 문장을 함께 주면 문맥에 맞는 억양으로 읽는다. 스키마가 거부하면 없이 재시도한다.
    if (withPrompt && (params.previousText || params.nextText)) {
      body.prompt = {
        emotion_type: 'smart',
        ...(params.previousText ? { previous_text: params.previousText } : {}),
        ...(params.nextText ? { next_text: params.nextText } : {}),
      }
    }
    return body
  }

  let withPrompt = true
  let lastError: Error | null = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-API-KEY': params.apiKey },
        body: JSON.stringify(buildBody(withPrompt)),
        signal: AbortSignal.timeout(2 * 60 * 1000),
      })
    } catch (err) {
      lastError = new Error(`타입캐스트 서버에 연결하지 못했습니다: ${(err as Error).message}`)
      continue
    }
    if (res.ok) {
      return Buffer.from(await res.arrayBuffer())
    }
    const detail = await res.text().catch(() => '')
    // 문맥 프롬프트 스키마 불일치(400)면 프롬프트 없이 한 번 더 시도한다.
    if (res.status === 400 && withPrompt) {
      withPrompt = false
      lastError = friendlyHttpError(res.status, detail)
      continue
    }
    // 요청 과다/일시 장애는 잠깐 쉬고 재시도한다.
    if (res.status === 429 || res.status >= 500) {
      lastError = friendlyHttpError(res.status, detail)
      await new Promise((resolveWait) => setTimeout(resolveWait, 2000 * attempt))
      continue
    }
    throw friendlyHttpError(res.status, detail)
  }
  throw lastError ?? new Error('타입캐스트 생성 실패')
}

/** 타입캐스트(클라우드 AI 성우) 프로바이더 — refAudio 자리에 typecast:<voice_id>를 받는다. */
export function createTypecastProvider(opts: TypecastOptions = {}): TtsProvider {
  const apiKey = opts.apiKey ?? process.env.TYPECAST_API_KEY ?? ''
  const apiBase = (opts.apiBase ?? process.env.TYPECAST_API_BASE ?? 'https://api.typecast.ai').replace(/\/+$/, '')
  const model = opts.model ?? process.env.TYPECAST_TTS_MODEL ?? 'ssfm-v30'

  return {
    name: 'typecast',
    async synthesize(request: TtsRequest): Promise<TtsResult> {
      if (!apiKey.trim()) {
        throw new Error('타입캐스트 API 키가 없습니다. 환경설정 → AI 키에서 타입캐스트 키를 입력하세요.')
      }
      if (!request.refAudio.startsWith(TYPECAST_VOICE_PREFIX)) {
        throw new Error(`타입캐스트 목소리가 아닙니다: ${request.refAudio} (typecast:<voice_id> 형식이어야 합니다)`)
      }
      const voiceId = typecastVoiceId(request.refAudio)
      const language = LANGUAGE_CODES[request.language.trim().toLowerCase()] ?? 'kor'

      const results: TtsItemResult[] = []
      for (let index = 0; index < request.items.length; index++) {
        const item = request.items[index] as TtsRequest['items'][number]
        const audio = await synthesizeOne({
          apiBase,
          apiKey,
          model,
          voiceId,
          language,
          text: item.text,
          previousText: request.items[index - 1]?.text,
          nextText: request.items[index + 1]?.text,
        })
        await mkdir(dirname(item.out), { recursive: true })
        await writeFile(item.out, audio)
        results.push({ out: item.out, durationSec: wavDurationSec(audio) })
        request.onProgress?.(index + 1, request.items.length)
      }
      return { ok: true, device: 'typecast-api', results }
    },
  }
}
