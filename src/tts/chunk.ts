/**
 * 긴 낭독 텍스트를 문장 경계에서 덩어리로 나눈다.
 * 통째로 생성하면 한 번의 생성이 수 분씩 걸리고 토큰 한도에 잘릴 수 있어,
 * 덩어리별로 생성한 뒤 이어 붙이는 방식이 빠르고 안정적이다.
 */
/** 낭독 텍스트를 문장 단위로 나눈다(연출 계획의 문장 번호 기준과 동일해야 한다). */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？…]|다\.|요\.|죠\.)\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

export function splitNarrationText(text: string, maxChars = 120): string[] {
  const sentences = splitSentences(text)
  const chunks: string[] = []
  let current = ''
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (current && [...candidate].length > maxChars) {
      chunks.push(current)
      current = sentence
    } else {
      current = candidate
    }
  }
  if (current) chunks.push(current)
  return chunks.length > 0 ? chunks : [text.trim()]
}
