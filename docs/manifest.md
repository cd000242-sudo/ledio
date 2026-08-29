# 쇼츠팩토리 프로젝트 매니페스트

> 이 저장소의 **단일 진실 문서**. 새 세션·새 사람은 이것부터 읽는다.
> 마지막 갱신: 2026-08-29 (v0.3.0 배포)
>
> 규칙: 기능을 완성하거나 방향을 바꾸면 **이 문서를 먼저 고친다**. 세부 설계는 아래 "문서 지도"의 개별 문서에 두고, 여기에는 상태와 결정만 남긴다.

---

## 1. 제품

**한 줄**: 로컬에서 도는 쇼핑·스토리 숏폼 자동 제작 스튜디오. 대본부터 완성 영상까지 한 대의 PC에서 끝낸다.

**사용자**: 1인 크리에이터(현재는 사실상 개발자 본인). 쿠팡 파트너스 쇼핑쇼츠와 썰 스토리 쇼츠가 주력.

**원칙**
1. **로컬 우선** — 영상·음성·프로젝트 파일은 내 PC에 있고, 외부 API는 선택이다.
2. **무거운 일은 CLI로** — 서버 이벤트 루프에서 초 단위 작업을 하지 않는다.
3. **한 번에 하나** — 낭독·파이프라인·대화는 동시 실행하지 않는다(GPU·브라우저 프로필 충돌).
4. **작업 중인 것을 죽이지 않는다** — 앱 재시작·프로세스 종료는 사용자 손에만 있다.
5. **파일 800줄 상한** — 넘으면 도메인 단위로 쪼갠다.

**안 하는 것**: 클라우드 렌더, 다중 사용자, 플랫폼 자동 업로드(계약만 있고 실사용 안 함).

---

## 2. 기능 인벤토리

| 영역 | 상태 | 핵심 위치 |
|---|---|---|
| 대본 생성(2초안+심사, 톤·장르·길이 프리셋) | ✅ 완성 | `scripts/server/script-prompts.mjs` |
| 쿠팡 캡처 → 상품 분석 → 바이럴 대본 | ✅ 완성 | `coupangVisionPrompt`, `handleCoupangAnalyze` |
| TTS 낭독(로컬 Qwen3 클로닝 + 타입캐스트 AI 성우) | ✅ 완성 | `src/tts/`, `scripts/qwen3_tts_daemon.py` |
| 자막(STT 받아쓰기, 12자 센터 cue) | ✅ 완성 | `src/captions/` |
| 스토리 파이프라인(이미지→i2v→낭독→클립→렌더) | ✅ 완성 | `src/cli/` story-pipeline |
| i2v 엔진(드롭샷·시댄스·힉스필드) | ✅ 완성 | `scripts/*-generator.mjs` |
| 소스 짜집기(AI 문장↔장면 매칭) | ✅ 완성 | `handleSourceRemix`, `src/…/source-remix` |
| 무음 컷·타임라인 파형 | ✅ 완성 | `handleSilenceAnalyze`, `app/app.js` |
| 자동 업데이트(GitHub 릴리즈) | ✅ 완성 | `electron/main.mjs` |
| **롱폼 자막(WhisperX → 보정 → 재편성 → 공백메움 → 검수 → 대본 생성)** | ✅ 완성 | `app/longform-captions.js`, `src/captions/whisperx.ts`, `src/subtitles/` |
| **앱 조종 비서(클로드코드 에이전트)** | ✅ 완성·배포 v0.3.0 | `scripts/mcp/`, `scripts/server/assistant-runtime.mjs`, `app/assistant.js` |
| 낭독 속도 개선 | 📋 플랜만 | `docs/tts-speed-plan.md` |
| 블로그 → 영상 파이프라인 | 📋 플랜만 | `docs/blog-to-video-plan.md` |
| 쇼핑쇼츠 비서화(잡 폴더 규약) | 📋 플랜만 | `docs/shopping-shorts-assistant-plan.md` |
| 쇼핑팩토리 추월(6대 사이트 소싱 등) | 📋 플랜만 | `docs/shopping-factory-*.md` |
| 플랫폼 업로드 | 🔶 계약·목업만 | `src/uploads/` |
| 파일 업로드 자동화(에이전트가 영상·캡처 올리기) | ❌ 없음 (의도적) | — |

---

## 3. 결정 기록

새로 합류한 사람이 "왜 이렇게 했지?"라고 물을 만한 것만 남긴다.

| 날짜 | 결정 | 이유 |
|---|---|---|
| 2026-08-29 | WhisperX는 `.venv-stt`에 격리 설치(TTS venv와 분리) | torch 버전이 충돌하면 낭독이 깨진다. CUDA 빌드를 따로 넣어야 GPU를 쓴다(pip 기본은 CPU 빌드) |
| 2026-08-29 | 자막 보정은 텍스트만 바꾸고, 큐 수가 달라지면 그 배치를 버린다 | AI가 타임스탬프를 만들면 싱크가 통째로 밀린다 — 시각은 정렬 결과에서만 온다 |
| 2026-08-29 | 패키지된 앱에서는 MCP 자식에 `ELECTRON_RUN_AS_NODE=1`을 준다 | `process.execPath`가 Electron 실행파일이라 그대로면 GUI를 띄운다. 릴리즈 빌드로 실제 확인하기 전엔 못 잡는 종류의 버그 |
| 2026-08-29 | 비서는 **Claude Code CLI를 spawn**하고 Agent SDK를 쓰지 않는다 | 사용자 구독을 그대로 쓰므로 추가 API 비용 0원 |
| 2026-08-29 | 앱 기능은 **MCP 도구**로 노출하고, MCP 서버는 기존 `/api/*`를 호출한다 | 파이프라인 로직 중복 0. 서버가 이미 모든 기능의 단일 창구다 |
| 2026-08-29 | 에이전트에게 `Bash`·`Read`·`Write`·`Edit`를 주지 않는다 | 파일시스템 접근을 열면 경로 감옥·승인 게이트가 전부 무의미해진다 |
| 2026-08-29 | `render`·`write_project`·`cancel_job`·`save_captions`·`source_remix`만 승인 게이트 | 되돌릴 수 없거나 몇 분을 태우는 작업. 낭독은 사용자 결정으로 게이트 없음 |
| 2026-08-29 | 승인은 **MCP 도구가 앱에 물어보고 대기**하는 방식 | 이 CLI 버전에 `--permission-prompt-tool`이 없다. 오히려 우리 통제 안에 있어 낫다 |
| 2026-08-29 | 장면 단위 `patch_scene`을 만들지 않는다 | `read_project` → 고친 YAML → `write_project`가 같은 일을 한다. 서버에 장면 단위 API가 없다 |
| 2026-08-29 | 에이전트에게 앱 종료·재시작 도구를 주지 않는다 | 진행 중인 대본 생성·렌더를 날린 사고가 실제로 있었다 |
| 2026-07-24 | 자동 업데이트는 사용자가 "지금 재시작"을 눌러야만 설치 | 같은 이유 — 무단 재시작 금지 |
| 2026-07-07 | 아키텍처를 5상자(UI/서버/CLI/도메인/어댑터)로 고정 | 상자를 넘나드는 의존이 회귀의 원인이었다 |

---

## 4. 다음 할 일 (우선순위)

1. **비서·롱폼 자막을 실사용해보고 막히는 지점 수집** — 도구를 더 얹기 전에 실제 사용 데이터가 먼저다.
2. **렌더를 비동기 잡으로** — 지금은 도구가 끝날 때까지 대화가 몇 분 멈춘다. 잡 큐에 얹고 진행률을 보고하게.
3. **파일 크기 부채** — `app/app.js`(4.5k) → `story-wizard.js`(2.1k) → `local-server.mjs`(3.3k) 순으로 분할.
4. **낭독 속도** — `docs/tts-speed-plan.md`의 4단계. 5분 대본 6~12분은 실사용에 부담.
5. **쇼핑쇼츠 비서화** — 잡 폴더 규약(`docs/shopping-shorts-assistant-plan.md`). 비서가 생겼으니 설계를 다시 볼 것.
6. **쇼핑팩토리 추월 항목** — 범위가 크다. 착수 전 이 매니페스트에서 우선순위를 다시 정한다.

---

## 5. 문서 지도

| 문서 | 성격 | 상태 |
|---|---|---|
| `docs/manifest.md` (이 문서) | 단일 진실 — 상태·결정·다음 할 일 | 🟢 살아 있음 |
| `docs/architecture.md` | 구조 계약, 깨지면 안 되는 것 목록 | 🟢 살아 있음 — 코드 바꾸기 전에 본다 |
| `docs/claude-agent-integration-plan.md` | 비서 5단계 계획 + 완료 기록 | 🔵 완료 — 이력 참고용 |
| `docs/longform-captions-plan.md` | 롱폼 자막 탭 설계 | 🔵 완료 — 이력 참고용 |
| `docs/shopping-shorts-assistant-plan.md` | 쇼핑쇼츠 잡 폴더 자동화 6단계 | 🟡 미착수 플랜 |
| `docs/tts-speed-plan.md` | 낭독 속도 4단계 | 🟡 미착수 플랜 |
| `docs/blog-to-video-plan.md` | 블로그 글 → 영상 | 🟡 미착수 플랜 |
| `docs/shopping-factory-gap-plan.md` | 경쟁 제품 갭 분석(전략) | 🟡 미착수 플랜 |
| `docs/shopping-factory-design-spec.md` | 위 전략의 상위 설계 | 🟡 미착수 플랜 |
| `docs/shopping-factory-execution-spec.md` | 위 설계의 태스크 목록 | 🟡 미착수 플랜 |
| `docs/shopping-factory-implementation-detail.md` | 경쟁 제품 해부 + 기술 사양 | 🟡 참고 자료 |
| `docs/beginner-guide.md` · `operations.md` · `electron.md` · `runtime.md` | 사용·운영 안내 | 🟢 살아 있음 |
| `docs/completion-audit.md` | 2026-06-23 검증 기록 | 🔴 낡음 — 그 시점 스냅샷 |
| `prompt_plan.md` | 2026-07-24 쿠팡 개편 1단계 | 🔴 낡음 — 이 매니페스트가 대체 |

---

## 6. 작업 규약

**착수 전**: 3개 파일 이상 바뀌는 일이면 계획을 먼저 문서로 쓰고 승인받는다. `docs/architecture.md`의 계약 표에 걸리는지 확인한다.

**완료 조건**: 테스트·린트·타입체크 **실행 결과**를 붙인다. "될 것 같다"는 완료가 아니다.

```bash
npm test          # vitest — 현재 398개
npm run lint      # eslint — error 0 유지 (max-lines 경고 7개는 기존 부채)
npm run typecheck # tsc --noEmit
npx playwright test  # e2e 5개
npm run verify    # 전체 게이트(빌드·샘플·렌더 스모크·릴리즈 번들까지)
```

**릴리즈**: 버전 올리기 → `npm run release:installer` → **win-unpacked 실행파일로 실제 동작 확인** → 태그 푸시 → `gh release create`에 `.exe` + `.blockmap` + `latest.yml` 세 개 모두 업로드. 자동 업데이트가 `latest.yml`을 본다.
최신: **v0.3.0** (2026-08-29).

**주의**: 테스트가 무겁게 겹치면(예: playwright 직후 vitest) 낭독·자막 테스트가 5초 제한에 걸려 흔들린다. 부하 없는 상태에서 다시 돌려 확인할 것.
