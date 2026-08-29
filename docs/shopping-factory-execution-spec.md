# 쇼핑팩토리 추월 — 실행 명세서 (태스크 단위)

> 2026-07-07 작성. 착수 예정: 할당량 리셋 후.
> 이 문서 하나로 새 세션에서 바로 착수 가능하도록 자립적으로 작성한다.
> 상위 문서: `docs/shopping-factory-gap-plan.md`(전략), `docs/architecture.md`(구조 계약).

---

## 0. 착수 전 규약 (모든 태스크 공통)

### 0.0 ⚠ 착수 순서 변경 (2026-07-07 조사 반영)

**`docs/shopping-factory-design-spec.md`를 먼저 읽을 것.** 웹 조사 결과 아래가 확정됐다:
- 캡컷 6+는 draft를 **암호화** → T4.13~T4.16은 T0.1 프로브 결과에 따라 분기(대안: 폴더 내보내기/FCPXML)
- 자막 제거는 **직접 구현 금지** → `video-subtitle-remover`(STTN) 어댑터 연결로 대체(T4.4)
- 더우인은 쿠키 필수+불안정, 샤오홍슈는 지원 불명 → 플랫폼 신뢰도 등급을 UI에 노출(T1.2)

**수정된 착수 순서**: `T0.5(매니페스트) → T0.6(어댑터 골격) → T0.7(순환import 린트) → T0.1~T0.4(프로브) → T1.1~`

## 0.1 태스크 실행 사이클 (예외 없음)
1. **RED** — 테스트 먼저 작성 → 실행 → 실패 확인
2. **GREEN** — 최소 구현 → 테스트 통과
3. **검증** — `npx vitest run` 전체 + `npx tsc --noEmit` + `npx eslint .`
4. **계약 갱신** — 계약이 생기면 `docs/architecture.md` 표에 한 줄 추가

### 0.2 상자 배치 규칙 (architecture.md 준수)
| 작업 성격 | 위치 |
|---|---|
| 순수 로직·스키마 | `src/` (도메인) |
| 프롬프트 문자열 | `scripts/server/*-prompts.mjs` (부수효과 금지) |
| HTTP·큐·상태 | `scripts/local-server.mjs` (얇게) |
| 초 단위 이상 무거운 실행 | `src/cli/commands/*.ts` (CLI) |
| 외부 서비스 어댑터 | `scripts/*-generator.mjs` |
| 화면 | `app/*.js` (서버 API만 호출) |

### 0.3 파일 크기
- 800줄 초과 금지(eslint 경고). 새 기능은 새 모듈로.
- 신규 모듈 명명: `scripts/server/<도메인>.mjs`, `src/<도메인>/<기능>.ts`

### 0.4 착수 전 준비물 (사람이 미리)
- [ ] `winget install yt-dlp` 또는 `pip install -U yt-dlp` (Phase 1 필수)
- [ ] 드롭샷 로그인 상태 확인 (세션 자주 만료됨)
- [ ] 타입캐스트 API 키 확인
- [ ] 폰트 라이선스 확인 — 상업 배포 시 필수 (Phase 4에서 번들)
- [ ] 테스트용 참고 영상 URL 3개(틱톡·유튜브·인스타 각 1)

### 0.5 회귀 방지 절대 규칙
- 기존 스토리 위저드/쿠팡 모드/소스 짜집기 동작을 바꾸지 않는다. 신규는 **추가 경로**로만.
- 문장 분할 규칙 3곳(`tts/chunk.ts`, 서버 `splitSentencesForDelivery`, `splitScenesForShots`) 동기화 유지.
- 낭독·파이프라인 동시 실행 금지(큐) 계약 유지.

---

# PHASE 1 — 입구 (링크 → 다운로드 → 제품 인식 → 검색어 팩)

**완료 정의(DoD):** 틱톡/유튜브 링크 하나 붙여넣고 "분석" 누르면 → 영상이 받아지고 → 제품명·특징이 자동 인식되고 → 6대 사이트 검색 버튼이 뜬다.

### 1-A. yt-dlp 통합

**T1.1** yt-dlp 실행파일 탐지
- 파일: `scripts/local-server.mjs` (기존 `findExecutable` 재사용)
- 구현: `findExecutable('yt-dlp', 'YTDLP_PATH')`, 도구 상태 목록에 `yt-dlp` 행 추가
- 테스트: `local-server.test.mjs` — "reports yt-dlp availability in tools status"
- 검증: `curl /api/tools` 응답에 yt-dlp 항목 존재

**T1.2** yt-dlp 인자 빌더 (순수 함수)
- 파일: `src/sourcing/ytdlp.ts` (신규)
- 시그니처: `buildYtDlpArgs(url: string, opts: {outPath: string; maxHeight?: number; cookiesFrom?: string}): string[]`
- 규칙: `-f "bv*[height<=1920]+ba/b"`, `--no-playlist`, `--merge-output-format mp4`, `-o outPath`
- 테스트: `src/sourcing/ytdlp.test.ts` — "URL과 출력 경로로 인자를 만든다", "플레이리스트는 단일 영상으로 제한한다"

**T1.3** yt-dlp 에러 분류기 (순수 함수)
- 파일: 같은 파일
- 시그니처: `classifyYtDlpError(stderr: string): 'private'|'geo'|'login-required'|'unsupported'|'network'|'unknown'`
- 테스트: 각 케이스 1개씩 5개
- 이유: 사용자에게 "왜 실패했는지" 정확히 알려주기 위함(틱톡은 자주 막힘)

**T1.4** 소스 다운로드 CLI
- 파일: `src/cli/commands/fetchSource.ts` (신규)
- 시그니처: `runFetchSource(url: string, options: {outDir: string; timeoutSec?: number}): Promise<number>`
- 동작: yt-dlp 실행 → 실패 시 T1.3 분류 → `fetch-report.json` 기록(경로, 길이, 해상도, 실패 사유)
- CLI 등록: `src/cli/index.ts` — `fetch-source <url> --out-dir <dir>`
- 검증: 실제 유튜브 링크 1개로 다운로드 성공 확인

**T1.5** 서버 API: 소스 가져오기
- 파일: `scripts/local-server.mjs`
- 엔드포인트: `POST /api/source/fetch` `{url, projectName}` → 기존 작업 큐에 등록 → `{jobId}`
- 진행 보고: 기존 `progress.json` 계약 재사용(stages: `[fetch, identify]`)
- 테스트: "queues a source fetch job"

### 1-B. 제품 인식 (비전)

**T1.6** 대표 프레임 선정 (순수 함수)
- 파일: `src/sourcing/frames.ts` (신규)
- 시그니처: `pickFrameTimestamps(durationSec: number, count = 5): number[]`
- 규칙: 처음/끝 5% 제외, 균등 분할
- 테스트: "짧은 영상은 프레임 수를 줄인다", "시작·끝 여백을 피한다"

**T1.7** 프레임 추출 실행
- 파일: `src/cli/commands/fetchSource.ts`에 병합 (기존 `buildFrameExtractArgs` 재사용 — `scripts/server/source-remix.mjs`)
- 산출: `frames/frame_01.png` ~ `frame_05.png`

**T1.8** 제품 인식 프롬프트
- 파일: `scripts/server/product-discovery.mjs` (신규)
- 시그니처: `productIdentifyPrompt(): string`
- 출력 계약(JSON): `{productName, category, features: string[], useCases: string[], targetBuyer}`
- 테스트: `product-discovery.test.mjs` — "프롬프트에 JSON 출력 규약이 포함된다"

**T1.9** 비전 응답 파서
- 파일: 같은 파일
- 시그니처: `parseProductIdentity(raw: string): ProductIdentity | null`
- 규칙: 코드펜스·설명 섞여도 JSON 블록만 관대하게 추출(기존 `parseShotResponse` 패턴 재사용)
- 테스트: 정상/코드펜스 포함/깨진 JSON 3케이스

**T1.10** 서버: 인식 파이프라인 연결
- 기존 비전 인프라(`openaiVisionContent`/`geminiVisionParts`/`claudeVisionContent`) 사용
- 실패 시 폴백: 제품명 수동 입력 필드로 진행 가능해야 함

### 1-C. 6대 사이트 검색어 팩

**T1.11** 다국어 검색어 프롬프트
- 파일: `scripts/server/product-discovery.mjs`
- 시그니처: `searchKeywordPrompt(identity: ProductIdentity): string`
- 출력 계약: `{ko: string[], zh: string[], en: string[]}` 각 3~5개
- 규칙: 중국어는 **샤오홍슈/더우인 실사용 표현**으로(직역 금지)

**T1.12** 검색 URL 빌더 (순수 함수) ★테스트 쉬움
- 파일: `src/sourcing/searchUrls.ts` (신규)
- 시그니처: `buildSearchUrls(keywords: {ko: string[]; zh: string[]; en: string[]}): SearchLink[]`
- 사이트별 패턴:
  | 사이트 | 언어 | URL 패턴 |
  |---|---|---|
  | 틱톡 | ko/en | `https://www.tiktok.com/search?q={q}` |
  | 인스타그램 | ko/en | `https://www.instagram.com/explore/tags/{tag}/` |
  | 샤오홍슈 | zh | `https://www.xiaohongshu.com/search_result?keyword={q}` |
  | 더우인 | zh | `https://www.douyin.com/search/{q}` |
  | 바이두 | zh | `https://image.baidu.com/search/index?tn=baiduimage&word={q}` |
  | 유튜브 | ko/en | `https://www.youtube.com/results?search_query={q}` |
- 테스트: "사이트별 URL을 만든다", "한글·중문을 URL 인코딩한다", "인스타 태그는 공백을 제거한다"

**T1.13** 이미지 역검색 링크
- 시그니처: `buildReverseImageUrls(publicImageUrl: string): SearchLink[]`
- 대상: Google Lens, Bing Visual, Yandex
- 주의: 로컬 파일은 역검색 불가 → **업로드 없이 되는 방식만** 제공하거나, "이미지 복사 후 붙여넣기" 안내로 폴백
- 테스트: URL 3종 생성

**T1.14** UI: 제품 찾기 화면
- 파일: `app/product-discovery-mode.js` (신규, 800줄 규칙 준수)
- 구성: 링크 입력 → [분석] → 진행바 → 결과 카드(썸네일·제품명·특징) → 검색 버튼 그리드(6사이트 × 언어) → 프레임 갤러리(역검색 버튼)
- 버튼 클릭 = `window.open(url)`
- 서브탭 등록: `app/app.js` wizardSubs에 `{id:'discovery', label:'제품 찾기'}`

**T1.15** Phase 1 통합 검증
- 실제 유튜브 링크로 E2E 1회: 다운로드 → 프레임 → 인식 → 검색어 → 버튼 클릭 열림
- 실패 폴백 확인: 잘못된 링크 → 명확한 한국어 오류

---

# PHASE 2 — 영상 보고 대본 (비전 조립)

**DoD:** 편집된(또는 소스) 영상을 넣으면 장면 구간별로 대본이 생성되고, 각 문장이 어느 구간에 붙는지 타임코드가 나온다.

**T2.1** 장면 경계 감지 인자 빌더
- 파일: `src/sourcing/sceneDetect.ts` (신규)
- 시그니처: `buildSceneDetectArgs(videoPath: string, threshold = 0.3): string[]`
- ffmpeg: `-vf "select='gt(scene,{threshold})',showinfo" -f null -`
- 테스트: 인자 생성 1개

**T2.2** showinfo 출력 파서
- 시그니처: `parseSceneTimestamps(stderr: string): number[]`
- 테스트: 실제 로그 샘플 문자열로 파싱 검증(3케이스)

**T2.3** 장면 구간 병합 규칙 (순수 함수)
- 시그니처: `mergeShortScenes(timestamps: number[], durationSec: number, minSec = 1.2): Array<{start:number; end:number}>`
- 이유: 컷이 잦으면 대본이 파편화됨
- 테스트: "1.2초 미만 구간은 앞 구간에 병합", "빈 배열이면 전체 1구간"

**T2.4** 구간별 대표 프레임 추출 (T1.7 재사용)

**T2.5** 장면 해설 프롬프트 (비전)
- 파일: `scripts/server/video-script.mjs` (신규)
- 시그니처: `sceneDescribePrompt(count: number): string`
- 출력: `[{index, seconds, whatIsShown, sellingPoint}]`

**T2.6** 구간 대본 생성 프롬프트
- 시그니처: `videoScriptPrompt(scenes, identity, styleProfile?, targetSec): string`
- 규칙: 구간 길이에 맞는 글자 수 배분(초당 약 4.5자 기준), 첫 구간은 후킹
- 출력: `[{index, start, end, line}]`

**T2.7** 대본-구간 매핑 파서 + 검증
- 시그니처: `parseTimedScript(raw, sceneCount): TimedLine[] | null`
- 규칙: 구간 수 불일치 시 보정(부족하면 마지막 구간 확장, 넘치면 병합)
- 테스트: 정상/부족/초과 3케이스

**T2.8** 글자수-시간 적합성 검사 (순수 함수)
- 시그니처: `fitScriptToDurations(lines: TimedLine[], charsPerSec = 4.5): {line, overflowSec}[]`
- 용도: UI에서 "이 구간은 0.8초 초과" 경고 표시
- 테스트: 초과/미달/정확 3케이스

**T2.9** 서버 API: 영상 대본 생성
- `POST /api/video-script` `{videoPath|projectName, identity?, styleId?, targetSec}` → 잡 등록
- stages: `[scenes, describe, script]`

**T2.10** UI: 구간 대본 편집기
- 파일: `app/video-script-editor.js` (신규)
- 구성: 좌측 구간 리스트(썸네일+타임코드), 우측 대본 textarea, 구간 클릭 시 **해당 구간만 재생**, 초과 경고 배지, [이 구간만 재생성] 버튼

**T2.11** Phase 2 통합 검증 — 실제 영상 1개로 구간별 대본 + 타임코드 확인

---

# PHASE 3 — 스타일 학습 & 레퍼런스 모음집

**DoD:** 잘 나가는 영상 링크를 넣으면 톤·구조·자막 패턴이 분석되어 저장되고, 그 스타일로 대본을 재생성할 수 있다.

**T3.1** 스타일 프로필 스키마
- 파일: `src/style/styleProfile.ts` (신규)
- zod: `{id, name, sourceUrl?, tone, sentence: {avgChars, endings: string[]}, hook: {pattern, examples: string[]}, structure: string[], captionStyle: {position, maxChars, emphasis}, createdAt}`
- 테스트: 유효/무효 3케이스

**T3.2** 레퍼런스 분석 프롬프트
- 파일: `scripts/server/style-learn.mjs` (신규)
- 시그니처: `styleAnalyzePrompt(transcript: string, sceneNotes: string[]): string`
- 출력: T3.1 스키마와 동일한 JSON

**T3.3** 분석 파서 + 스키마 검증
- 시그니처: `parseStyleProfile(raw, fallbackName): StyleProfile | null`

**T3.4** 레퍼런스 분석 CLI
- 파일: `src/cli/commands/analyzeStyle.ts` (신규)
- 흐름: yt-dlp(T1.4 재사용) → Whisper STT(기존 `autoCaption`) → 프레임 비전(T2.5) → 프로필 JSON
- CLI: `analyze-style <url> --out <path>`

**T3.5** 프로필 저장소
- 파일: `scripts/local-server.mjs` + `projects/style-profiles.json`
- API: `GET /api/styles`, `POST /api/styles`, `DELETE /api/styles/:id`
- 테스트: 저장/목록/삭제 3개 + 중복 이름 거부

**T3.6** 프로필 → 프롬프트 주입
- 파일: `scripts/server/script-prompts.mjs`
- 시그니처: `styleProfileSpec(profile: StyleProfile | null): string`
- 규칙: 프로필 있으면 톤/어미/후킹 패턴/구조를 프롬프트에 못박음
- 테스트: "프로필이 있으면 어미와 후킹 패턴이 프롬프트에 들어간다"

**T3.7** 충청도 사투리 프로필 프리셋 (시드 데이터)
- 내용: 어미 `~여/~겨/~하잖유/~혀`, 후킹 `"이거 하나면 끝이여"` 류, 45~70자, 과장 금지·체감 강조
- 이유: 하드코딩 대신 프로필로 넣으면 사용자가 나중에 수정 가능

**T3.8** UI: 스타일 분석 화면 (링크 입력 → 분석 → 이름 지정 → 저장)

**T3.9** UI: 레퍼런스 모음집 (저장된 프로필 카드 목록, 원본 링크, 요약, [이 스타일로 생성])

**T3.10** 대본 생성 화면에 스타일 선택 드롭다운 + [이 스타일로 다시 생성]

**T3.11** Phase 3 통합 검증 — 실제 영상으로 프로필 생성 → 그 스타일로 대본 재생성 → 어미·구조 반영 확인

---

# PHASE 4 — 마감 품질 (자막 제거 · 자막 에디터 · 캡컷)

**DoD:** 소스의 박힌 자막이 눈에 띄게 사라지고, 자막 스타일을 자유롭게 꾸미며, 캡컷으로 열어 후편집할 수 있다.

### 4-A. 자막 제거

**T4.1** 자막 밴드 감지 정밀화
- 파일: `src/modes/remixPlan.ts` (기존 blur 로직 옆)
- 시그니처: `detectSubtitleBand(frameAnalyses: BandSample[]): {top:number; bottom:number} | null`
- 개선: 여러 프레임에서 **텍스트가 반복 등장하는 y구간**의 교집합
- 테스트: 샘플 데이터 3케이스

**T4.2** delogo 필터 빌더
- 시그니처: `buildDelogoFilter(width, height, band): string | null`
- ffmpeg: `delogo=x=..:y=..:w=..:h=..:show=0`
- 테스트: 밴드 → 필터 문자열 2케이스

**T4.3** 블러/제거 모드 선택
- 계약: `subtitleRemoval: 'none' | 'blur' | 'delogo' | 'inpaint'`
- 기존 blur 기본값 유지(회귀 방지), 신규 옵션만 추가

**T4.4** 인페인팅 어댑터 (선택 기능)
- 파일: `scripts/inpaint-generator.mjs` (신규)
- 방식: 로컬 GPU(LaMa/STTN) 파이썬 스크립트 호출, 없으면 자동으로 delogo 폴백
- 주의: **없어도 앱이 동작해야 함** (하드 의존 금지)

**T4.5** 자막 제거 결과 비교 UI (전/후 프리뷰)

### 4-B. 자막 스타일 에디터

**T4.6** 자막 스타일 스키마 확장
- 파일: `src/config/schema.ts` (기존 style 확장, **하위호환 필수**)
- 추가: `{fontFamily, fontSize, color, strokeWidth, strokeColor, bgColor, bgOpacity, x, y, effect: 'none'|'pop'|'shadow'|'typewriter'}`
- 테스트: 기존 project.yaml이 그대로 통과하는지 (회귀)

**T4.7** drawtext 필터 빌더 확장
- 파일: `src/modes/storyAssets.ts`
- **계약 유지**: 스타일 미지정 시 기존 출력과 바이트 동일(회귀 테스트 이미 존재)
- 테스트: "스타일 지정 시 폰트·색·테두리가 반영된다", "미지정 시 종전과 동일"

**T4.8** 폰트 번들 + 목록 API
- 폴더: `assets/fonts/` + `fonts.json`(이름, 파일, 라이선스)
- API: `GET /api/fonts`
- ⚠ **상업 배포 시 라이선스 확인 필수** — SIL OFL 계열 우선

**T4.9** UI: 자막 스타일 패널 (폰트·크기·색·테두리·배경·효과)

**T4.10** UI: 자막 위치 드래그 + XY 중앙 정렬 버튼

**T4.11** UI: 실시간 프리뷰 (대표 프레임 위에 캔버스 오버레이)

**T4.12** 상하 템플릿(레터박스 바) 지원

### 4-C. 캡컷 내보내기

**T4.13** 캡컷 draft 구조 조사 (문서화 태스크)
- 산출: `docs/capcut-draft-format.md` — 실제 draft 폴더/JSON 필드 매핑
- 방법: 로컬 캡컷 draft 하나 만들어 구조 역분석

**T4.14** draft JSON 생성기 (순수 함수)
- 파일: `src/export/capcutDraft.ts` (신규)
- 시그니처: `buildCapcutDraft(input: {clips, audio, subtitles, bgm, canvas}): object`
- 테스트: 필수 필드 존재/트랙 순서/타임라인 길이 3케이스

**T4.15** draft 폴더 쓰기 CLI (`export-capcut <project> --out <capcut draft dir>`)

**T4.16** UI: [캡컷으로 내보내기] 버튼 + 경로 안내

**T4.17** Phase 4 통합 검증 — 실제 캡컷에서 열어 트랙 정상 확인

---

# PHASE 5 — 하이브리드 생성 (우리만의 킬러)

**DoD:** 소스가 부족하거나 아예 없어도 영상이 완성된다. 소스/AI 비율을 사용자가 조절한다.

**T5.1** 소스 커버리지 계산 (순수 함수)
- 파일: `src/modes/remixPlan.ts`
- 시그니처: `calcCoverage(scriptLines: TimedLine[], sources: RemixSource[]): {coveredSec, neededSec, gaps: Array<{start,end,line}>}`
- 테스트: 충분/부족/전무 3케이스

**T5.2** 갭 → AI 생성 요청 변환
- 시그니처: `gapsToGenerationTasks(gaps, identity, style): Array<{prompt, durationSec, refImages}>`
- 규칙: 상품 이미지(쿠팡 캡처) 참조 + 감독 문법 재사용

**T5.3** 갭 자동 채우기 파이프라인
- 흐름: 갭 감지 → 드롭샷 이미지 생성 → i2v(힉스필드/시댄스) → 소스 목록에 삽입
- 기존 모듈 재사용(신규 코드 최소)

**T5.4** 모드 스위치 계약
- `sourceMode: 'remix' | 'hybrid' | 'original'`
  - remix = 지금 동작(회귀 없음)
  - hybrid = 부족분만 AI
  - original = 소스 0개, 전부 AI
- 테스트: 모드별 파이프라인 분기 3케이스

**T5.5** UI: 모드 선택 + 커버리지 게이지("소스로 12초 / 부족 8초 → AI로 채움")

**T5.6** 목소리 프리셋 저장 (타입캐스트 voice+emotion+speed, 내 목소리 클로닝)
- API: `GET/POST /api/voice-presets`

**T5.7** Phase 5 통합 검증 — 소스 0개로 완성본 1편, 소스 1개+갭으로 1편

---

# PHASE 6 — 수익화 도구 (SEO 패키지 · 링크 페이지)

**DoD:** 완성 후 플랫폼별 문구가 한 번에 나오고, 내 상품 링크 페이지를 만들어 배포할 수 있다.

**T6.1** SEO 프롬프트
- 파일: `scripts/server/upload-pack.mjs` (신규)
- 출력 계약: `{titles: string[5], platforms: {tiktok, instagram, youtube, naverClip, x}: {caption, hashtags: string[], commentCta}}`

**T6.2** SEO 파서 + 스키마 검증 (3케이스)

**T6.3** 업로드 패키지 산출 (`50-upload/upload.md` + 클립보드 복사 버튼)

**T6.4** 링크 페이지 스키마
- 파일: `src/linkpage/schema.ts`
- zod: `{slug, profile:{name,bio,avatar}, theme:{color,font,layout,border}, notice, blocks: Array<{type:'link'|'text', title, url?, thumb?}>, businessEmail}`
- **필수**: 공정위 문구(수수료 고지) 기본값 포함

**T6.5** 정적 페이지 생성기 (순수 함수)
- 시그니처: `buildLinkPageHtml(config): string` — 인라인 CSS, 외부 의존 0
- 테스트: 필수 요소(수수료 고지·블록 수·slug) 3케이스

**T6.6** 링크 페이지 CRUD API + 로컬 미리보기

**T6.7** UI: 링크 페이지 빌더 (프로필·테마·블록 관리·미리보기)

**T6.8** 쿠팡 링크 블록 도우미 (링크 붙여넣기 → 썸네일 URL·상품명 입력 → 블록 추가)

**T6.9** 배포: GitHub Pages 푸시 (무료) 또는 정적 파일 내보내기
- 주의: 토큰은 환경변수만, 디스크 저장 금지

**T6.10** Phase 6 통합 검증 — 페이지 생성 → 배포 → 모바일에서 열림 확인

---

## 실행 순서 & 의존 그래프

```
Phase 1 (입구) ──┬─→ Phase 2 (영상→대본) ──→ Phase 3 (스타일 학습)
                 │                              │
                 └─→ Phase 5 (하이브리드) ←──────┘
                            │
Phase 4 (마감 품질) ────────┴─→ Phase 6 (수익화)
```
- **Phase 1은 무조건 먼저** (입구가 없으면 나머지가 무의미)
- Phase 4는 언제든 병렬 가능(독립적)
- Phase 5는 Phase 1 완료 후 바로 가능(가장 큰 차별점 → 우선순위 올릴 가치 있음)

## 일주일 스케줄 예시 (하루 4~6시간 기준)

| 일 | 작업 |
|---|---|
| 1 | T1.1~T1.5 (yt-dlp·다운로드 CLI·API) |
| 2 | T1.6~T1.15 (인식·검색어·UI·검증) |
| 3 | T2.1~T2.8 (장면 감지·대본 생성 로직) |
| 4 | T2.9~T2.11 + T5.1~T5.4 (UI + 하이브리드 로직) |
| 5 | T5.5~T5.7 + T3.1~T3.4 (킬러 기능 마무리 + 스타일 학습 시작) |
| 6 | T3.5~T3.11 (스타일 저장·UI·검증) |
| 7 | T6.1~T6.3 (SEO 패키지) + 전체 회귀 검증 |
| 이후 | Phase 4(마감 품질), Phase 6 나머지 |

## 리스크 대응표

| 리스크 | 신호 | 대응 |
|---|---|---|
| yt-dlp가 틱톡 차단 | `login-required`/`unsupported` | 파일 직접 넣기 폴백 UI 상시 노출 |
| 비전 API 비용 | 프레임 5장×잦은 호출 | 프레임 3장으로 축소, 결과 캐시(제품 해시 키) |
| 캡컷 포맷 변경 | draft 안 열림 | 버전 명시 + 실패 시 MP4/SRT 개별 내보내기 폴백 |
| 인페인팅 GPU 부족 | VRAM 오류 | delogo 자동 폴백(하드 의존 금지) |
| 폰트 라이선스 | 상업 배포 | OFL 계열만 번들, 나머지는 사용자 설치 안내 |
| 파일 비대화 | eslint max-lines 경고 | 신규는 새 모듈로, 기존 3개는 별도 분할 태스크 |

## 새 세션 착수 프롬프트 (복붙용)
```
docs/shopping-factory-execution-spec.md 읽고 T1.1부터 순서대로 진행해줘.
각 태스크는 RED→GREEN→전체검증 사이클 지키고, 기존 동작 회귀 없어야 해.
```
