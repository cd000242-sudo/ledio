import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { escapeFilterPath } from './ffmpeg.js'
import { wrapText } from '../utils/text.js'
import type { Sticker } from '../config/schema.js'

function sec(value: number): string {
  return Math.max(0, value).toFixed(3)
}

function yExpression(position: Sticker['position'], height: number): string {
  if (position === 'top') return String(Math.round(height * 0.08))
  if (position === 'center') return '(h-text_h)/2'
  // 하단 자막 영역(h-0.3h)과 겹치지 않게 그 위에 얹는다.
  return `h-${Math.round(height * 0.42)}`
}

/** 스티커 스타일(노란 굵은 글자 + 검정 테두리)과 표시 구간 파라미터. fontfile/textfile은 호출부에서 붙인다. */
export function stickerDrawtextParams(sticker: Sticker, height: number): string[] {
  return [
    'fontcolor=0xFFD400',
    'fontsize=58',
    'borderw=5',
    'bordercolor=black',
    'line_spacing=10',
    'x=(w-text_w)/2',
    `y=${yExpression(sticker.position, height)}`,
    `enable='between(t,${sec(sticker.start)},${sec(sticker.end)})'`,
  ]
}

/** 스티커 한 개를 drawtext 필터 문자열로 만든다(문구는 텍스트 파일로 우회해 이스케이프 문제를 피한다). */
export async function stickerFilter(
  sticker: Sticker,
  index: number,
  fontPath: string,
  height: number,
  workDir: string,
): Promise<string> {
  const file = `sticker_${String(index).padStart(2, '0')}.txt`
  await writeFile(join(workDir, file), wrapText(sticker.text, 12), 'utf8')
  const fontEsc = escapeFilterPath(fontPath)
  return [`drawtext=fontfile='${fontEsc}'`, `textfile=${file}`, ...stickerDrawtextParams(sticker, height)].join(':')
}
