const ENDINGS = new Set(['neutral', 'fall', 'soft-fall', 'rise', 'crisp', 'linger'])

function style(id, group, label, description, instruction, defaults) {
  return { id, group, label, description, instruction, defaults }
}

export const NARRATION_STYLES = [
  style('natural', '기본', '자연스러운 낭독', '과장 없이 편안하고 또렷하게 읽습니다.', '실제 대화처럼 자연스럽고 균일하게 읽되 문장 끝은 부드럽게 정리한다.', { pace: 1, pause: 0.25, pitch: 0, gain: 0, ending: 'soft-fall' }),
  style('shopping-host', '판매·광고', '쇼호스트', '밝고 자신감 있게 혜택과 구매 포인트를 강조합니다.', '밝고 자신감 있는 쇼호스트처럼 상품명·가격·할인·혜택을 강하게 강조하고 CTA는 힘 있게 끊는다.', { pace: 1.1, pause: 0.16, pitch: 0.45, gain: 1.4, ending: 'crisp' }),
  style('live-commerce', '판매·광고', '라이브커머스', '시청자와 실시간으로 대화하듯 친근하게 말합니다.', '친근한 라이브커머스 진행자처럼 반응하고 질문하며 말한다. 혜택 문장은 들뜨게, 질문은 끝을 올린다.', { pace: 1.08, pause: 0.18, pitch: 0.35, gain: 1, ending: 'rise' }),
  style('urgent-sale', '판매·광고', '긴급특가', '마감과 한정 수량의 긴박감을 빠르게 전달합니다.', '시간 제한과 한정 혜택의 긴박감을 살려 짧고 빠르게 몰아치고 마지막 행동 문구는 단호하게 끊는다.', { pace: 1.18, pause: 0.08, pitch: 0.55, gain: 1.8, ending: 'crisp' }),
  style('premium-ad', '판매·광고', '프리미엄 광고', '낮고 여유 있는 고급 브랜드 광고처럼 읽습니다.', '고급 브랜드 광고처럼 절제되고 여유 있게 읽는다. 과장하지 말고 핵심 명사는 낮고 단정하게 마무리한다.', { pace: 0.92, pause: 0.38, pitch: -0.45, gain: 0.2, ending: 'fall' }),
  style('friendly-recommend', '판매·광고', '친근한 추천', '지인이 실제로 써보고 추천하듯 말합니다.', '친한 사람이 직접 써보고 솔직히 추천하듯 편안하게 말하고 장점은 살짝 힘을 주며 끝은 부드럽게 내린다.', { pace: 1.02, pause: 0.24, pitch: 0.1, gain: 0.4, ending: 'soft-fall' }),
  style('product-explainer', '판매·광고', '제품 설명', '기능과 사용법을 정확하고 이해하기 쉽게 전달합니다.', '제품 전문가처럼 기능·사용법·차이를 정확하게 설명하고 수치와 기능명 앞뒤에 짧은 쉼을 둔다.', { pace: 0.98, pause: 0.28, pitch: -0.1, gain: 0.3, ending: 'fall' }),
  style('shorts-energy', '숏폼·엔터', '고텐션 숏폼', '첫 문장부터 빠르고 강한 에너지로 주목을 잡습니다.', '숏폼 크리에이터처럼 첫 문장부터 에너지 있게 치고 들어가며 핵심 단어를 강하게 찍고 군더더기 없이 끊는다.', { pace: 1.16, pause: 0.1, pitch: 0.5, gain: 1.7, ending: 'crisp' }),
  style('storyteller', '숏폼·엔터', '이야기꾼', '대화하듯 몰입감 있게 이야기의 흐름을 살립니다.', '능숙한 이야기꾼처럼 장면과 감정의 흐름을 살리고 반전 전에는 뜸을 들이며 결말은 여운 있게 남긴다.', { pace: 1, pause: 0.3, pitch: 0, gain: 0.2, ending: 'linger' }),
  style('twist-tension', '숏폼·엔터', '반전·긴장', '긴장을 점점 높이고 반전 직전에 멈춥니다.', '초반은 차분하게 시작해 점점 빠르게 긴장을 쌓고 반전 직전에는 길게 멈춘 뒤 결말을 낮고 짧게 끝낸다.', { pace: 1.04, pause: 0.32, pitch: -0.15, gain: 0.7, ending: 'fall' }),
  style('horror-mystery', '숏폼·엔터', '공포·미스터리', '낮고 조용한 긴장감과 불길한 여운을 만듭니다.', '낮고 조심스럽게 속삭이듯 시작하고 불길한 단어 앞에서 멈춘다. 설명하지 말고 문장 끝을 낮춰 여운을 남긴다.', { pace: 0.9, pause: 0.48, pitch: -0.65, gain: -0.4, ending: 'linger' }),
  style('comedy', '숏폼·엔터', '코믹', '빠른 호흡과 타이밍으로 펀치라인을 살립니다.', '공감 개그처럼 경쾌하게 말하고 셋업은 빠르게, 펀치라인 직전에는 짧게 멈춘 뒤 또렷하게 끊는다.', { pace: 1.12, pause: 0.18, pitch: 0.35, gain: 0.9, ending: 'crisp' }),
  style('news', '정보·신뢰', '뉴스 앵커', '정확하고 중립적인 뉴스 전달 톤입니다.', '뉴스 앵커처럼 정확하고 객관적으로 읽는다. 숫자와 고유명사를 또렷하게 발음하고 문장 끝을 단정하게 내린다.', { pace: 1, pause: 0.25, pitch: -0.2, gain: 0.5, ending: 'fall' }),
  style('documentary', '정보·신뢰', '다큐멘터리', '차분하고 깊이 있는 관찰자 시점으로 읽습니다.', '다큐멘터리 내레이터처럼 차분하고 깊이 있게 읽고 중요한 사실 뒤에 충분한 쉼과 묵직한 여운을 둔다.', { pace: 0.9, pause: 0.42, pitch: -0.5, gain: 0.1, ending: 'linger' }),
  style('lecture', '정보·신뢰', '강의·설명', '핵심 개념을 구분하며 이해하기 쉽게 설명합니다.', '친절한 강사처럼 핵심 개념을 분명히 구분하고 단계가 바뀔 때 쉬어 간다. 중요한 단어는 천천히 또렷하게 말한다.', { pace: 0.96, pause: 0.32, pitch: 0, gain: 0.3, ending: 'fall' }),
  style('authoritative', '정보·신뢰', '전문가·권위', '낮고 확신 있는 전문가의 어조로 전달합니다.', '경험 많은 전문가처럼 낮고 확신 있게 말하되 과장하지 않는다. 결론과 주의사항은 단호하게 내려 끝낸다.', { pace: 0.94, pause: 0.3, pitch: -0.6, gain: 0.7, ending: 'fall' }),
  style('review-compare', '정보·신뢰', '리뷰·비교', '장단점과 차이를 솔직하고 균형 있게 설명합니다.', '실사용 리뷰어처럼 솔직하고 구체적으로 비교한다. 장점은 밝게, 단점은 차분하게, 최종 추천은 분명하게 끝낸다.', { pace: 1.03, pause: 0.24, pitch: 0.05, gain: 0.4, ending: 'crisp' }),
  style('warm-empathy', '감성·안정', '따뜻한 공감', '상대의 감정을 이해하고 위로하듯 말합니다.', '따뜻하게 공감하고 위로하듯 부드럽게 말한다. 문장 끝의 힘을 빼고 충분히 호흡하며 재촉하지 않는다.', { pace: 0.88, pause: 0.45, pitch: 0.05, gain: -0.3, ending: 'soft-fall' }),
  style('calm-guide', '감성·안정', '차분한 안내', '안정적이고 부담 없는 안내 음성입니다.', '안내 방송처럼 차분하고 안정적으로 읽고 단계 사이를 명확히 쉬며 문장 끝을 부드럽게 내린다.', { pace: 0.92, pause: 0.36, pitch: -0.15, gain: -0.1, ending: 'soft-fall' }),
  style('audiobook', '감성·안정', '오디오북', '등장인물과 장면의 감정을 절제해 표현합니다.', '오디오북 낭독처럼 장면과 감정을 섬세하게 살리되 지나치게 연기하지 않는다. 문단 끝에는 긴 여운을 둔다.', { pace: 0.9, pause: 0.4, pitch: -0.1, gain: 0, ending: 'linger' }),
  style('asmr-meditation', '감성·안정', 'ASMR·명상', '매우 느리고 부드럽게 호흡하며 안정감을 줍니다.', '명상 안내처럼 아주 부드럽고 느리게, 낮은 에너지로 말한다. 문장 사이를 충분히 쉬고 끝음을 사라지듯 낮춘다.', { pace: 0.82, pause: 0.7, pitch: -0.35, gain: -1.4, ending: 'soft-fall' }),
  style('trailer', '숏폼·엔터', '예고편·트레일러', '크고 묵직한 호흡으로 기대감과 스케일을 만듭니다.', '영화 예고편처럼 짧고 묵직하게 말하고 핵심 문구 앞뒤를 길게 쉬며 마지막 단어를 낮고 강하게 남긴다.', { pace: 0.88, pause: 0.5, pitch: -0.8, gain: 1.2, ending: 'linger' }),
  style('custom', '직접 설정', '직접 입력', '원하는 말투를 문장으로 직접 지시합니다.', '사용자가 입력한 말투 지시를 따른다.', { pace: 1, pause: 0.25, pitch: 0, gain: 0, ending: 'neutral' }),
]

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0))
}

export function resolveNarrationStyle(styleId, customInstruction = '') {
  const selected = NARRATION_STYLES.find((candidate) => candidate.id === styleId) ?? NARRATION_STYLES[0]
  if (selected.id !== 'custom') return { ...selected, defaults: { ...selected.defaults } }
  const custom = String(customInstruction ?? '').trim()
  return {
    ...selected,
    instruction: custom ? `사용자 지시: ${custom}` : selected.instruction,
    defaults: { ...selected.defaults },
  }
}

function sentenceEnding(sentence, fallback) {
  const text = String(sentence)
  if (/[?？]\s*$/.test(text)) return 'rise'
  if (/(확인|구매|주문|클릭|링크|놓치지|만나보|시작해|신청)/u.test(text)) return 'crisp'
  return fallback
}

export function buildPresetDeliveryPlan(sentences, styleId = 'natural', strength = 2, customInstruction = '') {
  const selected = resolveNarrationStyle(styleId, customInstruction)
  const level = Math.min(3, Math.max(1, Math.round(Number(strength) || 2)))
  const scale = level === 1 ? 0.65 : level === 3 ? 1.3 : 1
  const defaults = selected.defaults
  return sentences.map((sentence) => {
    const excited = /[!！]\s*$/.test(String(sentence))
    return {
      pace: Math.round(clamp(1 + (defaults.pace - 1) * scale + (excited ? 0.02 * scale : 0), 0.8, 1.25) * 100) / 100,
      pause: Math.round(clamp(0.25 + (defaults.pause - 0.25) * scale, 0.05, 1) * 100) / 100,
      pitch: Math.round(clamp(defaults.pitch * scale, -2, 2) * 100) / 100,
      gain: Math.round(clamp(defaults.gain * scale + (excited ? 0.2 * scale : 0), -3, 3) * 100) / 100,
      ending: ENDINGS.has(defaults.ending) ? sentenceEnding(sentence, defaults.ending) : 'neutral',
    }
  })
}

export const NARRATION_ENDINGS = [...ENDINGS]
