# 클로드코드 에이전트 연동 플랜 (앱 조종 비서)

> 2026-08-29 작성. 승인 전 구현 금지.
> 목표: 앱 안 대화창에서 "이 쿠팡 링크로 30초 쇼츠 뽑아줘" 한 줄 → 에이전트가 앱 기능을 도구로 호출해 끝까지 실행.
> 실행 주체: **설치된 Claude Code CLI**(`claude`)를 spawn — 사용자 구독을 그대로 쓰므로 추가 API 비용 0원.

## 0. 현재 상태 (코드 확인 완료)

| 항목 | 위치 | 상태 |
|---|---|---|
| `claude` CLI 스폰 | `local-server.mjs:1136-1145` | ✅ 단, `-p` one-shot 텍스트 생성 전용 |
| CLI 탐색(PATH/`CLAUDE_BIN`) | `local-server.mjs:1020-1031` | ✅ 재사용 |
| 스폰 위생(CLAUDECODE 제거·중립 cwd·stdin UTF-8) | `local-server.mjs:1043-1055` | ✅ 재사용 |
| 설치/로그인 감지 | `local-server.mjs:1265-1272`, `/api/agents/status` | ✅ 재사용 |
| 앱 기능 REST | `/api/*` 약 50개 | ✅ 그대로 도구로 승격 |
| 잡 큐·진행률 | `pipelineJobs`, `/api/jobs/:id` | ✅ 장시간 작업의 폴링 창구 |

**핵심 판단**: 앱 기능이 이미 전부 로컬 HTTP로 노출돼 있다. 새로 만들 것은 **도구 정의 계층 + 스트리밍 대화 창구 + UI**뿐이다. 파이프라인 로직은 한 줄도 건드리지 않는다.

## 1. 구조

```
[앱 UI 채팅]  ──SSE──  /api/assistant/chat  ──spawn──  claude -p --output-format stream-json
                                                          │  --mcp-config (stdio)
                                                          ▼
                                              scripts/mcp/shorts-mcp.mjs
                                                          │  fetch 127.0.0.1:<port>/api/*
                                                          ▼
                                                 기존 local-server 라우트
```

- MCP 서버는 **별도 stdio 프로세스**로 띄운다. 로컬 서버 포트를 `SHORTS_API_BASE` 환경변수로 물려주고, 도구 구현은 전부 기존 REST 호출로 끝낸다 → 로직 중복 0.
- 세션당 MCP 프로세스 1개, 대화 종료 시 트리째 종료(`killChildTree` 재사용).

## 2. 도구 카탈로그 (4가지 용도 전부 커버)

### A. 앱 조종 (용도 1)
| 도구 | 매핑 | 비고 |
|---|---|---|
| `list_projects` / `read_project` | `/api/project/read`, `/api/gallery/images` | 읽기 |
| `create_project` / `write_project` | `/api/project/write` | 쓰기 |
| `generate_script` | `/api/script/generate` | 톤·장르·길이 인자 |
| `analyze_coupang` | `/api/coupang/analyze` | 캡처 경로 또는 상품정보 |
| `list_voices` / `narrate` | `/api/voices`, `/api/narrate` | |
| `render` / `job_status` / `cancel_job` | `/api/render`, `/api/jobs/:id`, `/api/jobs/:id/cancel` | **비동기** — 잡 id 반환 후 폴링 |
| `run_product_pipeline` | `/api/product-pipeline` | 원클릭 체인 |
| `source_remix` | `/api/source-remix` | |

### B. 대본 품질 강화 (용도 2)
- `WebSearch` / `WebFetch`를 허용 목록에 추가(사실 기반·상품 조사 시). 지금 `useResearch` 분기를 이 경로로 흡수.
- `read_script_library` / `save_script` → `/api/scripts`
- 자기 검토 루프는 **도구가 아니라 시스템 프롬프트**로 처리: "초안 2개 → 후킹/길이 기준 자가 심사 → 승자 저장". 기존 `script-prompts.mjs`의 2초안+심사 규칙을 그대로 인용.

### C. 에러 자가 진단 (용도 3)
| 도구 | 내용 |
|---|---|
| `check_environment` | ffmpeg·python·TTS 데몬(8756)·yt-dlp 존재 여부 한 번에 |
| `read_job_log` | 실패 잡의 stderr/progress.json 꼬리 |
| `read_diagnostics` | `/api/diagnostics/save`가 남긴 기록 |
| `suggest_fix` | 도구 아님 — 위 3개를 읽고 원인·해결책을 한국어로 화면에 출력 |

**설정 자동 수정은 하지 않는다.** 진단·안내까지만. (환경설정 값은 사용자 자산 — 4항 참조)

### D. 편집 조작 (용도 4)
| 도구 | 매핑 |
|---|---|
| `read_timeline` / `patch_scene` | `/api/project/read`, `/api/project/write` (장면 단위 부분 수정) |
| `analyze_silence` | `/api/silence/analyze` |
| `generate_captions` / `save_captions` | `/api/captions/*` |
| `adjust_narration` | `/api/narrations/adjust` |

## 3. 안전 장치 (설계의 핵심)

1. **화이트리스트 전용**: `--allowedTools "mcp__shortsfactory__*" WebSearch WebFetch` + `--disallowedTools Bash Write Edit Read` + `--strict-mcp-config`. 에이전트는 우리가 정의한 도구 밖으로 못 나간다. 파일시스템 직접 접근 없음.
2. **경로 감옥**: 모든 쓰기 도구의 경로 인자는 `workspaceRoot/projects/<안전한이름>` 밑으로 정규화·검증(기존 `safeProjectName` 재사용). 상위 탈출(`..`) 차단.
3. **위험 작업 승인 게이트**: `render`·`delete_project`·`patch_scene`은 실행 전 UI에 "이 작업을 실행할까요?" 카드 표시 → 사용자가 누르기 전까지 도구가 대기. 자동 승인은 읽기 도구만.
4. **앱 종료·재시작 금지**: 에이전트에게 그런 도구를 주지 않는다. (진행 중 작업 파괴 방지 — 이 프로젝트의 절대 규칙)
5. **중첩 실행 방지**: 기존 CLAUDECODE 환경변수 제거 로직 유지.
6. **타임아웃·취소**: 대화 단위 15분 상한, UI에 중단 버튼. 중단 시 CLI + MCP + 손자 프로세스 트리째 종료.

## 4. 구현 단계

| Phase | 내용 | 파일 | 규모 |
|---|---|---|---|
| **1** | ✅ 완료 (2026-08-29) — MCP 도구 서버 15종 + `/api/projects` 신설 | `scripts/mcp/{api-client,tools,shorts-mcp}.mjs`, `local-server.mjs` | 테스트 20개 통과 |
| **2** | ✅ 완료 (2026-08-29) — 대화 런타임 + SSE 라우트 3종 | `scripts/server/assistant-runtime.mjs`, `local-server.mjs` | 테스트 22개 통과 |
| **3** | ✅ 완료 (2026-08-29) — 오른쪽 비서 패널 + 승인 게이트 | `app/assistant.js`, `index.html`, `styles.css`, `local-server.mjs`, `scripts/mcp/*` | e2e 2개 + 단위 3개 통과 |
| **4** | ✅ 완료 (2026-08-29) — 편집·진단 도구 7종 | `scripts/mcp/tools-edit.mjs`(신규), `app/assistant.js` | 테스트 7개 통과 |
| **5** | 세션 재개(`--resume`), 대화 보관, 비용/소요 표시 | 런타임·UI | 반나절 |

각 Phase 끝에 vitest 추가: 도구 인자 검증(zod)·경로 감옥·승인 게이트는 **테스트 먼저**.

## 5. 계약 (핵심 인터페이스)

```
POST /api/assistant/chat        { message, sessionId? }  → SSE
  event: text      { delta }            // 어시스턴트 발화
  event: tool      { name, input, id }  // 도구 호출 시작
  event: tool_end  { id, ok, summary }
  event: approval  { id, name, input }  // 승인 대기
  event: done      { sessionId, costUsd, durationMs }
  event: error     { message }
POST /api/assistant/approve     { id, approved }
POST /api/assistant/cancel      { sessionId }
GET  /api/assistant/status      → { installed, loggedIn, model }
```

CLI 호출 형태(검증 완료 — claude 2.1.251):
```
claude -p --output-format stream-json --verbose --input-format stream-json
       --mcp-config <임시 json> --strict-mcp-config
       --allowedTools mcp__shortsfactory__* WebSearch WebFetch
       --disallowedTools Bash Write Edit
       --append-system-prompt <앱 사용법·톤 규칙>
       [--resume <sessionId>]
```

## 6. 리스크

1. **CLI 미설치/미로그인** — 이미 감지 로직 있음. 채팅 패널 진입 시 안내 + 설치 명령 복사 버튼.
2. **응답 지연** — 도구 여러 개 도는 작업은 수 분. 진행 상황을 도구 단위로 스트리밍해 체감 지연을 줄인다.
3. **잘못된 조작** — 3항 승인 게이트가 1차 방어. 그래도 `patch_scene`은 원본 백업(`.bak`) 후 수정.
4. **패키징** — MCP 서버는 `scripts/**` 에 들어가므로 electron-builder `files` 설정 변경 불필요. `@modelcontextprotocol/sdk`를 dependencies에 추가(런타임 필요).
5. **모델 비용 인식** — CLI는 사용자 구독을 소모한다. 사용량 한도에 걸리면 대화가 막히므로 에러 메시지에 그 사실을 명시. → 12항에서 처리 완료.

## 7. Phase 1 완료 기록 (2026-08-29)

- 도구 15종: `app_health` `list_projects` `read_project` `write_project` `generate_script` `analyze_coupang` `list_voices` `narrate` `validate_project` `render` `list_jobs` `job_status` `cancel_job` `list_scripts` `save_script`
- 신설 엔드포인트: `GET /api/projects` (project.yaml 있는 폴더만, 최근 수정순)
- 결정 사항: 낭독(TTS)은 승인 게이트 **없이** 바로 실행(사용자 승인). MCP는 공식 SDK 사용.
- 검증: vitest 365개 전체 통과 · eslint 0 error · 실제 `claude` CLI로 도구 호출 왕복 성공(permission_denials 없음)

## 8. Phase 2 완료 기록 (2026-08-29)

- 라우트: `GET /api/assistant/status` · `POST /api/assistant/chat`(SSE) · `POST /api/assistant/cancel`
- SSE 이벤트: `session` `text` `thinking` `tool` `tool_end` `done` `error` — claude 2.1 stream-json 실측 형식 기준
- 안전: 도구 화이트리스트(`mcp__shortsfactory__*` WebSearch WebFetch ToolSearch) + `Bash/Edit/Write/Task/PowerShell/Skill` 차단, `--strict-mcp-config`, 중립 cwd, 15분 상한, 창 닫으면 CLI 트리째 종료
- 환경 위생: `CLAUDECODE` `CLAUDE_CODE_*` **및 `ELECTRON_RUN_AS_NODE`** 제거(이 변수가 남으면 자식이 GUI 없이 도는 사고가 실제로 있었다)
- 입력은 stream-json + 유니코드 이스케이프로 보낸다(로캘 무관).
- 검증: vitest 387개 전체 통과 · eslint 0 error · 실제 CLI로 도구 4회 연쇄 호출 성공 · 세션 재개 왕복 확인(1턴 "충청도 사투리" 기억 → 2턴 "사투리" 회상, $0.0085/13초)
- 남은 것: 승인 게이트는 UI(Phase 3)에서 MCP 도구가 앱에 물어보는 방식으로 구현한다. 현재 CLI에는 `--permission-prompt-tool`이 없어 이 경로가 유일하다.

## 9. Phase 3 완료 기록 (2026-08-29)

- 배치: 오른쪽 고정 패널(A안). 상단 "🤖 비서" 버튼으로 토글, 넓은 화면(1200px+)에서는 본문을 그만큼 좁혀 가리지 않는다.
- 화면 요소: 스트리밍 답변 · 도구 카드(실행 중/완료/실패 + 실패 사유) · 승인 카드 · 중단 버튼 · CLI 미설치·미로그인 안내 · 예시 3개
- 승인 게이트: `write_project` `render` `cancel_job` 3종. MCP 도구가 `POST /api/assistant/approval`로 앱에 물어보고 사용자가 누를 때까지 대기(최대 5분), 대화 종료·중단 시 전부 거절로 정리.
- 낭독(TTS)은 사용자 결정에 따라 승인 없이 바로 실행.
- 거절 문구는 "설정 문제가 아니라 사용자의 결정"임을 명시한다 — 그냥 "승인되지 않음"이라고 하면 에이전트가 권한 설정 오류로 오해했다(실측).
- 시스템 프롬프트를 역할/제약/검증/출력 구조로 재작성(사용자 가이드 프롬프트 패턴 반영). 핵심은 "도구가 성공을 돌려줘도 결과물을 확인하기 전엔 완료라고 하지 마라".
- 검증: vitest 391개 통과 · playwright 4개 통과 · eslint 0 error · 실제 CLI로 승인 카드 → 거절 → 에이전트가 사용자 결정으로 인식하는 왕복 확인

## 10. Phase 4 완료 기록 (2026-08-29)

추가 도구 7종 (총 22종):
- 진단: `check_environment` — ffmpeg·Whisper 등 외부 도구 존재 여부를 한 번에 확인
- 편집: `analyze_silence` `generate_captions` `save_captions`(승인 필요) `list_narrations` `adjust_narration`
- 파이프라인: `source_remix`(승인 필요)

설계 메모:
- 장면 단위 `patch_scene`은 만들지 않았다. `read_project` → 고친 YAML 전체 → `write_project`가 같은 일을 하고, 서버에 장면 단위 API가 없어 새로 만들 이유가 없다. 시스템 프롬프트가 "읽고→고치고→저장" 순서를 강제한다.
- 파일 업로드(영상·캡처)는 여전히 사람 몫이다. 에이전트에 파일시스템을 주지 않는 원칙을 유지했다.
- 검증: vitest 398개 통과 · playwright 4개 통과 · eslint 0 error · 실제 에이전트가 `check_environment`를 돌려 "로컬 Whisper만 빠짐 + 설치 명령"까지 정확히 보고($0.027)

## 11. Phase 5 완료 기록 (2026-08-29)

- 세션 재개: Phase 2에서 이미 동작(1턴 기억 → 2턴 회상 실측). UI가 `sessionId`를 들고 다닌다.
- 대화 보관: 최근 40개 말풍선을 localStorage에 남겨 앱을 껐다 켜도 이어진다. 도구 카드는 지난 실행이라 복원하지 않는다.
- 비용 표시: 완료 배지에 `완료 · 12초 · $0.027`.
- 고친 버그: 상태 확인(비동기)이 늦게 끝나면서 "완료" 표시를 "준비됨"으로 덮어쓰던 문제.
- 별건: `e2e/wizard.spec.mjs`의 템플릿 단언이 기본 5초 대기라 흔들렸다(`/api/script-templates`가 CLI를 띄워 실측 4.8~7.9초). 20초로 올렸다 — 이 작업과 무관한 기존 flaky.

## 12. 구독 한도 대응 (2026-08-30)

리스크 5의 후속. 앱은 토큰 값을 내지 않는 대신 **사용자의 구독 한도**를 태운다. 그 한도가 어떻게 생겼고 앱이 무엇을 할 수 있는지 확정했다.

### 한도 구조

| | 주기 | 리셋 |
|---|---|---|
| 세션 한도 | 5시간 **롤링** | 첫 요청 후 5시간 |
| 주간 한도 | 7일, 모든 모델 합산 | **고정 시각**(계정마다 다르게 배정) |

claude.ai · Claude Code · Desktop이 같은 풀을 쓴다. 사용자가 브라우저에서 쓰고 온 만큼 앱에서 쓸 몫이 줄어든다.

### 잔량 조회는 불가능하다 (확인 완료)

- `/usage`는 **대화형 슬래시 커맨드**다. 앱이 쓰는 `-p` 헤드리스 모드에서는 호출할 수 없다.
- `claude usage` CLI 명령 요청([anthropics/claude-code#40395](https://github.com/anthropics/claude-code/issues/40395))은 **Closed as not planned**.
- 잔량은 서버 응답에만 있고 로컬 파일에 없다. 즉 **"남은 한도 N%"를 미리 보여주는 기능은 만들 수 없다.** 나중에 다시 시도하지 말 것.

### 그래서 한 일 — ①상한을 걸고 ②멈춘 이유를 정확히 말한다

`scripts/server/usage-limit.mjs`(+ 테스트 12개)에 모아 두 호출부에 물렸다.

**① `--max-budget-usd` 상한** — print 모드 전용 플래그라 두 경로 모두에 쓸 수 있다.

| 경로 | 단위 | 기본값 | 환경변수 |
|---|---|---|---|
| `generateWithMethod`의 `agent-claude` (대본 생성·자막 보정) | 호출 1회 | $1 | `SHORTS_AGENT_BUDGET_USD` |
| `buildClaudeArgs` (비서 패널) | 대화 1세션 | $5 | `SHORTS_ASSISTANT_BUDGET_USD` |

자막 보정은 배치(`CORRECTION_BATCH_SIZE = 40`)마다 대본 전체를 다시 실어 보내며 반복 호출된다. 한 번의 폭주가 주간 한도를 통째로 먹는 걸 막는 게 이 상한의 목적이다. 실측 기준 대화 1턴이 $0.03 수준이라 기본값은 사고 방지용으로만 넉넉히 잡았다. 환경변수에 `0`이나 `off`를 주면 상한을 뗀다.

**② 한도 오류 4종 구분** — 대응이 서로 다르므로 뭉뚱그리면 안 된다.

| CLI 메시지 | 종류 | 대응 |
|---|---|---|
| `You've hit your session limit` | `session` | 대기 외 방법 없음 |
| `You've hit your weekly limit` | `weekly` | 대기 외 방법 없음 |
| `You've hit your Opus/Sonnet/Haiku limit` | `model` | **모델을 바꾸면 계속 쓸 수 있다** |
| `Budget limit reached` | `budget` | 앱이 건 상한. 작업을 나눠 재시도 |

- 단발 호출: `runAgentCommand` 실패 문구를 `describeAgentFailure`가 사용자 말로 바꾼다.
- 비서 패널: `result` 이벤트에 `limit` 필드를 실어 보내고, `app/assistant.js`가 상태를 "한도 도달"로 바꾸며 안내를 띄운다. `switchable`이면 모델 변경 안내를 덧붙인다.

**리셋 시각은 파싱하지 않는다.** CLI 메시지에 포함돼 오지만 형식을 고정으로 보장할 수 없어, 원문을 `detail`로 함께 넘겨 화면이 그대로 보여준다. 잘못 파싱한 시각보다 원문이 낫다.

⚠️ **이 4종 문구는 공식 문서 기준이고 실측이 아니다.** 이 프로젝트의 다른 CLI 연동(stream-json 형식 등)은 전부 실측으로 확정했지만, 한도 오류는 실제로 한도를 소진해야 재현되므로 아직 못 봤다. 다음에 누구든 한도에 걸리면 **원문을 그대로 기록해 두고** `usage-limit.mjs`의 정규식과 대조할 것. 매칭이 빗나가도 기존 오류 문구로 떨어질 뿐 동작은 깨지지 않는다(`describeAgentFailure`의 fallback).

### 하지 않기로 한 것

- **누적 사용량 표시**: 앱이 집계할 수 있는 건 "이 앱이 쓴 몫"뿐이고 브라우저에서 쓴 건 안 잡혀 전체 잔량이 아니다. Phase 5 이후 비용 표시를 뗀 판단(`app/assistant.js` 주석)과 같은 이유 — 오해를 부르는 숫자는 안 보여준다.
- **자동 모델 폴백**: `model` 한도일 때 앱이 알아서 모델을 바꾸는 것. 생성 방식은 사용자 자산이므로 안내까지만 하고 바꾸지 않는다(3항 원칙).
