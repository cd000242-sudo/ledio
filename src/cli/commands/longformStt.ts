import { access, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { runWhisperx } from '../../captions/whisperx.js'
import { logger } from '../../utils/logger.js'

export interface LongformSttOptions {
  model?: string
  language?: string
  computeType?: string
  outDir?: string
  json?: boolean
}

/**
 * 롱폼 자막 1단계 — 영상·음성 파일을 WhisperX로 받아써서 **가장 세밀한** 큐를 만든다.
 * 문장 길이로 합치는 일과 대본 대조 보정은 서버가 이어서 한다.
 */
export async function runLongformStt(mediaPath: string, options: LongformSttOptions = {}): Promise<number> {
  try {
    await access(mediaPath)
    const outputDir = options.outDir ?? join(dirname(mediaPath), '.whisperx')
    await mkdir(outputDir, { recursive: true })

    const cues = await runWhisperx({
      mediaPath,
      outputDir,
      model: options.model,
      language: options.language,
      computeType: options.computeType,
    })

    if (options.json) {
      console.log(JSON.stringify({ ok: true, mediaPath, cueCount: cues.length, cues }, null, 2))
    } else {
      logger.step(`받아쓰기: ${mediaPath}`)
      logger.success(`${cues.length}개 큐(단어 단위) 생성`)
    }
    return cues.length > 0 ? 0 : 1
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (options.json) {
      console.log(JSON.stringify({ ok: false, error: message }, null, 2))
    } else {
      logger.error(message)
    }
    return 1
  }
}
