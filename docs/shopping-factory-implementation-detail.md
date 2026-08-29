# 구현 상세 명세 — 경쟁 제품 해부 & 기능별 기술 사양

> 2026-07-07. 근거: 판매 페이지 데모(18분) + **강의 커리큘럼 15챕터** + 웹 조사.
> 이 문서는 "저쪽이 어떻게 만들었는지"를 증거로 추정하고, **우리가 무엇으로 어떻게 이길지**를 코드 레벨로 규정한다.

---

# PART 0. 경쟁 제품 완전 해부

## 0.1 비즈니스 모델 (그대로 노출됨)
| 항목 | 값 |
|---|---|
| 가격 | **880,000원** / 12개월 이용권 + VOD 15챕터 + 단톡방 |
| 규모 | 2기 수강생 62명 (1기 포함 100~150명 추정) |
| 과금 | **포인트 충전제** — 기능별 차감. **본인 API 키 등록 시 무료 전환** |
| 제한 | **하루 최대 10개** 제작 |
| 모집 | 기수제 한정 (희소성 마케팅) |

→ **추정 매출: 8,800만~1.3억** (1~2기). 도구 자체보다 **커리큘럼+커뮤니티**로 값을 만든다.

## 0.2 메인 8단계 파이프라인 (공식 명칭)
| # | 단계 | 내용 |
|---|---|---|
| 1 | 영상 분석 ANALYZE | 참고 영상 URL + 길이·언어 선택 |
| 2 | 영상 선택 PICK | 같은 제품 영상 검색 → 클릭 담기 |
| 3 | 스크립트 & 음성 SCRIPT | **장면 맞춤 / 자유 / 수동** 3모드 |
| 4 | 스타일 설정 STYLE | 자막 위치·폰트·색 + **헤드카피 + 워터마크** 실시간 미리보기 |
| 5 | 음성 프리뷰 VOICE CHECK | TTS 미리듣기 → 속도·목소리 재선택 |
| 6 | 썸네일 THUMBNAIL | **AI 생성** or 직접 업로드 |
| 7 | SEO 문구 | 제목·설명·태그 |
| 8 | 내보내기 EXPORT | 9:16 완성본 (하루 10개) |

## 0.3 부가 도구 9종
1. **네이버 쇼핑순위** — 카테고리별 인기검색어 TOP20, 전일 대비 급등, 연령·성별 타겟
2. **쿠팡 쇼핑순위** — 판매 랭킹·골드박스·급상승 매일 자동 수집
3. **인스타 모니터링** — 쇼핑 릴스 성과 지표 + "왜 터졌는지" 분석
4. **제품 찾기** — 키워드·URL로 틱톡/샤오홍슈 검색
5. **자막 제거** — 인페인팅·블러·GPU 등 **4가지 방식**
6. **TTS 생성기** — **장면 길이에 맞춰 속도 자동 조절**
7. **내 쇼핑 링크** — 상품 URL만 넣으면 **썸네일·상품명 자동 입력**
8. **실적 리포트** — 클릭·주문·수익 날짜별
9. **영상 스타일 분석실** — 톤·구조·훅 분석 + **레퍼런스 모음집 공유**

---

# PART 1. ★ 결정적 발견 — 저쪽의 실제 구현 방식

> 커리큘럼 15챕터가 구현의 자백서다. **강의로 가르쳐야 한다는 건 = 자동화가 안 된다는 뜻.**

### 발견 ① 자막 제거는 **외부 유료 API 아웃소싱**
> 커리큘럼 12번: **"자막제거 사이트 가입 및 api 적용방법"**

사용자가 **별도 사이트에 가입하고 API 키를 등록**해야 한다 = 저쪽 서버가 처리하지 않는다.
**→ 우리는 로컬 GPU(RTX 4060)로 무료·무제한.** 가장 큰 차별점.

### 발견 ② 더우인·샤오홍슈는 **수동 로그인**
> 커리큘럼 5번: "도우인 설치 및 PC 로그인 가이드", 6번: "샤오홍슈 설치 및 PC 로그인 가이드"

**PC 앱을 설치하고 직접 로그인**하라고 가르친다 = 완전 자동 수집이 아니다.
내 yt-dlp 조사(더우인 쿠키 필수·불안정, 샤오홍슈 미지원)와 **정확히 일치**. 저쪽도 못 뚫었다.
**→ 우리도 자동 수집을 약속하지 않는다. 대신 "검색어+원클릭 열기"를 더 매끄럽게.**

### 발견 ③ 수익화 = **쿠팡 파트너스 공식 API + 본인 키**
> "본인의 쿠팡 파트너스 API 키를 등록하면 모든 링크가 본인 계정으로 생성"

HMAC-SHA256 서명 기반 공개 API를 그대로 쓴다. 우리도 동일하게 가능하며 **기술 장벽이 없다**.

### 발견 ④ 포인트 과금 = **클라우드 비용 전가**
LLM·TTS·자막제거를 클라우드로 돌리니 포인트를 깎는다. 하루 10개 제한도 같은 이유.
**→ 우리는 로컬(Qwen3 TTS·드롭샷 무제한·로컬 인페인팅)이라 한계비용 0. 제한 없음.**

### 발견 ⑤ 캡컷은 **부차 기능**
> FAQ: "수동 편집도 가능하며, 마지막 내보내기를 캡컷으로 진행하시면 됩니다"

핵심 흐름이 아니라 옵션. **캡컷 6+ 암호화 문제를 저쪽도 피해간 정황.**
**→ 우리도 폴더 내보내기를 기본, 캡컷은 실험 기능으로.**

---

# PART 2. 기능별 구현 상세 (기술 사양)

## 2-A. 영상 분석 (ANALYZE) — T1.x

**저쪽 방식**: URL → 다운로드 → 제품 인식 → 6대 사이트 검색어
**우리 방식**: 동일 + 신뢰도 등급 노출

```ts
// src/sourcing/platform.ts
export const PLATFORM_RELIABILITY = {
  youtube:   {grade:'A', cookies:false, note:'안정'},
  tiktok:    {grade:'A', cookies:false, note:'공개 영상 안정'},
  instagram: {grade:'B', cookies:true,  note:'비공개는 쿠키 필요'},
  douyin:    {grade:'C', cookies:true,  note:'쿠키 자주 만료 — 실패 시 수동'},
  xiaohongshu:{grade:'D', cookies:true, note:'미지원 가능 — 수동 우선'},
} as const
export function detectPlatform(url: string): PlatformId | 'unknown'
```
- 테스트: 각 플랫폼 URL 패턴 6개 + unknown 1개
- **UI**: URL 입력 즉시 플랫폼 배지 표시("틱톡 · 안정" / "샤오홍슈 · 수동 권장")

**yt-dlp 호출 규격**
```ts
buildYtDlpArgs(url, {outPath, cookiesFromBrowser}) => [
  '--no-playlist', '--no-warnings', '--newline',        // --newline: 진행률 파싱용
  '-f', 'bv*[height<=1920][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b',
  '--merge-output-format', 'mp4',
  '--socket-timeout', '20', '--retries', '3',
  ...(cookiesFromBrowser ? ['--cookies-from-browser', cookiesFromBrowser] : []),
  '-o', outPath, url,
]
```
- **진행률 파싱**: `[download]  45.2% of ...` 정규식 → 작업 카드 게이지에 반영
- 에러 분류 매핑표:
  | stderr 키워드 | code | userMessage |
  |---|---|---|
  | `Private video`, `login required`, `Sign in` | LOGIN_REQUIRED | "로그인이 필요한 영상입니다. 파일로 직접 넣어주세요." |
  | `not available in your country`, `geo` | GEO_BLOCKED | "지역 제한 영상입니다." |
  | `Unsupported URL` | UNSUPPORTED | "이 사이트는 자동 다운로드를 지원하지 않습니다. 파일로 넣어주세요." |
  | `HTTP Error 4xx/5xx`, `timed out` | NETWORK | "네트워크 오류입니다. 다시 시도해 주세요." |
  | `fresh cookies` | COOKIE_STALE | "더우인 로그인 정보가 만료됐습니다. 브라우저에서 다시 로그인해 주세요." |
- **전 케이스에 `fallback: {label:'파일 직접 넣기', action:'openFilePicker'}`** 부착

## 2-B. 영상 선택 (PICK) — T1.11~T1.14

**우리 방식**: 자동 크롤링 시도 안 함(저쪽도 못 함). 대신 **마찰 제거**에 집중.
```ts
// src/sourcing/searchUrls.ts — T0.4 프로브로 실측 검증 후 확정
const SEARCH_PATTERNS = {
  tiktok:      (q) => `https://www.tiktok.com/search/video?q=${encodeURIComponent(q)}`,
  instagram:   (q) => `https://www.instagram.com/explore/tags/${q.replace(/\s+/g,'')}/`,
  xiaohongshu: (q) => `https://www.xiaohongshu.com/search_result?keyword=${encodeURIComponent(q)}&type=video`,
  douyin:      (q) => `https://www.douyin.com/search/${encodeURIComponent(q)}?type=video`,
  baiduImage:  (q) => `https://image.baidu.com/search/index?tn=baiduimage&word=${encodeURIComponent(q)}`,
  youtube:     (q) => `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}&sp=EgIYAw%3D%3D`, // sp=쇼츠 필터
}
```
- **차별 기능(저쪽에 없음)**: 클립보드 감시 — 브라우저에서 영상 URL을 복사하면 앱이 감지해 **"소스에 추가할까요?" 토스트**. 노가다의 절반이 URL 복붙이라 체감이 크다.
  - 구현: `navigator.clipboard.readText()` 폴링(2초) + URL 패턴 매칭 + 중복 무시

## 2-C. 스크립트 3모드 (SCRIPT) — T2.x + 신규

저쪽의 3모드를 그대로 대응:
| 모드 | 동작 | 우리 구현 |
|---|---|---|
| **장면 맞춤** | 영상 구간별 대본 | T2.1~T2.8 (장면감지→비전→타임코드 대본) |
| **자유** | 제품 정보로 자유 생성 | 기존 쿠팡 바이럴 프롬프트 재사용 |
| **수동** | 직접 작성 | 텍스트 입력 + 문장 분할만 |

```ts
type ScriptMode = 'scene-matched' | 'free' | 'manual'
// manifest.script = {mode, styleId?, lines: TimedLine[]}
```
- **3모드 공통 후처리**: `fitScriptToDurations()` — 구간 초과 경고, 자동 축약 제안

## 2-D. 스타일 설정 (STYLE) — T4.6~T4.12 + 신규

저쪽에 있고 우리에 **없던 2가지**를 추가:

**헤드카피(상단 고정 문구)**
```ts
// src/modes/storyAssets.ts
buildHeadlineFilter({text, y, fontSize, color, bgColor, fontPath}): string
// drawtext=...:y=h*0.08:box=1:boxcolor=black@0.5
```
**워터마크(채널 로고)**
```ts
buildWatermarkFilter({imagePath, position, opacity, scale}): string
// overlay=W-w-20:20 + format=rgba,colorchannelmixer=aa=0.7
```
- 스키마: `manifest.captions.headline`, `manifest.captions.watermark`
- **회귀 보호**: 미지정 시 필터 체인이 종전과 바이트 동일해야 함(기존 계약 테스트 확장)

## 2-E. 썸네일 (THUMBNAIL) — 신규 T7.x

**저쪽**: AI 생성(포인트 차감) / **우리**: 드롭샷 무제한 = 0원
```
파이프라인:
1. 완성본에서 후보 프레임 8장 추출 (균등)
2. 비전으로 "가장 클릭을 부르는 프레임" 선정 + 이유
3. 선택지 3안 생성:
   a) 원본 프레임 + 헤드카피 오버레이
   b) 드롭샷으로 재생성한 연출 이미지 + 카피
   c) 사용자 업로드
4. 1280x720(유튜브) / 1080x1920(쇼츠) 동시 출력
```
- 카피 생성 프롬프트: 6자 이내 × 2줄, 숫자·대비어 우선("3초컷", "이게 1만원?")

## 2-F. 네이버 쇼핑순위 — 신규 T8.x

**API: 네이버 데이터랩 쇼핑인사이트** (client_id/secret 필요, 무료)
```
POST https://openapi.naver.com/v1/datalab/shopping/categories
  {startDate, endDate, timeUnit:'date', category:[{name,param:[catId]}], device, gender, ages}
POST .../shopping/category/keywords     ← 카테고리 내 키워드 트렌드
POST .../shopping/category/keyword/age  ← 연령별
POST .../shopping/category/keyword/gender
```
- **주의**: 데이터랩은 **상대 지수(0~100)** 만 준다. 절대 판매량 아님 → UI에 "상대 인기도" 명시
- 급등 계산: `todayRatio - yesterdayRatio` 정렬 (저쪽 "전일 대비 급등"과 동일 로직)
- 캐시: 하루 1회 갱신, `tmp/cache/naver-rank/<date>.json`
- 스키마: `{category, keyword, ratio, delta, ages: {...}, gender: {...}}`

## 2-G. 쿠팡 쇼핑순위 + 링크 + 실적 — 신규 T9.x ★수익화 핵심

**인증 (HMAC-SHA256)**
```ts
// src/coupang/auth.ts
function signCoupang(method: 'GET'|'POST', path: string, query: string, accessKey: string, secretKey: string) {
  const datetime = new Date().toISOString().slice(2,19).replace(/[-:]/g,'') + 'Z' // yymmddTHHMMSSZ
  const message = datetime + method + path + query
  const signature = crypto.createHmac('sha256', secretKey).update(message).digest('hex')
  return `CEA algorithm=HmacSHA256, access-key=${accessKey}, signed-date=${datetime}, signature=${signature}`
}
```
- **테스트**: 고정 입력 → 고정 서명(스냅샷). 시각은 주입 가능하게 파라미터화

**엔드포인트 맵**
| 기능 | Method / Path | 비고 |
|---|---|---|
| 딥링크 생성 | `POST /v2/providers/affiliate_open_api/apis/openapi/v1/deeplink` | body `{coupangUrls:[...]}` |
| 상품 검색 | `GET .../products/search?keyword=&limit=` | ⚠ **1시간 10회 제한** |
| 골드박스 | `GET .../products/goldbox` | 일 1회 캐시 |
| 베스트 카테고리 | `GET .../products/bestcategories/{categoryId}` | |
| 클릭 리포트 | `GET .../reports/clicks?startDate=&endDate=` | |
| 주문 리포트 | `GET .../reports/orders?startDate=&endDate=` | |
| 수익 리포트 | `GET .../reports/commission?startDate=&endDate=` | |

- **★ Rate limit 대응(설계에 필수 반영)**: 검색 1시간 10회는 매우 빡빡하다.
  - 검색 결과 **24시간 캐시**(키: 키워드 정규화)
  - 호출 카운터를 디스크에 기록(`tmp/cache/coupang/quota.json`), 잔여 횟수를 **UI에 항상 표시**
  - 초과 시 즉시 차단되므로, 잔여 2회 이하면 경고 + 수동 링크 붙여넣기 폴백
- **키 저장**: `TYPECAST_API_KEY` 패턴과 동일 — **디스크 평문 저장 금지**, env 전달만. UI는 localStorage(브라우저 로컬)만.

**내 쇼핑 링크(링크 페이지)** — 저쪽의 "상품 URL만 넣으면 썸네일·상품명 자동"을 그대로:
```
상품 URL 입력 → deeplink API로 제휴 링크 생성
             → 상품 페이지 OG 메타 파싱(og:image, og:title)으로 썸네일·이름 자동 채움
             → 블록 추가
```

## 2-H. 자막 제거 — T4.1~T4.5 (★최대 차별점)

**저쪽**: 외부 유료 API (사용자가 가입·과금) / **우리**: 로컬 GPU 무료·무제한

**4단계 폴백 체인** (저쪽 "4가지 방식"과 동급 이상)
| 순위 | 방식 | 조건 | 품질 | 속도 |
|---|---|---|---|---|
| 1 | **STTN** | GPU 있음 | 최상(실제 배경 복원) | 빠름 |
| 2 | **LaMa** | GPU 있음, STTN 실패 | 상 | 보통 |
| 3 | **delogo** | ffmpeg만 | 중 | 매우 빠름 |
| 4 | **blur** | 항상 | 하 | 즉시 |

**환경 격리**: `.venv-inpaint`(기존 `.venv-tts`와 분리) — 의존성 충돌 방지
```
scripts/inpaint_daemon.py   # qwen3_tts_daemon.py와 동일 패턴: 상주 + /health + /remove + 유휴 종료
```
- **VRAM 8GB 대응**: 입력 720p 이하로 다운스케일 → 처리 → 원본 해상도 업스케일 합성
- 마스크: 기존 `detectSubtitleBand()` 결과 + 여백 4px
- **취소 가능**: 트리 종료(구현된 `killChildTree`)
- 테스트: 마스크 생성·폴백 선택 로직(순수 함수)만 단위 테스트, 모델은 프로브(T0.3)로 검증

## 2-I. 영상 스타일 분석실 — T3.x

저쪽과 동일 + **레퍼런스 모음집 공유**는 우리는 **로컬 JSON 내보내기/가져오기**로 대응(서버 운영 불필요).

## 2-J. 인스타 모니터링 / 추천픽 피드 — 보류 판단

저쪽의 진짜 해자지만 **서버 상시 운영 + 큐레이션 인력**이 필요하다.
- 1인 운영이면 **직접 만들지 말 것**. 대신:
  - "레퍼런스 모음집"에 사용자가 직접 담기(이미 계획됨)
  - 네이버·쿠팡 순위(API 기반, 자동)로 소재 발굴 수요를 대체
- 판매 제품으로 갈 경우에만 재검토

---

# PART 3. 우리가 이기는 지점 (수치로)

| 항목 | 쇼핑팩토리 | 우리 |
|---|---|---|
| 제작 한도 | **하루 10개** | **무제한** (로컬) |
| 과금 | 포인트 차감 + 88만원/년 | **0원** |
| 자막 제거 | 외부 사이트 가입 + API 유료 | **로컬 GPU 무료·무제한** |
| 목소리 | 공용 TTS (채널끼리 겹침) | 공용 + **내 목소리 클로닝** |
| 소스 없는 제품 | **제작 불가** | **AI 생성으로 제작 가능** |
| 중복 위험 | 같은 소스 돌려씀 | AI 생성 비중만큼 0 |
| 영상 품질 | 짜깁기 | 짜깁기 + **감독 문법·인물/세트 고정** |
| 롱폼 | 미지원(추정) | **16:9 지원** |
| 데이터 소유 | 저쪽 서버 | **내 PC** |

**한 줄 포지션**: *"쇼핑팩토리는 남의 영상을 잘 섞어준다. 우리는 남의 영상이 없어도 만든다 — 무제한으로, 공짜로, 내 목소리로."*

---

# PART 4. 태스크 추가 (실행 명세서에 편입)

## 신규 Phase 7 — 썸네일 (T7.1~T7.5)
- T7.1 후보 프레임 추출(균등 8장) + 순수함수 테스트
- T7.2 비전 선정 프롬프트 + 파서 (`{bestIndex, reason, copy: string[2]}`)
- T7.3 카피 오버레이 렌더(ffmpeg drawtext, 1280x720 / 1080x1920)
- T7.4 드롭샷 재생성 옵션
- T7.5 UI 3안 비교 + 선택

## 신규 Phase 8 — 트렌드 리서치 (T8.1~T8.6)
- T8.1 네이버 데이터랩 클라이언트 + 서명/에러 (키는 env)
- T8.2 카테고리 트렌드 조회 + 급등 계산(순수함수, 테스트)
- T8.3 연령·성별 분해 조회
- T8.4 일 1회 캐시 + 수동 갱신
- T8.5 UI: 순위 테이블(급등 배지, 클릭 시 제품 찾기로 이동)
- T8.6 "이 키워드로 소재 검색" 연결

## 신규 Phase 9 — 쿠팡 수익화 (T9.1~T9.9)
- T9.1 HMAC 서명 유틸 + 스냅샷 테스트 ★기초
- T9.2 API 클라이언트(재시도·타임아웃·에러 매핑)
- T9.3 **쿼터 관리자**(1시간 10회 카운터, 잔여 표시, 초과 차단) ★필수
- T9.4 딥링크 생성 + 캐시
- T9.5 골드박스·베스트 조회 + 일 1회 캐시
- T9.6 리포트 3종(클릭·주문·수익) 조회 + 일자별 집계(순수함수 테스트)
- T9.7 UI: 실적 대시보드(일자별 차트, 영상↔링크 매핑)
- T9.8 상품 URL → OG 메타 파싱 → 링크 블록 자동 채움
- T9.9 링크 페이지 빌더 연동(Phase 6과 병합)

## 기존 태스크 수정
- **T1.2** → `PLATFORM_RELIABILITY` 상수 + `detectPlatform()` 추가, UI 배지 필수
- **T1.4** → yt-dlp `--newline` 진행률 파싱 추가
- **T4.4** → `.venv-inpaint` 격리 + 상주 데몬 패턴(TTS 데몬과 동일 구조)로 명시
- **신규 T2.12** → 스크립트 3모드(scene-matched/free/manual) 스위치
- **신규 T4.18** → 헤드카피 필터
- **신규 T4.19** → 워터마크 필터
- **신규 T1.16** → 클립보드 URL 감시(우리만의 편의 기능)

## 착수 순서 (최종)
```
T0.5 매니페스트 → T0.6 어댑터 골격 → T0.7 순환import 린트
→ T0.1~T0.4 프로브
→ Phase 1(입구) → Phase 2(대본) → Phase 5(하이브리드 ★차별점)
→ Phase 9(쿠팡 수익화) → Phase 3(스타일) → Phase 4(마감)
→ Phase 7(썸네일) → Phase 8(트렌드) → Phase 6(SEO·링크페이지)
```
> Phase 9를 앞으로 당긴 이유: **수익 링크·실적이 없으면 도구가 아니라 장난감**이다. 저쪽도 이걸 핵심으로 판다.

---

## 출처
- 강의 커리큘럼·기능 목록: https://thisismoney.kr/courses/cmqonp5uf0000p6h2ro4jue14
- 쿠팡 파트너스 딥링크 API: https://yourtime.kr/entry/쿠팡파트너스-deeplink딥링크-API-활용하는-법
- 쿠팡 파트너스 SDK(HMAC 구현 참고): https://github.com/mooooburg-dev/coupang-partners-sdk-standalone
- 쿠팡 Open API Rate Limit: https://developers.coupangcorp.com/hc/en-us/articles/20414599556889-Introduction-of-Open-API-rate-limit-policy
- 자막 제거(STTN/LaMa/ProPainter): https://github.com/SysAdminDoc/VideoSubtitleRemover
- 캡컷 6+ 암호화: https://github.com/GuanYixuan/pyJianYingDraft
