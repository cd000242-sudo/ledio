/**
 * 한글/공백 기준 단순 줄바꿈. drawtext/자막에서 한 줄이 너무 길어지지 않게 한다.
 * 어절(공백) 단위로 채우되, 한 어절이 maxPerLine보다 길면 강제로 끊는다.
 */
export function wrapText(text: string, maxPerLine = 18): string {
  const words = text.trim().split(/\s+/)
  const lines: string[] = []
  let cur = ''

  const len = (s: string): number => [...s].length

  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word
    if (cur && len(candidate) > maxPerLine) {
      lines.push(cur)
      cur = word
    } else {
      cur = candidate
    }
    // 한 단어가 한 줄보다 길면 강제 분할
    while (len(cur) > maxPerLine) {
      const arr = [...cur]
      lines.push(arr.slice(0, maxPerLine).join(''))
      cur = arr.slice(maxPerLine).join('')
    }
  }
  if (cur) lines.push(cur)
  return lines.join('\n')
}
