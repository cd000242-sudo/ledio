/**
 * 대본 구조 템플릿. 바이럴을 "보장"하는 게 아니라, 검증된 쇼츠 구조
 * (훅 → 전개 → 반전 → CTA)를 강제해 대본 품질의 바닥을 올리는 프레임이다.
 * 사용자가 {자리표시자}를 채우거나 문장을 다듬어 완성한다.
 */

export interface ScriptBeats {
  hook: string[]
  build: string[]
  twist: string[]
  cta: string[]
}

export interface ScriptTemplate {
  key: string
  label: string
  description: string
  beats: ScriptBeats
}

export const STORY_TEMPLATES: readonly ScriptTemplate[] = [
  {
    key: 'twist',
    label: '반전형',
    description: '평범하게 시작해 마지막에 뒤집는다. 미스터리/썰에 강함.',
    beats: {
      hook: ['{주제}, 처음엔 아무 일도 아닌 줄 알았습니다.'],
      build: ['{상황설명}.', '그런데 뭔가 이상했습니다. {이상한점}.'],
      twist: ['알고 보니 {반전내용}이었습니다.'],
      cta: ['다음 이야기가 궁금하다면 팔로우하고 기다려 주세요.'],
    },
  },
  {
    key: 'empathy',
    label: '공감형',
    description: '시청자의 경험을 정확히 찌르고 위로/해결로 끝낸다.',
    beats: {
      hook: ['{주제} 때문에 힘들었던 사람, 분명 나만이 아닐 겁니다.'],
      build: ['{공감상황1}.', '{공감상황2}. 다들 한 번쯤 겪어봤을 거예요.'],
      twist: ['그런데 관점을 바꾸니 달라졌습니다. {깨달음}.'],
      cta: ['비슷한 경험이 있다면 댓글로 남겨 주세요.'],
    },
  },
  {
    key: 'info',
    label: '정보형',
    description: '몰랐던 사실 하나를 확실하게 알려준다.',
    beats: {
      hook: ['{주제}에 대해 99%가 모르는 사실이 있습니다.'],
      build: ['보통은 {통념}이라고 알고 있죠.', '하지만 실제로는 {사실설명}.'],
      twist: ['핵심은 이겁니다. {핵심포인트}.'],
      cta: ['더 많은 정보는 팔로우하면 이어서 알려드립니다.'],
    },
  },
  {
    key: 'confession',
    label: '썰형',
    description: '1인칭 경험담. 몰입이 빠르고 체류시간이 길다.',
    beats: {
      hook: ['제가 직접 겪은 {주제} 이야기입니다.'],
      build: ['그날 {상황시작}.', '{전개내용}. 그때까진 몰랐습니다.'],
      twist: ['그 순간 {결정적사건}. 지금 생각해도 소름 돋습니다.'],
      cta: ['여러분이라면 어떻게 했을까요? 댓글로 알려주세요.'],
    },
  },
  {
    key: 'compare',
    label: '비교형',
    description: '두 선택지를 붙여놓고 승자를 가린다. 결정 피로를 대신 해결.',
    beats: {
      hook: ['{선택지A} vs {선택지B}, 뭐가 나을까요?'],
      build: ['{선택지A}의 장점은 {A장점}.', '{선택지B}는 {B장점}이 강합니다.'],
      twist: ['하지만 {기준}으로 보면 답은 명확합니다. {승자} 쪽입니다.'],
      cta: ['여러분의 선택은? 댓글로 투표해 주세요.'],
    },
  },
] as const

export function listScriptTemplates(): Array<Pick<ScriptTemplate, 'key' | 'label' | 'description'>> {
  return STORY_TEMPLATES.map(({ key, label, description }) => ({ key, label, description }))
}

function fill(line: string, vars: Record<string, string>): string {
  return line.replace(/\{([^}]+)\}/g, (_, name: string) => vars[name] ?? `{${name}}`)
}

/**
 * 유형 키와 변수로 대본 뼈대를 만든다. 채워지지 않은 {자리표시자}는
 * 그대로 남겨 사용자가 어디를 채워야 하는지 보이게 한다.
 */
export function buildScriptSkeleton(key: string, vars: Record<string, string>): string {
  const template = STORY_TEMPLATES.find((t) => t.key === key)
  if (!template) {
    throw new Error(`알 수 없는 대본 유형: ${key} (사용 가능: ${STORY_TEMPLATES.map((t) => t.key).join(', ')})`)
  }
  const lines = [
    ...template.beats.hook,
    ...template.beats.build,
    ...template.beats.twist,
    ...template.beats.cta,
  ]
  return lines.map((line) => fill(line, vars)).join('\n')
}
