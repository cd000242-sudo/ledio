export interface Cue {
  startMs: number
  endMs: number
  text: string
}

/** "HH:MM:SS,mmm" 또는 "HH:MM:SS.mmm" → 밀리초 */
export function parseTimestamp(ts: string): number {
  const m = ts.trim().match(/^(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})$/)
  if (!m) throw new Error(`잘못된 타임스탬프: ${ts}`)
  const [, h, mm, s, ms] = m
  return (
    ((Number(h) * 60 + Number(mm)) * 60 + Number(s)) * 1000 + Number((ms as string).padEnd(3, '0'))
  )
}

/** 밀리초 → "HH:MM:SS,mmm" */
export function formatTimestamp(ms: number): string {
  const clamped = Math.max(0, Math.round(ms))
  const p = (n: number, w: number): string => String(n).padStart(w, '0')
  const h = Math.floor(clamped / 3_600_000)
  const m = Math.floor((clamped % 3_600_000) / 60_000)
  const s = Math.floor((clamped % 60_000) / 1000)
  const milli = clamped % 1000
  return `${p(h, 2)}:${p(m, 2)}:${p(s, 2)},${p(milli, 3)}`
}

/** 선행 BOM 제거 */
function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s
}

/** SRT 문자열을 큐 배열로 파싱한다. 인덱스 줄은 선택적으로 허용. */
export function parseSrt(content: string): Cue[] {
  const blocks = stripBom(content).replace(/\r\n/g, '\n').trim().split(/\n{2,}/)
  const cues: Cue[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    let i = 0
    if (/^\d+$/.test((lines[0] ?? '').trim())) i = 1
    const timeLine = lines[i]
    if (!timeLine) continue
    const tm = timeLine.match(/(\S+)\s*-->\s*(\S+)/)
    if (!tm) continue
    const startMs = parseTimestamp(tm[1] as string)
    const endMs = parseTimestamp(tm[2] as string)
    const text = lines
      .slice(i + 1)
      .join(' ')
      .trim()
    cues.push({ startMs, endMs, text })
  }
  return cues
}

/** 큐 배열을 표준 SRT 문자열로 직렬화한다(인덱스 1부터 재부여). */
export function serializeSrt(cues: Cue[]): string {
  const body = cues
    .map(
      (c, idx) =>
        `${idx + 1}\n${formatTimestamp(c.startMs)} --> ${formatTimestamp(c.endMs)}\n${c.text}`,
    )
    .join('\n\n')
  return `${body}\n`
}
