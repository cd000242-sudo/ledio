# 구현 계획: 편집 대개편

> 승인일: 2026-08-29. 진행 중.

## 목표
영상 편집을 초보자가 열자마자 쓸 수 있게 만든다. 잠긴 기능을 열고, 수동편집을 미리보기 중심으로
재배치하고, 자동편집·자막지우기 탭을 새로 만들고, 모든 탭을 에이전트가 조작할 수 있게 한다.

## 단계

| Phase | 내용 | 상태 |
|---|---|---|
| 0 | 편집 잠금 해제 — 편집 전용 최소 스키마 | ✅ 완료 |
| 1 | app/app.js 분할 (preview/timeline/inspector/tools/state) | 대기 |
| 2 | 수동편집 재배치 (목업대로) | 대기 |
| 3 | 자동편집 탭 (6단계 + 자를 후보 확인) | 대기 |
| 4 | 자막 지우기 탭 (인페인팅, 9:16·16:9 모두) | 대기 |
| 5 | 에이전트 확대 + agent-gemini 추가 | 대기 |
| 6 | 릴리즈 v0.5.0 | 대기 |

## 결정
- 편집 전용 스키마는 **분기 대신 기본값 채우기**로 한다 → 렌더 등 뒷단 코드가 안 바뀐다.
- `kind: edit | shopping | story`. kind가 없던 기존 파일은 상품 정보 유무로 판별해 호환 유지.
- 자주 쓰는 편집 버튼은 **즉시 실행 + 되돌리기**. 비싼 작업만 작은 팝오버로 확인.
- Antigravity는 CLI가 없어 연결 불가 → 같은 계열 **Gemini CLI**로 대체.
- 자막 지우기는 3단계(배경복원/빠른채우기/블러) + **3초 미리보기 먼저**.

## 실측 기록
- 무음 검출 기본값은 정상이었다: -45dB 2구간 / -40~-25dB 3구간. (앞선 "0구간" 진단은 응답 JSON을
  잘못 읽은 것 — silences는 `report.plan.silences`에 있다.)
- 진짜 막힌 원인은 스키마 하나였다: 영상만 있는 프로젝트가 상품 정보 요구에 걸려 편집이 안 열렸다.


## 이전 계획

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

## 2단계: 소스 짜집기 모드 (완료 — 2026-07-24 승인·구현)

- 쿠팡 캡처 자동 채움·바이럴 대본·타입캐스트: 1단계 재사용.
- 소스 영상 여러 개 업로드 → 원본 오디오 자동 제거(클립 렌더 매핑에서 구조적) + 박힌 자막 비전 감지→영역 블러 + AI 내용 매칭(대표 프레임 분석, 실패 시 순서 폴백) → TTS 실측 길이 컷 → 12자 센터 자막 동기.
- 구현: src/modes/remixPlan.ts(세그먼트·블러·컷 인자), CLI source-remix(5스테이지 progress), 서버 /api/source-remix(잡 큐 분석→plan.json), scripts/server/source-remix.mjs, app/product-remix-mode.js(쇼핑쇼츠 '소스 짜집기' 모드).

## 이전 계획

`낭독 말투·끝음·쇼핑쇼츠 나레이션`(2026-07-13 승인)은 구현 완료. 상세 이력은 [prompt_plan.archive-v4.md](prompt_plan.archive-v4.md) 참조.
