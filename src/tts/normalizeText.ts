/**
 * TTS 오독 방지용 텍스트 정규화.
 * 예: "1103호"를 모델이 "일백삼호"로 잘못 읽는 문제 → "천백삼 호"로 미리 풀어쓴다.
 */

const DIGITS = ['', '일', '이', '삼', '사', '오', '육', '칠', '팔', '구']
const SMALL_UNITS = ['', '십', '백', '천']
const BIG_UNITS = ['', '만', '억', '조']

function fourDigitsToKorean(value: number): string {
  let result = ''
  for (let place = 3; place >= 0; place--) {
    const digit = Math.floor(value / 10 ** place) % 10
    if (digit === 0) continue
    // 일십/일백/일천은 십/백/천으로 읽는다 (일은 자리 없는 경우만)
    result += (digit === 1 && place > 0 ? '' : (DIGITS[digit] ?? '')) + (SMALL_UNITS[place] ?? '')
  }
  return result
}

/** 0~9999조 범위의 정수를 한자어 읽기로 바꾼다. */
export function numberToSinoKorean(value: number): string {
  if (!Number.isFinite(value) || value < 0) return String(value)
  if (value === 0) return '영'
  let rest = Math.floor(value)
  const parts: string[] = []
  let bigIndex = 0
  while (rest > 0 && bigIndex < BIG_UNITS.length) {
    const group = rest % 10000
    if (group > 0) {
      const groupText = fourDigitsToKorean(group)
      // 일만은 만으로 읽는다
      const cleaned = bigIndex > 0 && groupText === '일' ? '' : groupText
      parts.unshift(cleaned + (BIG_UNITS[bigIndex] ?? ''))
    }
    rest = Math.floor(rest / 10000)
    bigIndex += 1
  }
  return parts.join('')
}

// 숫자를 한자어로 읽는 단위들 (시/분/개 등 고유어 단위는 모델이 알아서 잘 읽으므로 제외)
const SINO_COUNTERS = '호|동|층|번지|번길|호선|호실|킬로|미터|원|명|년|월|일'

/** TTS에 넣기 전 오독 위험 숫자를 한국어로 풀어쓴다. */
export function normalizeTtsText(text: string): string {
  let result = text
  // 1) 단위가 붙은 숫자: "1103호" → "천백삼 호"
  result = result.replace(new RegExp(`(\\d{2,})(${SINO_COUNTERS})`, 'g'), (_match, num: string, counter: string) => {
    return `${numberToSinoKorean(Number(num))} ${counter}`
  })
  // 2) 단위 없는 3자리 이상 숫자(시각 표현 "N시 N분"은 제외)
  result = result.replace(/(\d{3,})(?![분초시\d])/g, (match, num: string) => {
    return numberToSinoKorean(Number(num))
  })
  return result
}
