/**
 * 대본·연출 프롬프트 계층 — 전부 순수 함수/상수 (부수효과 없음).
 * 서버(local-server.mjs)에서 분리: 프롬프트 튜닝이 가장 잦은 변경이라
 * 파이프라인 로직과 얽히지 않게 독립 모듈로 둔다.
 * 구성: 대본 생성(장르/형식/톤/스타일/일관성) · 심사(judge) · 시리즈 ·
 *       낭독 연출(delivery) · 촬영감독(shot/세트 시트) 프롬프트와 파서.
 */

export const FORMAT_SPECS = {
  썰형:
    '실화처럼 느껴지는 1인칭 서사. 시간·장소·소리·냄새 같은 구체적 감각 디테일을 심고, ' +
    '감정 곡선(일상→위화감→긴장→절정→서늘한 여운)을 설계하라. 반전은 반드시 앞 문장에 심은 복선과 연결돼야 한다.',
  반전형:
    '모두가 당연하다고 믿는 전제를 깔고 시작해, 마지막에 그 전제를 뒤집어라. ' +
    '복선을 최소 2개 심고, 반전 후 다시 보면 모든 문장이 두 가지 의미로 읽히게 하라.',
  공감형:
    '시청자가 "이거 완전 나잖아"라고 느낄 구체적 상황 묘사. 누구나 겪지만 아무도 말 안 하는 디테일을 파고들고, ' +
    '마지막은 따뜻한 위로나 통찰 한 줄로 마무리하라.',
  정보형:
    '검증 가능한 사실·수치·사례를 담아라. 흔한 오해를 먼저 제시하고 진실로 뒤집는 구조. ' +
    '시청자가 바로 써먹을 실용 팁을 최소 1개 넣고, 과장·허위는 금지.',
  비교형:
    '두 대상을 공정하게 맞붙여라. 명확한 비교 기준 3가지 이상, 의외의 승자 포인트 1개, ' +
    '마지막은 "당신이라면?" 같은 참여 유도로 끝내라.',
}

/** 주제 장르별 품질 기준 — 콘텐츠 내용의 끝판왕 조건. 형식(FORMAT_SPECS)과 조합된다. */
export const GENRE_SPECS = {
  경제:
    '시청자 지갑에 직접 와닿는 실생활 사례로 시작하라. 숫자는 반드시 쉬운 비유로 변환하고(예: "국가 부채 1경 원" → "국민 1인당 얼마"), ' +
    '왜 지금 알아야 하는지(기회 또는 위험)를 분명히 하고, 마지막에 시청자가 오늘 할 수 있는 행동 하나를 제시하라. 허위·과장 전망 금지.',
  공포썰:
    '평범한 일상 공간(집·편의점·엘리베이터·지하주차장)에서 시작해 위화감을 한 겹씩 쌓아라. ' +
    '소리·시선·온도 같은 감각으로 공포를 전달하고, 괴물을 설명하지 말고 보여주지도 마라 — 가장 무서운 건 마지막에 남는 해석의 여지다. ' +
    '중반 이후에는 안전한 문장을 주지 마라 — 매 문장이 위험을 한 칸씩 키워야 하고, ' +
    '주인공이 "이상함을 알아채는 순간"과 "도망칠 수 없음을 깨닫는 순간"을 반드시 따로 만들어 그 사이를 조여라.',
  웃긴썰:
    '누구나 겪어본 상황에서 출발하는 공감 개그. 대화 티키타카와 타이밍으로 웃기고, 과장은 현실감을 잃지 않는 선까지. ' +
    '마지막 한 줄은 반드시 빵 터지는 펀치라인으로, 그 앞 문장은 펀치라인을 위한 셋업으로 설계하라.',
  '고전·역사썰':
    '실제 역사 기록이나 고전 속 실화만 사용하라(창작 금지, 논쟁적 사실은 "기록에 따르면"으로). ' +
    '옛날 이야기를 지금 언어와 감각으로 재해석하고, "이게 실화라고?" 싶은 의외의 포인트를 중심에 놓아라. 인물의 감정을 살려 장면처럼 묘사하라.',
  과학:
    '직관을 배신하는 검증된 과학 사실로 시작하라. 전문용어는 일상 비유로 풀고(예: "중성자별 한 스푼 = 에베레스트 무게"), ' +
    '틀린 통념을 먼저 제시한 뒤 진실로 뒤집어라. 마지막은 우주적/자연적 경이감이 남는 한 문장으로.',
  '미스터리·미제':
    '사실관계가 확인된 사건만 다뤄라. 시간순으로 떡밥을 정리하고, 각 가설의 근거와 허점을 공정하게 제시하라. ' +
    '범인을 단정하지 말고, 마지막은 가장 소름 돋는 미해결 디테일로 끝내라.',
  '상식·꿀팁':
    '"아는 사람만 아는" 정보로 시작해 즉시 써먹을 수 있는 방법을 단계별로 알려줘라. ' +
    '왜 그런지 원리를 한 줄로 설명해 신뢰를 만들고, 흔한 실수 하나를 경고하라.',
}

export function genreSpec(genre) {
  const spec = GENRE_SPECS[String(genre ?? '').trim()]
  return spec ? ` 주제 장르: ${genre}. 장르 기준: ${spec}` : ''
}

/** 울트라플랜: 심층 분석 → 구조 설계 → 초안 → 자체 비평 → 최종 출력. */
export const ULTRA_PLAN =
  '작성 절차(내부에서만 수행하고 과정은 출력하지 마): ' +
  '1) 주제를 분석하고 강한 소재·디테일을 빠르게 수집하라. ' +
  '2) 형식 구조에 맞춰 장면 흐름(기승전결)을 설계하라. ' +
  '3) 곧바로 최종 품질로 집필하라. 다듬기는 별도 심사자가 하니 초안을 여러 번 고치지 말고 한 번에 최선을 써서 대본만 출력하라.'

export function formatSpec(format) {
  const spec = FORMAT_SPECS[String(format ?? '').trim()]
  return spec ? ` 형식: ${format}. 형식 기준: ${spec}` : ''
}

/** 말투(톤) 프리셋 — 대본의 화법을 정한다. */
export const TONE_SPECS = {
  이야기꾼:
    '친한 친구에게 실제 겪은 일을 들려주듯 말하라. "근데", "그때", "있잖아요", "진짜로" 같은 구어 연결어를 자연스럽게 쓰고, ' +
    '"~거든요", "~는데요", "~더라고요"로 문장을 잇고, 가끔 청자에게 말을 걸어라("이게 무슨 말이냐면요"). 글이 아니라 말로 들려야 한다.',
  차분한나레이션:
    '다큐멘터리 내레이터처럼 차분하고 신뢰감 있게. "-습니다/-입니다"체를 기본으로 하되 문장 길이는 다양하게. 감정은 절제하고 사실의 무게로 전달하라.',
  반말썰:
    '커뮤니티에 썰 푸는 반말체. "~했다", "~하더라" 같은 솔직하고 직설적인 말투. 과장 없이 담백하게, 그래서 더 소름 돋게.',
  하이텐션:
    '예능 진행자처럼 에너지 있게. 감탄사와 리액션("와, 근데 여기서 미쳤던 게"), 시청자를 계속 호명하며 텐션 유지. 단, 오버해서 신뢰를 잃지는 마라.',
}

export function toneSpec(tone) {
  const spec = TONE_SPECS[String(tone ?? '').trim()]
  return spec ? ` 말투: ${tone}. 말투 기준: ${spec}` : ` 말투 기준(기본): ${TONE_SPECS.이야기꾼}`
}

/** 낭독 대본의 문장 스타일 규칙 — 엉성함/어색함을 만드는 패턴을 금지한다. */
export const STYLE_RULES =
  ' 문장 스타일 규칙: ' +
  '1) 리듬 — 말하듯 자연스럽게 흘러야 한다. 짧은 문장은 긴장이 최고조인 순간에만 아껴 써라. ' +
  '시처럼 뚝뚝 끊기는 단문 나열은 금지다(나쁜 예: "너무 조용했다. 새소리가 안 들렸다. 능선쯤에서 멈췄다."). ' +
  '문장들을 "근데", "그때", "그러다" 같은 연결어로 이어 이야기가 앞으로 굴러가게 하라. ' +
  '2) 디테일 절제 — 한 문장에 감각 디테일은 하나만. 가장 강한 디테일 하나를 고르고 나머지는 버려라. ' +
  '3) 떡밥 관리 — 복선·소품은 최대 3개. 심은 것은 전부 회수하고, 회수 못 할 것은 아예 심지 마라. ' +
  '4) 결말 — 반전은 단 하나로 수렴시켜라. 반전 위에 반전을 쌓지 마라. ' +
  '5) 낭독체 — 소리 내어 읽어 자연스러운 구어체. 관형절을 겹겹이 쌓은 번역투 금지. ' +
  '추임새·감탄사는 낭독 엔진이 그대로 읽으므로 소리 나는 대로 표기하라("아...", "후우...", "네?", "근데 있잖아요"). ' +
  '말줄임표(...)로 호흡과 뜸을, 물음표·느낌표로 어조를 표현하라. 단, 추임새는 긴장이 꺾이는 순간에만 아껴 써라 — 남발하면 어색하다. ' +
  '6) 비문 금지 — 조사와 서술어의 호응이 맞아야 한다. 감각을 억지로 섞은 수사는 금지 ' +
  '(나쁜 예: "이름이 젖은 흙소리로 불렸다" — 이름은 목소리로 불리는 것이다. ' +
  '나쁜 예 2: "겨울보다 먼저 차가운 공기가 얼굴에 닿았다" — 억지 비유보다 "이상하리만큼 서늘했다"가 낫다). ' +
  '비유는 머릿속에 실제로 그려지는 것만 써라. 멋있어 보이려다 말이 안 되는 문장은 최악이다. ' +
  '7) TMI 금지 — 이야기에 필요 없는 구체 정보를 쓰지 마라. 정확한 연월일(나쁜 예: "2023년 10월 28일"), ' +
  '불필요한 실명·지명·수치 나열 금지. 시간과 장소는 분위기에 필요한 만큼만("작년 겨울", "새벽 두 시", "외곽의 편의점"). ' +
  '8) 긴장 곡선 — 이야기는 갈수록 조여야 한다. 처음부터 끝까지 같은 속도로 서술하면 시 낭독처럼 밋밋해진다. ' +
  '초반은 여유 있게 흐르다가 위기가 시작되면 문장을 점점 줄이고, 절정 한 장면만은 현재형으로 전환해 ' +
  '지금 눈앞에서 벌어지는 것처럼 써라(예: "문이 열린다. 발소리가 다가온다. 그리고 멈춘다."). 절정이 지나면 다시 풀어라. ' +
  '9) 미끼 문장 — 장면이 넘어갈 때마다 다음이 궁금해지는 문장을 걸어라(끊긴 정보, 불길한 예고, "그때는 몰랐다" 류). ' +
  '시청자가 "그래서? 그 다음은?"을 세 번 이상 느끼게 설계하라. ' +
  '10) 대사 — 대사는 짧고 서늘하게. 상황을 설명하는 긴 대사는 금지. 위기 장면의 대사일수록 한 호흡을 넘기지 마라(좋은 예: "…그 집에 사세요?"). ' +
  '11) 서두 설정 — 첫 문장 후킹 직후 2~3문장 안에 화자의 상황을 깔아라: 누가, 어디서, 왜 그곳에 있게 됐는지. ' +
  '시청자가 화자의 처지를 그리기 전에 사건부터 쏟아내지 마라. ' +
  '12) 시제 — 회상 썰은 "~에 살았었어요", "~였거든요" 같은 회상 시제로 일관하라("~로 들어갔거든요"처럼 현재 진행처럼 들리는 표현 금지). 절정의 현재형 전환만 예외다. ' +
  '13) 디테일 공개 타이밍 — 정확한 숫자 디테일(시각·횟수)은 처음 등장할 때는 두루뭉술하게("새벽 2시쯤"), ' +
  '그 디테일이 반복되며 공포 장치로 자리 잡은 뒤에야 정밀하게 밝혀라("이번에도 정확히 2시 17분이었어요"). 도입부부터 정밀하면 어색한 TMI다. ' +
  '14) 그림 그리기 — 사건 장면은 화자가 어디서 뭘 하던 중인지 앵커를 먼저 찍어라("침대에 누워 있는데", "부엌에서 설거지를 하는데"). ' +
  '사물과 소리는 누구의 어떤 것인지 명시하라("제 집 도어락이", "도어락 숫자판을" — 주어 없는 "도어락이", 맥락 없는 "숫자판"은 헷갈린다). ' +
  '15) 개연성 — 인물이 무서운데도 움직일 때는 이유를 한 줄 먼저 줘라(예: 확인이라도 해야 잠들 수 있을 것 같아서). ' +
  '추론 포인트에는 근거 디테일을 받쳐라(나쁜 예: 소리가 여섯 번이라 비밀번호를 아는 것 같았다 / 좋은 예: 버튼마다 음이 다른데 그 음 순서까지 제 비밀번호와 똑같았다). ' +
  '핵심 소품은 반전이 밝혀진 뒤 정체나 의미가 정리돼야 한다 — 시청자에게 "그래서 그건 뭐였는데?"가 남으면 실패다.'

/** 심사·통합 프롬프트: 병렬 초안 두 개 중 강한 쪽을 고르고 장점을 합쳐 최종본을 만든다. */

export function judgePrompt(drafts, durationSec, format, genre, tone) {
  return (
    '너는 20년차 방송작가다. 같은 주제로 쓴 초안 두 개가 있다. 더 강한 쪽을 고르고, 다른 초안의 좋은 장면·표현이 있으면 자연스럽게 흡수해서 최종본을 완성하라.' +
    NARRATION_TARGET +
    '고칠 것: 비문(조사·서술어 호응 오류, 억지 수사), 번역투, 단조로운 리듬, 과한 디테일, 회수 안 된 떡밥, 논리 비약, 겹친 반전, ' +
    '앞뒤 행동 모순, 주어가 불분명한 사물·소리, 동기 없는 위험 행동, 뒤섞인 시제, 도입부의 어색하게 정밀한 숫자, ' +
    '그리고 무엇보다 긴장감 — 처음부터 끝까지 같은 속도라 시 낭독처럼 밋밋하면 절정 구간을 다시 써서 조여라(문장 급단축, 현재형 전환, 장면 끝 미끼 문장).' +
    `${STYLE_RULES}${genreSpec(genre)}${formatSpec(format)}${toneSpec(tone)} ` +
    `규칙 유지: ${scriptLineRule(durationSec)}, 한 줄에 한 문장, 첫 문장은 후킹. ` +
    `비평이나 선택 이유는 출력하지 말고 최종 대본만 출력하라.\n\n[초안 A]\n${drafts[0]}\n\n[초안 B]\n${drafts[1]}`
  )
}

/** 신속정확 파이프라인: 초안 2개 병렬 생성 → 빠른 모델로 심사·통합. 실패 시 살아남은 초안 사용. */

export function scriptLineRule(durationSec) {
  if (durationSec >= 600) return '110~140문장'
  if (durationSec >= 300) return '60~75문장'
  if (durationSec >= 180) return '36~45문장'
  if (durationSec >= 120) return '24~30문장'
  if (durationSec >= 60) return '12~16문장'
  if (durationSec >= 30) return '6~8문장'
  return '4~6문장'
}

// 모든 대본의 공통 목적 — 쇼츠 영상 위에 목소리로 얹는 낭독용.
export const NARRATION_TARGET =
  ' 이 대본은 쇼츠 영상에 목소리로 얹는 낭독용이다. 라디오 DJ가 청취자 사연을 읽어주듯, ' +
  '듣는 사람에게 직접 들려주는 말로 써라 — 눈으로 읽는 글이 아니라 귀로 듣는 이야기다.'

export function scriptPrompt(topic, series = null, durationSec = 30, format = '', genre = '', tone = '') {
  const lineRule = scriptLineRule(durationSec)
  const base =
    `너는 조회수 천만을 만드는 유튜브 대본 작가야. 주제: "${topic}".${NARRATION_TARGET}${genreSpec(genre)}${formatSpec(format)}${toneSpec(tone)} ` +
    `${ULTRA_PLAN} ` +
    `${durationSec}초 분량의 한국어 쇼츠 대본을 써줘. 규칙: ${lineRule}, 한 줄에 한 문장(각 줄이 한 장면), ` +
    `첫 문장은 시선을 붙잡는 후킹.${STYLE_RULES} ${COHERENCE_RULES}`
  if (series && series.episode > 0) {
    const previous = series.previous ? ` 이전 화 줄거리: ${series.previous}. 그 내용에서 자연스럽게 이어지게 써.` : ''
    return (
      `${base}. 이 대본은 연속 시리즈의 ${series.episode}화야.${previous} ` +
      '마지막 문장은 다음 화가 궁금해서 견딜 수 없는 클리프행어로 끝내. 대본 본문만 출력하고 설명은 붙이지 마.'
    )
  }
  return `${base}, 마지막 문장은 여운이나 반전. 대본 본문만 출력하고 설명은 붙이지 마.`
}


/** claude/codex 같은 npm 전역 CLI는 Windows에서 .cmd 셔틀로 설치되므로 .exe 외 확장자도 찾는다. */
export const COHERENCE_RULES =
  '반드시 지켜: 문장과 문장 사이 인과가 자연스럽게 이어질 것, 인물·시간·설정의 모순 금지, ' +
  '앞에 나온 사건·인물·소품을 정확히 이어받을 것. ' +
  '특히 인물의 행동이 앞 문장과 모순되면 안 된다(나쁜 예: 초인종까지 눌러본 사람이 나중엔 "문 두드리기 싫어서 미뤘다"고 함). ' +
  '반응하는 사건의 인과도 정확해야 한다(나쁜 예: 옆집에서 나는 딸깍 소리에 "내 도어락에 손도 안 댔는데"라고 함 — "그 집 앞을 지나가지도 않았는데"가 맞다). ' +
  '초안을 쓴 뒤 스스로 검토해서 말이 안 되는 부분을 고친 최종본만 출력해.'

export function seriesArcPrompt(topic, episode, totalEpisodes, previousScripts, durationSec, seriesFormat = '', genre = '', tone = '') {
  const lineRule = scriptLineRule(durationSec)
  const previousBlock = previousScripts.map((text, index) => `[${index + 1}화]\n${text}`).join('\n\n')
  const context = previousScripts.length
    ? `지금까지 확정된 대본 전문:\n${previousBlock}\n이 내용과 완벽하게 이어지게 써.`
    : `${totalEpisodes}화 완결 구조로 전체 기승전결을 먼저 머릿속으로 설계한 뒤 시작해.`
  const ending =
    episode === totalEpisodes
      ? '마지막 문장은 시리즈 전체를 완결짓는 강한 반전 또는 여운.'
      : '마지막 문장은 다음 화가 궁금해서 견딜 수 없는 클리프행어.'
  return (
    `너는 조회수 천만을 만드는 유튜브 시리즈 대본 작가야. 주제: "${topic}". 전체 ${totalEpisodes}화 시리즈 중 ${episode}화를 써줘.${NARRATION_TARGET}${genreSpec(genre)}${formatSpec(seriesFormat)}${toneSpec(tone)} ` +
    `${ULTRA_PLAN} ` +
    `${context} ${durationSec}초 분량, 규칙: ${lineRule}, 한 줄에 한 문장(각 줄이 한 장면), 첫 문장은 후킹. ${ending}` +
    `${STYLE_RULES} ${COHERENCE_RULES} 대본 본문만 출력하고 화수 표기나 설명은 붙이지 마.`
  )
}

/** 쿠팡 상품 캡처 → 15~20초 바이럴 쇼핑쇼츠 대본. 사용욕구·구매욕구 자극 + CTA 구조. */
export function coupangViralPrompt(productInfo = {}, durationSec = 18, tone = '') {
  const productName = String(productInfo.productName ?? '').trim() || '이 제품'
  const benefit = String(productInfo.benefit ?? '').trim()
  const painPoint = String(productInfo.painPoint ?? '').trim()
  const pricePoint = String(productInfo.pricePoint ?? '').trim()
  const lineRule = scriptLineRule(durationSec)
  return (
    `너는 조회수 천만을 만드는 커머스 쇼츠 카피라이터야. 상품: "${productName}".` +
    `${benefit ? ` 핵심 장점: ${benefit}.` : ''}` +
    `${painPoint ? ` 해결하는 불편: ${painPoint}.` : ''}` +
    `${pricePoint ? ` 가격·혜택 포인트: ${pricePoint}.` : ''}` +
    `${NARRATION_TARGET}${toneSpec(tone)} ` +
    `${durationSec}초 분량의 한국어 쇼핑쇼츠 대본을 써줘. 규칙: ${lineRule}, 한 줄에 한 문장(각 줄이 한 장면). ` +
    '구조: ① 첫 문장은 3초 안에 시선을 붙잡는 후킹(불편 공감 또는 충격 결과 — 상품명 금지), ' +
    '② 중간 문장들은 사용 장면이 눈앞에 그려지게(사용욕구) + 전후 변화가 느껴지게(구매욕구), ' +
    '③ 마지막 문장은 지금 확인하고 싶어지는 CTA(가격·혜택 포인트가 있으면 여기서 활용). ' +
    '과장 광고 문구(무조건, 100%, 최저가 보장)는 금지, 짧고 리듬감 있는 구어체.' +
    `${STYLE_RULES} 대본 본문만 출력하고 설명은 붙이지 마.`
  )
}

/** 쿠팡 상품 캡처 이미지에서 대본 재료를 뽑는 비전 프롬프트. */
export function coupangVisionPrompt() {
  return (
    '첨부한 이미지는 쿠팡 상품 페이지 캡처다. 대본 작성에 쓸 정보를 추출해서 JSON 하나만 출력하라(설명·코드펜스 금지). ' +
    '형식: {"productName":"상품명(간결하게)","benefit":"가장 강력한 핵심 장점 1~2개","painPoint":"이 상품이 해결하는 일상 불편","pricePoint":"가격·할인·혜택 포인트(보이면)"} ' +
    '이미지에서 확인할 수 없는 필드는 빈 문자열로 둔다. 과장하지 말고 캡처에 실제로 보이는 정보만 쓴다.'
  )
}

/** 비전 응답에서 상품정보 JSON을 관대하게 꺼낸다. 실패하면 null. */
export function parseCoupangProductInfo(raw) {
  try {
    const text = String(raw ?? '')
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    const parsed = JSON.parse(text.slice(start, end + 1))
    if (typeof parsed !== 'object' || parsed === null) return null
    return {
      productName: String(parsed.productName ?? '').trim(),
      benefit: String(parsed.benefit ?? '').trim(),
      painPoint: String(parsed.painPoint ?? '').trim(),
      pricePoint: String(parsed.pricePoint ?? '').trim(),
    }
  } catch {
    return null
  }
}

/** 리믹스 소스 영상의 대표 프레임에서 내용·박힌 자막 위치를 뽑는 비전 프롬프트. */
export function sourceClipVisionPrompt() {
  return (
    '첨부한 이미지는 편집에 쓸 소스 영상의 대표 프레임이다. JSON 하나만 출력하라(설명·코드펜스 금지). ' +
    '형식: {"description":"이 장면의 내용을 한 문장으로(무엇이 보이고 무슨 행동을 하는지)",' +
    '"hasSubtitles":화면에 구워진 자막·큰 텍스트 오버레이가 있으면 true,' +
    '"subtitleBand":{"top":자막 영역 상단의 세로 위치(0=화면 맨 위, 1=맨 아래),"bottom":자막 영역 하단 위치}} ' +
    '자막이 없으면 subtitleBand는 null. 워터마크·작은 로고는 자막으로 치지 않는다.'
  )
}

/** 비전 응답에서 소스 클립 정보를 관대하게 파싱한다. 밴드는 0~1 클램프, 역전·높이 40% 초과는 null. */
export function parseSourceClipInfo(raw) {
  try {
    const text = String(raw ?? '')
    const start = text.indexOf('{')
    const end = text.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    const parsed = JSON.parse(text.slice(start, end + 1))
    if (typeof parsed !== 'object' || parsed === null) return null
    const clamp01 = (value) => Math.min(1, Math.max(0, Number(value)))
    let subtitleBand = null
    if (parsed.hasSubtitles && parsed.subtitleBand && typeof parsed.subtitleBand === 'object') {
      const top = clamp01(parsed.subtitleBand.top)
      const bottom = clamp01(parsed.subtitleBand.bottom)
      // 역전·과대(40% 초과) 밴드는 오탐으로 보고 블러를 생략한다.
      if (Number.isFinite(top) && Number.isFinite(bottom) && bottom > top && bottom - top <= 0.4) {
        subtitleBand = { top, bottom }
      }
    }
    return {
      description: String(parsed.description ?? '').trim(),
      hasSubtitles: Boolean(parsed.hasSubtitles),
      subtitleBand,
    }
  } catch {
    return null
  }
}

/** 대본 문장별로 가장 어울리는 소스 영상을 고르는 매칭 프롬프트. */
export function remixMatchPrompt(sentences, descriptions) {
  return (
    '너는 쇼츠 편집자다. 아래 나레이션 문장 각각에 가장 어울리는 소스 영상을 골라라. ' +
    '문장이 말하는 내용·행동·분위기와 영상 장면이 맞아야 한다. 같은 영상을 여러 문장에 써도 된다. ' +
    `JSON 배열만 출력하라(설명·코드펜스 금지). 형식: [0,2,1,...] — 길이는 문장 수(${sentences.length})와 같고, 값은 0~${descriptions.length - 1}의 영상 번호다.\n\n` +
    `[소스 영상]\n${descriptions.map((desc, index) => `${index}. ${desc}`).join('\n')}\n\n` +
    `[나레이션 문장]\n${sentences.map((sentence, index) => `${index + 1}. ${sentence}`).join('\n')}`
  )
}

/** 매칭 응답 파서 — 범위 밖·부족분은 라운드로빈(i % 소스수)으로 채운다. JSON이 없으면 null. */
export function parseRemixMatch(raw, sentenceCount, sourceCount) {
  try {
    const text = String(raw ?? '')
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return null
    const parsed = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(parsed)) return null
    const result = []
    for (let index = 0; index < sentenceCount; index++) {
      const value = Math.round(Number(parsed[index]))
      result.push(Number.isFinite(value) && value >= 0 && value < sourceCount ? value : index % sourceCount)
    }
    return result
  } catch {
    return null
  }
}

export function splitSentencesForDelivery(text) {
  return text
    .split(/(?<=[.!?。！？…]|다\.|요\.|죠\.)\s+/u)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

export function deliveryPrompt(sentences, style = {}) {
  const styleLabel = String(style.label ?? '자연스러운 낭독')
  const styleInstruction = String(style.instruction ?? '대본의 감정 흐름을 자연스럽게 살린다.')
  const strength = Math.min(3, Math.max(1, Math.round(Number(style.strength) || 2)))
  return (
    '너는 낭독 연출가다. 아래 번호 매긴 대본 문장을 성우가 읽을 때의 연출 지시를 만들어라. ' +
    `선택한 말투는 "${styleLabel}", 적용 강도 ${strength}이다. 말투 지시: ${styleInstruction} ` +
    '각 문장마다 pace(읽기 배속 0.8~1.25), pause(문장 뒤 쉼 초 0.05~1), pitch(반음 -2~2), gain(음량 dB -3~3), ' +
    'ending(neutral/fall/soft-fall/rise/crisp/linger 중 하나)을 정하라. ' +
    '원칙: 평온한 도입·설명은 보통 속도에 쉼 0.3 안팎. 긴장이 쌓이거나 긴박한 구간은 조금 빠르게(1.05~1.15) 쉼을 짧게(0.1~0.2) 붙여 몰아쳐라. ' +
    '소름 포인트·반전 직전 문장 뒤에는 길게 멈춰(0.6~0.8) 뜸을 들여라. 결말의 여운 문장은 천천히(0.9~0.95) 읽고 쉼을 길게 줘라. ' +
    '추임새·감탄사가 들어간 문장("아...", "후...", "네?", 짧은 탄식)은 사람이 실제로 내뱉듯 pace를 늦추고(0.88~0.95) 뒤 쉼을 넉넉히(0.4~0.6) 줘라 — 기계처럼 균일하게 읽히면 안 된다. ' +
    '전체가 같은 값이면 연출이 아니다 — 대본의 감정 흐름에 따라 값이 달라져야 한다. ' +
    `JSON 배열만 출력하라(설명·코드펜스 금지). 형식: [{"pace":1,"pause":0.3,"pitch":0,"gain":0,"ending":"soft-fall"},...] 배열 길이는 문장 수(${sentences.length})와 같아야 한다.\n\n` +
    sentences.map((sentence, index) => `${index + 1}. ${sentence}`).join('\n')
  )
}

/** 응답에서 JSON 배열을 최대한 관대하게 꺼낸다. 실패하면 null. */
export function parseDeliveryResponse(raw, expectedLength) {
  try {
    const text = String(raw ?? '')
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return null
    const parsed = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    const endings = new Set(['neutral', 'fall', 'soft-fall', 'rise', 'crisp', 'linger'])
    const clamp = (value, min, max, fallback) => {
      const number = Number(value)
      return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback))
    }
    const plan = parsed
      .slice(0, expectedLength)
      .map((step) => ({
        pace: clamp(step?.pace, 0.8, 1.25, 1),
        pause: clamp(step?.pause, 0.05, 1, 0.25),
        pitch: clamp(step?.pitch, -2, 2, 0),
        gain: clamp(step?.gain, -3, 3, 0),
        ending: endings.has(step?.ending) ? step.ending : 'neutral',
      }))
    return plan
  } catch {
    return null
  }
}

/** 대본을 읽고 문장별 낭독 연출(완급·쉼)을 추론한다. 실패하면 null(기본 낭독). */

export function splitScenesForShots(script, maxChars = 20) {
  const sentences = String(script)
    .split(/(?<=[.!?。！？]|다\.|요\.|죠\.)\s+/u)
    .map((sentence) => sentence.trim().replace(/\s+/g, ' '))
    .filter(Boolean)
  const scenes = []
  let current = ''
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence
    if (current && [...candidate].length > maxChars) {
      scenes.push(current)
      current = sentence
    } else {
      current = candidate
    }
  }
  if (current) scenes.push(current)
  return scenes
}

export function shotPrompt(scenes, character) {
  return (
    '너는 한국 드라마의 촬영감독 겸 미술감독이다. 아래 번호 매긴 장면(문장)들로 쇼츠를 만든다. 두 가지를 설계하라.\n' +
    '1) world(세트 시트): 이 이야기에 반복 등장하는 장소·소품의 시각 디테일과 컬러 팔레트·조명 톤을 한 단락으로 못박아라 ' +
    '(예: "1990년대 복도식 아파트, 청록색 철문에 1103 금속 호수판, 좁은 형광등 복도, 낡은 은색 엘리베이터, 비 오는 밤, ' +
    '차가운 시안-그린 색감에 형광등·문틈 빛 같은 화면 안 광원만 사용"). ' +
    '모든 장면이 이 세트와 색감 안에서 찍힌 것처럼 보여야 한다 — 문·복도·색감이 장면마다 달라지면 실패다. ' +
    '2) shots: 각 장면마다 그 문장의 가장 강렬한 순간(후킹 포인트)을 포착하는 숏 한 줄 — 피사체와 행동, 카메라 앵글·구도, 인물 감정, 조명. ' +
    (character ? `주인공(모든 장면 동일 인물): ${character}. ` : '') +
    '장면 설명이 아니라 촬영 지시를 써라' +
    '(나쁜 예: "남자가 복도에 서 있다" / 좋은 예: "복도 끝 어둠을 응시하는 남자의 뒷모습 로우앵글, 형광등 하나만 깜빡이는 차가운 조명, 굳은 어깨"). ' +
    '감독의 문법을 지켜라: ' +
    '① 첫 장면은 공간을 소개하는 설정숏, 마지막 장면은 멀어지는 와이드로 여운. ' +
    '② 연속된 문장이 같은 순간이면 같은 구도를 반복하지 말고 숏을 쪼개라 — 와이드 → 클로즈업 → 오버숄더 → 소품 인서트 → 리액션. 인접한 두 숏이 같은 샷 사이즈면 실패다. ' +
    '③ 180도 법칙 — 마주 보는 두 인물은 모든 숏에서 화면 좌/우 위치와 시선 방향을 유지하라. 대화는 샷/리버스샷으로. ' +
    '④ 앵글은 심리다 — 위협적인 대상은 로우앵글, 무력해진 인물은 하이앵글, 불안이 새는 순간만 더치앵글(기울임). ' +
    '⑤ 인물이 무언가를 보는 문장은 POV(시점숏)로 그가 보는 것을 직접 보여줘라(문틈 사이로 보이는 것 등). ' +
    '⑥ 서스펜스 순간은 프레임 속 프레임 — 문틀·창문·문틈 사이에 인물을 가둬라. ' +
    '⑦ 핵심 소품(모티프)은 이야기 진행에 따라 인서트로 반복 등장시켜 긴장을 쌓아라. ' +
    '⑧ 얕은 심도(배경 흐림)를 기본으로, 조명은 화면 안 광원(프랙티컬)만 사용. ' +
    `JSON 오브젝트만 출력하라(설명·코드펜스 금지): {"world":"세트 시트","shots":["숏1","숏2",...]} shots 길이는 장면 수(${scenes.length})와 같아야 한다.\n\n` +
    scenes.map((scene, index) => `${index + 1}. ${scene}`).join('\n')
  )
}

/** 응답에서 {world, shots}를 관대하게 꺼낸다. 실패하면 null. */
export function parseShotResponse(raw, expectedLength) {
  try {
    const text = String(raw ?? '')
    // 오브젝트 우선, 없으면 배열(과거 형식)도 허용
    const objStart = text.indexOf('{')
    const objEnd = text.lastIndexOf('}')
    if (objStart >= 0 && objEnd > objStart) {
      const parsed = JSON.parse(text.slice(objStart, objEnd + 1))
      if (Array.isArray(parsed?.shots) && parsed.shots.length > 0) {
        return {
          world: String(parsed.world ?? '').trim(),
          shots: parsed.shots.slice(0, expectedLength).map((shot) => String(shot)),
        }
      }
    }
    const start = text.indexOf('[')
    const end = text.lastIndexOf(']')
    if (start < 0 || end <= start) return null
    const parsed = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(parsed) || parsed.length === 0) return null
    return { world: '', shots: parsed.slice(0, expectedLength).map((shot) => String(shot)) }
  } catch {
    return null
  }
}

/** 대본을 읽고 세트 시트 + 장면별 숏 연출을 추론한다. 실패하면 null(기본 프롬프트로 폴백). */
