import { copyFile, readFile, rename, rm, stat, writeFile, mkdir } from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import YAML from 'yaml'
import { logger } from '../../utils/logger.js'
import { resolveVoice } from '../../tts/voices.js'
import { createQwen3Provider } from '../../tts/qwen3Provider.js'
import { createMockProvider } from '../../tts/mockProvider.js'
import { createTypecastProvider, TYPECAST_VOICE_PREFIX } from '../../tts/typecastProvider.js'
import { splitNarrationText } from '../../tts/chunk.js'
import { chunkCacheKey, lookupChunk, pruneChunkCache, storeChunk } from '../../tts/chunkCache.js'
import {
  buildDeliveryChunks,
  buildDeliveryChunksForTexts,
  type DeliveryChunk,
  type DeliveryStep,
} from '../../tts/delivery.js'
import { buildStyledAudioFilter } from '../../tts/styleAudio.js'
import { normalizeTtsText } from '../../tts/normalizeText.js'
import { runFfmpeg } from '../../video/ffmpeg.js'
import type { TtsItem, TtsItemResult, TtsProvider, TtsResult } from '../../tts/provider.js'

export interface NarrateOptions {
  voice: string
  provider?: string
  language?: string
  outDir?: string
  model?: string
  /** 낭독 연출 계획 JSON 경로 — 문장별 {pace, pause} 배열(또는 {sentences:[...]}) */
  delivery?: string
}

/** 연출 계획 파일을 읽는다. 형식이 이상하면 null(기본 낭독으로 폴백). */
async function readDeliveryPlan(path: string): Promise<DeliveryStep[] | null> {
  try {
    const parsed = JSON.parse(await readFile(resolve(path), 'utf8')) as
      | DeliveryStep[]
      | { sentences?: DeliveryStep[] }
    const plan = Array.isArray(parsed) ? parsed : parsed?.sentences
    return Array.isArray(plan) && plan.length > 0 ? plan : null
  } catch {
    return null
  }
}

interface StoryboardScene {
  image?: string
  narration?: string
  caption?: string
  durationSec?: number
}

interface Storyboard {
  projectName?: string
  scenes?: StoryboardScene[]
  [key: string]: unknown
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

/**
 * 낭독 폴리싱 — 방송 오디오처럼 또렷하고 일정하게 만든다.
 * 저역 웅웅거림 제거 → 잔여 잡음 감쇠 → 컴프레서(음량 일정) → 존재감 EQ(명료도) → 라우드니스 표준화.
 */
async function polishNarrationWav(path: string): Promise<void> {
  const polished = `${path}.polish.wav`
  // 웅웅거림(200~400Hz 부밍)을 깎고, 하모닉 익사이터로 고역을 되살려 또렷하게 만든다.
  // 실측: Qwen3-TTS 출력은 2kHz 이상이 거의 없어(-57dB) EQ 부스트로는 선명해지지 않는다 —
  // 익사이터가 저역 배음에서 고역을 생성해야 한다 (+15dB 회복 실측).
  const chain = [
    'highpass=f=95',
    'equalizer=f=250:t=q:w=1.2:g=-4',
    'afftdn=nf=-28',
    'aexciter=amount=6:drive=8:freq=2500',
    'deesser',
    'acompressor=threshold=-18dB:ratio=3:attack=10:release=150:makeup=3',
    'loudnorm=I=-16:TP=-1.5:LRA=11',
  ].join(',')
  try {
    await runFfmpeg(['-y', '-i', path, '-af', chain, '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', polished])
    await rm(path, { force: true })
    const { rename } = await import('node:fs/promises')
    await rename(polished, path)
  } catch {
    // 폴리싱 실패는 낭독을 막지 않는다 — 원본 그대로 둔다.
    await rm(polished, { force: true })
  }
}

export function pickProvider(name: string | undefined, workspaceRoot: string): TtsProvider {
  if (name === 'mock') return createMockProvider()
  if (name === 'typecast') return createTypecastProvider()
  return createQwen3Provider({ workspaceRoot })
}

/** 스토리보드(장면별) 또는 텍스트 파일을 내 목소리 나레이션 wav로 만든다. */
export async function runNarrate(inputPath: string, options: NarrateOptions): Promise<number> {
  const workspaceRoot = process.cwd()
  const input = resolve(inputPath)
  const ext = extname(input).toLowerCase()

  // typecast:<voice_id> 목소리는 파일이 아니라 클라우드 성우 — 파일 해석을 건너뛴다.
  const isTypecastVoice =
    options.voice.startsWith(TYPECAST_VOICE_PREFIX) || options.provider === 'typecast'
  let voice
  if (isTypecastVoice) {
    voice = {
      refAudio: options.voice.startsWith(TYPECAST_VOICE_PREFIX)
        ? options.voice
        : `${TYPECAST_VOICE_PREFIX}${options.voice}`,
      refText: undefined,
    }
  } else {
    try {
      voice = await resolveVoice(workspaceRoot, options.voice)
    } catch (err) {
      logger.error((err as Error).message)
      return 1
    }
    if (!voice.refText) {
      logger.warn('목소리 전사(.txt)가 없어 x-vector 모드로 진행합니다(품질 약간 낮음).')
    }
  }

  const provider = pickProvider(isTypecastVoice ? 'typecast' : options.provider, workspaceRoot)
  const language = options.language ?? 'Korean'

  let raw: string
  try {
    raw = await readFile(input, 'utf8')
  } catch {
    logger.error(`입력 파일을 찾을 수 없습니다: ${inputPath}`)
    return 1
  }

  const isStoryboard = ext === '.yaml' || ext === '.yml'
  const outDir = options.outDir
    ? resolve(options.outDir)
    : join(dirname(input), 'narration')

  let items: TtsItem[]
  let storyboard: Storyboard | null = null
  let textFinalOut = ''
  let textChunked = false
  let deliveryChunks: DeliveryChunk[] | null = null

  if (isStoryboard) {
    storyboard = YAML.parse(raw) as Storyboard
    const scenes = storyboard.scenes ?? []
    const narrated = scenes
      .map((scene, index) => ({ scene, index }))
      .filter(({ scene }) => (scene.narration ?? '').trim())
    if (narrated.length === 0) {
      logger.error('스토리보드에 narration이 있는 장면이 없습니다.')
      return 1
    }
    items = narrated.map(({ scene, index }) => ({
      text: normalizeTtsText((scene.narration as string).trim()),
      out: join(outDir, `narration_${pad2(index + 1)}.wav`),
    }))
    if (options.delivery) {
      const plan = await readDeliveryPlan(options.delivery)
      if (plan) {
        deliveryChunks = buildDeliveryChunksForTexts(items.map((item) => item.text), plan)
        logger.dim(`  장면별 낭독 연출 적용 — ${deliveryChunks.length}개 장면.`)
      } else {
        logger.warn('연출 계획을 읽지 못해 기본 낭독으로 진행합니다.')
      }
    }
  } else {
    const text = normalizeTtsText(raw.trim())
    if (!text) {
      logger.error('입력 텍스트가 비어 있습니다.')
      return 1
    }
    // 통째로 한 번에 생성하면 수 분씩 걸리고 토큰 한도에 잘릴 수 있다.
    // 문장 덩어리로 나눠 생성하고 마지막에 하나의 wav로 이어 붙인다.
    if (options.delivery) {
      const plan = await readDeliveryPlan(options.delivery)
      if (plan) {
        deliveryChunks = buildDeliveryChunks(text, plan)
        logger.dim(`  낭독 연출 적용 — ${deliveryChunks.length}개 조각(완급·쉼 조절).`)
      } else {
        logger.warn('연출 계획을 읽지 못해 기본 낭독으로 진행합니다.')
      }
    }
    const chunks = deliveryChunks?.map((chunk) => chunk.text) ?? splitNarrationText(text)
    textFinalOut = join(outDir, `${basename(input, ext)}.wav`)
    if (chunks.length === 1 && !deliveryChunks) {
      items = [{ text, out: textFinalOut }]
    } else {
      if (!deliveryChunks) logger.dim(`  긴 대본 — ${chunks.length}개 덩어리로 나눠 생성합니다.`)
      // 실행마다 고유한 조각 이름을 써서 동시 실행이 서로의 파일을 덮어쓰지 않게 한다.
      const runId = `${Date.now().toString(36)}-${process.pid}`
      items = chunks.map((chunk, index) => ({
        text: chunk,
        out: join(outDir, `${basename(input, ext)}.${runId}.part${pad2(index + 1)}.wav`),
      }))
      textChunked = true
    }
  }

  logger.step(`나레이션 생성: ${items.length}개 (provider: ${provider.name})`)
  logger.dim(`  목소리: ${voice.refAudio}${voice.refText ? ' (+전사)' : ''}`)

  // 텍스트 모드 진행 파일 — UI 게이지바가 폴링한다. 기록 실패는 낭독을 막지 않는다.
  const progressPath = textFinalOut ? `${textFinalOut}.progress.json` : ''
  const writeNarrateProgress = async (data: Record<string, unknown>) => {
    if (!progressPath) return
    try {
      await writeFile(progressPath, JSON.stringify({ ...data, updatedAt: new Date().toISOString() }), 'utf8')
    } catch {
      // 진행 표시는 부가 기능
    }
  }
  await mkdir(outDir, { recursive: true })

  // 덩어리 캐시 — 이미 만든 문장은 재생성하지 않는다.
  // 긴 낭독이 도중에 실패해도 재시도하면 없는 덩어리만 다시 만들고,
  // 대본을 일부만 고친 재낭독도 바뀐 문장만 새로 만든다.
  const cacheDir = join(workspaceRoot, 'tmp', 'tts-cache')
  let voiceSignature = ''
  if (isTypecastVoice) {
    // 클라우드 성우는 파일 정보가 없다 — 성우 id 자체가 서명이다.
    voiceSignature = voice.refAudio
  } else {
    try {
      const info = await stat(voice.refAudio)
      voiceSignature = `${voice.refAudio}|${info.size}|${Math.round(info.mtimeMs)}|${voice.refText ?? ''}`
    } catch {
      voiceSignature = ''
    }
  }

  const cachedResults: TtsItemResult[] = []
  let toGenerate: TtsItem[] = items
  if (voiceSignature) {
    toGenerate = []
    for (const item of items) {
      const hit = await lookupChunk(cacheDir, chunkCacheKey(voiceSignature, item.text))
      if (hit) {
        await mkdir(dirname(item.out), { recursive: true })
        await copyFile(hit.wavPath, item.out)
        cachedResults.push({ out: item.out, durationSec: hit.durationSec })
      } else {
        toGenerate.push(item)
      }
    }
    if (cachedResults.length > 0) {
      logger.dim(`  캐시 재사용: ${cachedResults.length}/${items.length} 덩어리 (새로 만들 것: ${toGenerate.length}개)`)
    }
  }

  await writeNarrateProgress({ status: 'running', done: 0, total: toGenerate.length })

  let result: TtsResult = { ok: true, device: 'cache', results: [] }
  if (toGenerate.length > 0) {
    try {
      result = await provider.synthesize({
        refAudio: voice.refAudio,
        refText: voice.refText,
        language,
        items: toGenerate,
        onProgress: (done, total) => {
          void writeNarrateProgress({ status: 'running', done, total })
        },
      })
    } catch (err) {
      await writeNarrateProgress({ status: 'error', error: (err as Error).message })
      logger.error((err as Error).message)
      return 1
    }
    // 새로 만든 덩어리를 캐시에 저장한다(완급 변환 전 원본 기준).
    if (voiceSignature) {
      for (const generated of result.results) {
        const item = toGenerate.find((candidate) => candidate.out === generated.out)
        if (item) {
          await storeChunk(cacheDir, chunkCacheKey(voiceSignature, item.text), generated.out, generated.durationSec)
        }
      }
      await pruneChunkCache(cacheDir)
    }
  }
  result = { ...result, results: [...cachedResults, ...result.results] }

  // 캐시는 원본 음성을 보존하고, 매 실행에서 선택한 말투만 별도로 입힌다.
  if (deliveryChunks) {
    const durationByOut = new Map(result.results.map((entry) => [entry.out, entry.durationSec]))
    for (let index = 0; index < items.length; index++) {
      const item = items[index] as TtsItem
      const delivery = deliveryChunks[index] ?? { text: item.text, pace: 1, pauseAfter: 0.25 }
      const styledOut = item.out.replace(/\.wav$/i, '.styled.wav')
      const originalDuration = durationByOut.get(item.out) ?? 1
      const styled = buildStyledAudioFilter(delivery, originalDuration)
      const filterArgs = styled.kind === 'complex'
        ? ['-filter_complex', styled.filter, '-map', '[out]']
        : ['-filter:a', styled.filter]
      await runFfmpeg([
        '-y', '-i', item.out, ...filterArgs,
        '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le', styledOut,
      ])
      await rm(item.out, { force: true })
      await rename(styledOut, item.out)
      durationByOut.set(item.out, originalDuration / Math.max(0.01, delivery.pace))
    }
    result = {
      ...result,
      results: result.results.map((entry) => ({
        ...entry,
        durationSec: durationByOut.get(entry.out) ?? entry.durationSec,
      })),
    }
  }

  // 텍스트 모드에서 덩어리로 나눴다면 하나의 wav로 이어 붙인다.
  // 덩어리 사이에 무음(호흡)을 넣어 문장이 급하게 끝나는 느낌을 줄인다.
  // 연출 계획이 있으면 조각별 배속(atempo)과 조각별 쉼 길이를 적용한다.
  if (textChunked && textFinalOut) {
    await writeNarrateProgress({ status: 'merging', done: items.length, total: items.length })
    const baseName = items[0]?.out ?? join(outDir, 'narration')
    // 쉼 길이별 무음 파일을 하나씩만 만들어 재사용한다.
    const pauseFor = (index: number) => deliveryChunks?.[index]?.pauseAfter ?? 0.25
    const silenceByDur = new Map<number, string>()
    for (let index = 0; index < items.length - 1; index++) {
      const dur = pauseFor(index)
      if (silenceByDur.has(dur)) continue
      const silencePath = `${baseName}.silence-${dur.toFixed(2)}.wav`
      await runFfmpeg([
        '-y', '-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono',
        '-t', dur.toFixed(2), '-c:a', 'pcm_s16le', silencePath,
      ])
      silenceByDur.set(dur, silencePath)
    }

    const escapePath = (p: string) => p.replace(/\\/g, '/').replace(/'/g, "'\\''")
    const listLines: string[] = []
    items.forEach((item, index) => {
      listLines.push(`file '${escapePath(item.out)}'`)
      const silencePath = index < items.length - 1 ? silenceByDur.get(pauseFor(index)) : undefined
      if (silencePath) listLines.push(`file '${escapePath(silencePath)}'`)
    })
    const listPath = `${baseName}.concat.txt`
    await writeFile(listPath, listLines.join('\n'), 'utf8')
    await runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', textFinalOut])
    await rm(listPath, { force: true })
    for (const path of silenceByDur.values()) await rm(path, { force: true })
    for (const item of items) await rm(item.out, { force: true })
    logger.dim(
      deliveryChunks
        ? `  ${items.length}개 조각을 말투 연출(완급·쉼·피치·강도·끝음)대로 합쳤습니다: ${textFinalOut}`
        : `  ${items.length}개 덩어리를 호흡 간격과 함께 합쳤습니다: ${textFinalOut}`,
    )
  }

  // 최종 낭독 폴리싱 — 또렷한 목소리와 일정한 음량(방송 기준)으로 다듬는다.
  // 폴리싱 체인은 Qwen3 출력(고역 부재)에 맞춘 것 — 타입캐스트는 이미 방송 품질이라 건너뛴다.
  if (!isTypecastVoice) {
    if (textFinalOut) {
      await polishNarrationWav(textFinalOut)
    } else if (storyboard) {
      for (const generated of result.results) await polishNarrationWav(generated.out)
    }
  }

  // 스토리보드 모드: 나레이션 길이를 장면 길이에 반영한 사본을 만든다.
  let narratedStoryboardPath: string | null = null
  if (storyboard) {
    const durByOut = new Map(result.results.map((r) => [r.out, r.durationSec]))
    const scenes = storyboard.scenes ?? []
    let itemIndex = 0
    const nextScenes = scenes.map((scene, index) => {
      if (!(scene.narration ?? '').trim()) return scene
      const out = items[itemIndex]?.out
      itemIndex += 1
      const durationSec = out !== undefined ? durByOut.get(out) : undefined
      return durationSec === undefined
        ? scene
        : {
            ...scene,
            durationSec: Math.max(2, Math.ceil(durationSec * 10) / 10),
            narrationAudio: `narration/narration_${pad2(index + 1)}.wav`,
          }
    })
    narratedStoryboardPath = join(dirname(input), `${basename(input, ext)}.narrated${ext}`)
    await writeFile(
      narratedStoryboardPath,
      YAML.stringify({ ...storyboard, scenes: nextScenes }),
      'utf8',
    )
  }

  await mkdir(outDir, { recursive: true })
  const reportPath = join(outDir, 'narration_report.json')
  await writeFile(
    reportPath,
    JSON.stringify(
      {
        provider: provider.name,
        device: result.device,
        language,
        refAudio: voice.refAudio,
        refTextUsed: Boolean(voice.refText),
        narratedStoryboard: narratedStoryboardPath,
        cachedCount: cachedResults.length,
        items: result.results,
      },
      null,
      2,
    ),
    'utf8',
  )

  await writeNarrateProgress({ status: 'done', done: items.length, total: items.length })
  const total = result.results.reduce((sum, r) => sum + r.durationSec, 0)
  logger.success(`완료: 음성 ${result.results.length}개 (총 ${total.toFixed(1)}s) → ${outDir}`)
  if (narratedStoryboardPath) logger.dim(`  길이 반영 스토리보드: ${narratedStoryboardPath}`)
  return 0
}
