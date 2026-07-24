import { join } from 'node:path'
import { writeFile, mkdir } from 'node:fs/promises'
import { runFfmpeg, escapeFilterPath } from './ffmpeg.js'
import { captionDrawtextParams, captionYExpression } from './captionStyle.js'
import { stickerFilter } from './sticker.js'
import { wrapText } from '../utils/text.js'
import type { CaptionSegment } from '../captions/timeline.js'
import type { CaptionStyle, Sticker } from '../config/schema.js'

export interface RenderVariantOptions {
  /** Normalized and concatenated base video path. */
  basePath: string
  captions: CaptionSegment[]
  captionStyle?: CaptionStyle
  stickers?: Sticker[]
  bgmPath?: string
  bgmVolume: number
  narrationPath?: string
  narrationVolume?: number
  originalVolume?: number
  fontPath: string
  /** Final output path. */
  outPath: string
  /** Temporary work directory for this variant. */
  workDir: string
  height: number
}

function sec(value: number): string {
  return Math.max(0, value).toFixed(3)
}

function fontSize(kind: CaptionSegment['kind']): number {
  if (kind === 'hook') return 54
  if (kind === 'disclosure') return 34
  if (kind === 'cta') return 48
  return 46
}

interface AudioMixFilterOptions {
  videoFilter: string
  narrationInput?: number
  narrationVolume?: number
  originalVolume?: number
  bgmInput?: number
  bgmVolume?: number
}

/** FFmpeg 입력 번호를 받아 원본·나레이션·BGM 믹스 필터를 결정론적으로 만든다. */
export function buildAudioMixFilter(options: AudioMixFilterOptions): string {
  const originalVolume = options.originalVolume ?? (options.narrationInput === undefined ? 1 : 0.2)
  const chains = [
    `[0:v]${options.videoFilter}[v]`,
    `[0:a]volume=${originalVolume.toFixed(3)}[original]`,
  ]
  const audioLabels = ['[original]']
  if (options.narrationInput !== undefined) {
    chains.push(
      `[${options.narrationInput}:a]apad,volume=${(options.narrationVolume ?? 1).toFixed(3)}[narration]`,
    )
    audioLabels.push('[narration]')
  }
  if (options.bgmInput !== undefined) {
    chains.push(`[${options.bgmInput}:a]volume=${(options.bgmVolume ?? 0.18).toFixed(3)}[bgm]`)
    audioLabels.push('[bgm]')
  }
  chains.push(
    `${audioLabels.join('')}amix=inputs=${audioLabels.length}:duration=first:dropout_transition=2[a]`,
  )
  return chains.join(';')
}

async function captionFilter(
  caption: CaptionSegment,
  index: number,
  fontPath: string,
  height: number,
  workDir: string,
  style: CaptionStyle,
): Promise<string> {
  const file = `caption_${String(index).padStart(2, '0')}.txt`
  const maxPerLine = caption.kind === 'disclosure' ? 24 : 18
  await writeFile(join(workDir, file), wrapText(caption.text, maxPerLine), 'utf8')
  const fontEsc = escapeFilterPath(fontPath)
  return [
    `drawtext=fontfile='${fontEsc}'`,
    `textfile=${file}`,
    ...captionDrawtextParams(style, caption.kind),
    `fontsize=${fontSize(caption.kind)}`,
    'line_spacing=12',
    'x=(w-text_w)/2',
    `y=${captionYExpression(caption.position, height)}`,
    `enable='between(t,${sec(caption.start)},${sec(caption.end)})'`,
  ].join(':')
}

export async function renderVariant(opts: RenderVariantOptions): Promise<void> {
  await mkdir(opts.workDir, { recursive: true })

  const filters = await Promise.all(
    opts.captions.map((caption, index) =>
      captionFilter(caption, index, opts.fontPath, opts.height, opts.workDir, opts.captionStyle ?? 'basic'),
    ),
  )
  const stickerFilters = await Promise.all(
    (opts.stickers ?? []).map((sticker, index) =>
      stickerFilter(sticker, index, opts.fontPath, opts.height, opts.workDir),
    ),
  )

  const videoFilter = [...filters, ...stickerFilters].join(',')

  if (opts.bgmPath || opts.narrationPath) {
    const args = ['-y', '-i', opts.basePath]
    let nextInput = 1
    const narrationInput = opts.narrationPath ? nextInput++ : undefined
    if (opts.narrationPath) args.push('-i', opts.narrationPath)
    const bgmInput = opts.bgmPath ? nextInput++ : undefined
    if (opts.bgmPath) args.push('-stream_loop', '-1', '-i', opts.bgmPath)
    const audioMixFilter = buildAudioMixFilter({
      videoFilter,
      narrationInput,
      narrationVolume: opts.narrationVolume,
      originalVolume: opts.originalVolume,
      bgmInput,
      bgmVolume: opts.bgmVolume,
    })
    await runFfmpeg(
      [
        ...args,
        '-filter_complex',
        audioMixFilter,
        '-map',
        '[v]',
        '-map',
        '[a]',
        '-c:v',
        'libx264',
        '-preset',
        'veryfast',
        '-pix_fmt',
        'yuv420p',
        '-c:a',
        'aac',
        '-shortest',
        '-movflags',
        '+faststart',
        opts.outPath,
      ],
      { cwd: opts.workDir },
    )
    return
  }

  await runFfmpeg(
    [
      '-y',
      '-i',
      opts.basePath,
      '-vf',
      videoFilter,
      '-c:v',
      'libx264',
      '-preset',
      'veryfast',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-movflags',
      '+faststart',
      opts.outPath,
    ],
    { cwd: opts.workDir },
  )
}
