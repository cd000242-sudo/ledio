# 쇼츠팩토리 아키텍처 맵

> 2026-07-07 작성. 파이프라인이 엉키거나 회귀하지 않게 하는 기준 문서.
> 새 기능을 붙이기 전에 이 지도에서 "어느 상자에 속하는가"를 먼저 정하고, 상자를 넘나드는 의존을 만들지 말 것.

## 1. 전체 지도 (마인드맵)

```
쇼츠팩토리
├─ 🖥 UI (app/) — Electron 렌더러, 서버 API만 호출 (파일시스템 직접 접근 금지)
│   ├─ app.js ················ 탭 셸 + 수동편집기 (⚠ 4,400줄 — 분할 대상 1순위)
│   ├─ story-wizard.js ······· AI 숏폼 위자드 + 보관함/스튜디오/갤러리 (⚠ 1,800줄 — 분할 대상 2순위)
│   ├─ product-wizard.js ····· 쇼핑쇼츠 (개편 예정: docs/shop-shorts 논의)
│   └─ settings.js ··········· API 키(로컬 저장)/에이전트/드롭샷/진단
│
├─ 🌐 로컬 서버 (scripts/local-server.mjs, ~2,400줄) — HTTP API + 작업 큐. 무거운 일은 전부 CLI로 위임
│   ├─ server/script-prompts.mjs ✅분리됨 — 대본·연출 프롬프트 (순수 함수만, 부수효과 금지)
│   ├─ 작업 큐 ················ pipelineJobs + pipelineQueue (실행은 한 번에 1개 — GPU/브라우저 충돌 방지)
│   ├─ 대본 생성 ·············· generateWithMethod(API/에이전트) → generatePolishedScript(초안2+심사)
│   ├─ 추론 계층 ·············· inferDeliveryPlan(낭독 연출) / inferShotPlan(촬영감독+세트 시트)
│   ├─ 목소리/낭독 ············ 저장(잡음정리) · 테스트 샘플 캐시 · 낭독 중지(activeVoiceTests)
│   ├─ 보관함 ················· scripts-library / narrations / gallery(이미지·영상)
│   └─ 프로세스 위생 ·········· killChildTree(트리 종료) · killAllCliChildren · 고아 크로미움 청소
│
├─ ⚙ CLI (src/cli/) — 실제 작업 실행 단위. 서버가 프로세스로 스폰, 끝나면 반드시 종료(process.exit)
│   └─ story-pipeline = images → motion → narrate → clips → render (progress.json으로 상태 보고)
│       ├─ images ─ src/ai/imageGeneration.ts (캐릭터 시트 → 세트 설정샷 → 장면들[참조 2장])
│       ├─ motion ─ scripts/seedance-generator.mjs | dropshot(영상)
│       ├─ narrate ─ src/cli/commands/narrate.ts (캐시 → TTS → 완급/무음 → 폴리싱)
│       ├─ clips ─ storyboardRender (자막 굽기, 비율별 해상도, BGM 복사)
│       └─ render ─ renderVariant (BGM 믹스, 변형)
│
├─ 🧠 도메인 (src/) — 순수 로직 + 스키마 (테스트 최밀집 구역)
│   ├─ modes/story.ts ········ 장면 분할 + 이미지 프롬프트 조립(인물/세트/숏/비율/감독문법)
│   ├─ modes/storyAssets.ts ·· 스토리보드 → 렌더 계약(project.yaml) 변환
│   ├─ tts/ ·················· chunk(분할) · chunkCache(캐시) · delivery(연출) · normalizeText(숫자) · qwen3Provider(데몬)
│   └─ config/schema.ts ······ project.yaml 계약 스키마 (렌더의 단일 진실)
│
└─ 🔌 외부 어댑터 (scripts/)
    ├─ dropshot-generator.mjs · 브라우저 자동화 (프로필은 한 프로세스만! 서버는 확인 후 반드시 닫기)
    ├─ seedance-generator.mjs · fal.ai i2v
    └─ qwen3_tts_daemon.py ···· TTS 상주 데몬 (포트 8756, 유휴 30분 자동 종료 — 죽이지 말 것)
```

## 2. 깨지면 안 되는 계약 (회귀 감시 목록)

| 계약 | 위치 | 지키는 테스트 |
|---|---|---|
| progress.json 형식 {status,stages,current,completed} | CLI ↔ 서버 ↔ UI | local-server(회로차단기) |
| project.yaml 스키마 | storyAssets → render | config/schema.test, storyAssets.test |
| 문장 분할 규칙 3곳 동기화: tts/chunk.ts ↔ 서버 splitSentencesForDelivery / splitScenesForShots | 낭독연출·숏 번호가 어긋나면 연출 전체가 밀림 | chunk.test (서버 쪽은 주석으로 링크) |
| 낭독/파이프라인은 **한 번에 1개 실행** (GPU·드롭샷 프로필) | 서버 큐 + activeVoiceTests | 큐/busy 테스트 |
| CLI는 끝나면 반드시 종료 (process.exit + 드롭샷 브라우저 닫기) | src/cli/index.ts | — (수동 검증됨) |
| 드롭샷 프로필은 단일 프로세스 점유 — 서버는 상태확인 후 즉시 close | local-server + dropshot-generator | — |
| TTS 캐시 키 = 목소리 서명(경로+크기+mtime+전사) + 텍스트 | tts/chunkCache | chunkCache.test |
| 타입캐스트 목소리 = `typecast:<voice_id>` 접두사 (UI→서버→CLI 전 구간), API 키는 TYPECAST_API_KEY env로만 전달(디스크 저장 금지) | typecastProvider + local-server | typecastProvider.test, local-server.test(typecast) |
| 자막 cue 분할(sceneCues)은 **표시 전용** — 문장 분할 3곳 동기화 계약과 무관, 연출/숏 번호에 사용 금지 | captions/sceneCues | sceneCues.test |
| cue 미지정 시 스토리 클립 자막은 종전 drawtext와 바이트 동일(스토리 위저드 회귀 방지) | storyAssets.buildCaptionDrawtextFilters | storyAssets.test |
| 쿠팡 모드 = story-pipeline 재사용: promptProfile=product + referenceImages(캡처) + disclosure + `--caption-position center --caption-max-chars 12` | local-server handleStoryPipeline → CLI | local-server.test(coupang) |
| hidden 속성은 항상 display를 이긴다 ([hidden] !important) | styles.css | — (UI 규칙) |

## 3. 파일 크기 정책
- **800줄 초과 금지** (eslint `max-lines` warn 가드 활성).
- 기존 부채(분할 우선순위): ① app/app.js(4.4k — 수동편집기를 timeline/captions/media 모듈로) ② story-wizard.js(1.8k — gallery/studio/library/lightbox 분리) ③ local-server.mjs(2.4k — voice/jobs/gallery 핸들러 모듈화, script-prompts는 완료).
- 분할 원칙: **도메인 단위로** (기능이 함께 바뀌는 것끼리), 공유 상태는 명시적 인자로 전달, 순환 import 금지.

## 4. 새 기능을 붙일 때 체크리스트
1. 어느 상자(UI/서버/CLI/도메인/어댑터)의 책임인가? 두 상자에 걸치면 계약(API/파일)을 먼저 정의.
2. 무거운 작업(초 단위 이상)은 반드시 CLI로 — 서버 이벤트 루프에서 직접 하지 않는다.
3. 프롬프트 변경은 script-prompts.mjs만 건드린다.
4. 테스트 먼저(RED) — 특히 위 계약 표에 걸리는 변경이면 계약 테스트 추가.
5. 끝나지 않는 프로세스를 만들 수 있는가? 만들면 타임아웃+트리 종료를 함께 설계.
