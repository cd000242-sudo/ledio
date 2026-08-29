import { execa } from 'execa'
import { access } from 'node:fs/promises'
import { buildBurnArgs, burnedOutputName, type BurnMode } from '../../video/burnCaptions.js'
import { logger } from '../../utils/logger.js'

export interface BurnCaptionsOptions {
  srt: string
  out?: string
  mode?: string
  fontSize?: string
  marginV?: string
  crf?: string
  json?: boolean
}

function numberOption(value: string | undefined): number | undefined {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** 완성 영상에 자막을 넣는다 — 태워넣기(burn) 또는 자막 트랙(mux). */
export async function runBurnCaptions(videoPath: string, options: BurnCaptionsOptions): Promise<number> {
  try {
    await access(videoPath)
    await access(options.srt)
    const mode: BurnMode = options.mode === 'mux' ? 'mux' : 'burn'
    const outPath = options.out ?? burnedOutputName(videoPath, mode)
    const args = buildBurnArgs({
      videoPath,
      srtPath: options.srt,
      outPath,
      mode,
      crf: numberOption(options.crf),
      style: { fontSize: numberOption(options.fontSize), marginV: numberOption(options.marginV) },
    })

    const result = await execa('ffmpeg', args, { timeout: 1000 * 60 * 120, reject: false })
    if (result.exitCode !== 0) {
      const detail = String(result.stderr ?? '').trim().split('\n').slice(-4).join('\n')
      throw new Error(`자막 넣기 실패(ffmpeg ${result.exitCode}):\n${detail}`)
    }

    if (options.json) {
      console.log(JSON.stringify({ ok: true, videoPath, srtPath: options.srt, outPath, mode }, null, 2))
    } else {
      logger.success(`자막을 넣었습니다: ${outPath}`)
    }
    return 0
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (options.json) console.log(JSON.stringify({ ok: false, error: message }, null, 2))
    else logger.error(message)
    return 1
  }
}
