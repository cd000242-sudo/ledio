# 구현 계획: 쇼핑쇼츠 개편 — 쿠팡 전부-AI 바이럴 쇼츠 (1단계)

> 승인일: 2026-07-24
> 목표: 쿠팡 상품 캡처만 올리면 바이럴 대본 → 타입캐스트 TTS → 캡처 참조 이미지 → i2v → TTS 동기 12자 센터 자막 → 완성 영상까지 원클릭.

## 요구사항

- 쿠팡 캡처 업로드 → 상품정보 자동 분석(비전 API) → 15~20초 후킹 바이럴 대본 자동 생성.
- 타입캐스트 API 목소리(또는 내 목소리 클론)로 TTS.
- 캡처를 참조로 상품 이미지 생성 — 드롭샷(기본/구독), GPT Image 2(=덕테이프, OpenAI), 나노바나나(Gemini).
- i2v 영상화 — 드롭샷 또는 Seedance.
- 12자 이내 센터 자막을 TTS 실측 타이밍에 동기화해 자동 삽입.
- 쿠팡 파트너스 대가성 고지 자동 삽입.
- UI: 쇼핑쇼츠 탭을 "전부 AI / 소스 짜집기" 2모드로 개편(짜집기 개편은 2단계).

## 구현 (완료)

1. `src/captions/sceneCues.ts` — 12자 cue 분할 + 글자수 비례 타이밍(minCue 하한). 표시 전용(문장분할 계약과 무관).
2. `storyAssets.buildCaptionDrawtextFilters` — cue별 enable 구간 + 센터 위치 굽기. cue 미지정 시 종전과 바이트 동일.
3. story-pipeline `--caption-position/--caption-max-chars` 플래그.
4. `story.ts promptProfile: product` — 커머스 광고 프롬프트 분기(드라마 지시 제거).
5. `imageGeneration` — referenceImages(캡처) 수용(시트 자동생성은 기존대로 드롭샷만), OpenAI/Gemini 참조 실지원, GPT Image 2 모델 옵션, disclosure 패스스루.
6. `script-prompts` — coupangViralPrompt(3초 후킹·사용/구매욕구·CTA), coupangVisionPrompt, scriptLineRule <30초=4~6문장.
7. 서버 — generateWithMethod 비전 확장(API 방식 전용), `/api/coupang/analyze`, story-pipeline 필드 패스스루.
8. UI — `app/product-ai-mode.js`(캡처→분석→대본→엔진 선택→잡 진행→결과), product-wizard 모드 토글.

## 2단계 (예정 — 참고 영상 수령 후)

소스 짜집기 모드 개편: AI 대본 + 타입캐스트 TTS + 소스 클립 자동 배치 + 동일한 12자 센터 자막 동기화.

## 이전 계획

`낭독 말투·끝음·쇼핑쇼츠 나레이션`(2026-07-13 승인)은 구현 완료. 상세 이력은 [prompt_plan.archive-v4.md](prompt_plan.archive-v4.md) 참조.
