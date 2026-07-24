/**
 * CLI 출력 전용 로거. 콘솔 출력은 이 도구의 결과물이므로 여기서만 console을 사용하고,
 * 나머지 코드는 logger를 통해서만 출력한다.
 */
const ANSI = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const

const useColor = process.stdout.isTTY && process.env.NO_COLOR === undefined

function paint(color: keyof typeof ANSI, text: string): string {
  return useColor ? `${ANSI[color]}${text}${ANSI.reset}` : text
}

export const logger = {
  info: (msg: string): void => console.log(msg),
  step: (msg: string): void => console.log(`${paint('cyan', '▸')} ${msg}`),
  success: (msg: string): void => console.log(`${paint('green', '✓')} ${msg}`),
  warn: (msg: string): void => console.log(`${paint('yellow', '⚠')} ${msg}`),
  error: (msg: string): void => console.error(`${paint('red', '✗')} ${msg}`),
  dim: (msg: string): void => console.log(paint('gray', msg)),
}
