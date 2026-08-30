/**
 * 구독 한도 · 예산 상한 — 에이전트 CLI가 멈춘 이유를 사용자 말로 바꾼다.
 *
 * 배경: 앱은 사용자가 설치한 Claude Code CLI를 빌려 쓰므로 토큰 값은 안 나가지만,
 * 대신 **사용자의 구독 한도**를 태운다. 그런데 남은 한도를 미리 조회하는 공식 경로가 없다
 * (`/usage`는 대화형 슬래시 커맨드라 `-p` 모드에서 못 쓰고, `claude usage` CLI 요청은
 * anthropics/claude-code#40395에서 not planned로 닫혔다).
 *
 * 그래서 앱이 할 수 있는 일은 두 가지뿐이고, 이 파일이 둘 다 담당한다.
 *   ① 호출마다 `--max-budget-usd` 상한을 걸어 한 번의 사고가 주간 한도를 통째로 태우지 않게 한다.
 *   ② 멈춘 뒤에는 어느 한도인지 구분해 "기다려야 하는지, 모델만 바꾸면 되는지"를 알려준다.
 */

/** 상한 기본값(달러). 실측 기준 대화 1턴이 $0.03 수준이라 사고 방지용으로만 넉넉히 잡는다. */
export const DEFAULT_BUDGET_USD = {
  /** 대본 생성·자막 보정 같은 단발 호출 1회 */
  call: 1,
  /** 비서 패널 대화 1세션(여러 턴 + 도구 호출) */
  session: 5,
}

/**
 * 환경변수로 상한을 덮어쓴다. `0`이나 `off`면 상한 없음(빈 값 반환).
 * 숫자가 아니면 조용히 기본값으로 돌아간다 — 오타 때문에 앱이 멈추는 쪽이 더 나쁘다.
 */
export function resolveBudgetUsd(rawValue, fallback) {
  const raw = String(rawValue ?? '').trim()
  if (!raw) return fallback
  if (/^(off|none|0|0\.0+)$/i.test(raw)) return null
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

/**
 * `--max-budget-usd` 인자를 만든다. print 모드(`-p`) 전용 플래그이므로 호출부는 전부 `-p`여야 한다.
 * 상한이 없으면 빈 배열 — 인자 배열에 그대로 펼쳐 넣을 수 있다.
 */
export function budgetArgs(limitUsd) {
  if (!Number.isFinite(limitUsd) || limitUsd <= 0) return []
  return ['--max-budget-usd', String(limitUsd)]
}

/**
 * 한도 종류별 안내. `switchable`은 모델만 바꾸면 계속 쓸 수 있다는 뜻.
 *
 * ⚠️ 이 문구들은 공식 문서 기준이고 **실측이 아니다** — 재현하려면 실제로 한도를 소진해야 한다.
 * 빗나가도 호출부가 기존 오류 문구로 떨어질 뿐이라 동작은 깨지지 않는다.
 * 실제 한도 오류를 보게 되면 원문을 남기고 여기 정규식과 대조할 것.
 */
const LIMIT_RULES = [
  {
    kind: 'budget',
    test: /budget limit reached/i,
    switchable: false,
    message: '이번 작업이 앱에 설정된 비용 상한에 닿아 멈췄습니다. 작업을 나눠서 다시 시도하세요.',
  },
  {
    kind: 'session',
    test: /hit your session limit/i,
    switchable: false,
    message: 'Claude 5시간 사용 한도를 다 쓰셨습니다. 한도가 풀릴 때까지 기다려야 합니다.',
  },
  {
    kind: 'weekly',
    test: /hit your weekly limit/i,
    switchable: false,
    message: 'Claude 주간 사용 한도를 다 쓰셨습니다. 한도가 풀릴 때까지 기다려야 합니다.',
  },
  {
    kind: 'model',
    test: /hit your (opus|sonnet|haiku) limit/i,
    switchable: true,
    message: '이 모델의 사용 한도를 다 쓰셨습니다. 환경설정에서 다른 모델로 바꾸면 계속 쓸 수 있습니다.',
  },
]

/**
 * CLI 출력에서 한도·예산 때문에 멈췄는지 판별한다.
 *
 * 리셋 시각은 CLI 메시지 안에 들어오는데 형식을 고정으로 보장할 수 없어 파싱하지 않는다.
 * 대신 원문을 `detail`로 함께 넘겨 화면이 그대로 보여주게 한다 — 잘못 파싱한 시각보다 낫다.
 */
export function classifyLimitError(text) {
  const raw = String(text ?? '')
  if (!raw.trim()) return null
  const rule = LIMIT_RULES.find((candidate) => candidate.test.test(raw))
  if (!rule) return null
  return {
    kind: rule.kind,
    switchable: rule.switchable,
    message: rule.message,
    detail: raw.trim().slice(0, 300),
  }
}

/**
 * 한도 오류면 사용자용 문장으로, 아니면 원문 그대로 돌려준다.
 * 호출부가 `throw new Error(describeAgentFailure(...))` 한 줄로 끝낼 수 있게 만든 형태다.
 */
export function describeAgentFailure(text, fallbackMessage) {
  const limit = classifyLimitError(text)
  if (limit) return `${limit.message}\n\n(원문: ${limit.detail})`
  return fallbackMessage
}
