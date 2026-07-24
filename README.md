# shorts-factory

## 스토리 쇼츠 원클릭 파이프라인 (대본 → 내 목소리 → 완성 영상)

대본 한 편과 내 목소리 샘플(최초 1회)만 있으면, 이미지 생성 → 보이스 클로닝
나레이션 → 장면 클립 → 자막·BGM 렌더까지 한 번에 완성한다.

```bash
# 1) 내 목소리 등록: 5~10초 녹음을 voices/내목소리.wav 로 저장
#    (같은 이름 .txt 에 말한 문장을 적으면 클로닝 품질이 올라간다)

# 2) 파이프라인 실행 (mock 이미지 = 무료 오프라인 테스트)
npm run dev -- story-pipeline ./samples/story-demo/story-input.yaml --voice 내목소리 --image-provider mock

# 실제 이미지 생성 시
set OPENAI_API_KEY=your_key
npm run dev -- story-pipeline ./samples/story-demo/story-input.yaml --voice 내목소리 --image-provider gpt
```

- 산출물: `<입력폴더>/<projectName>-pipeline/video/output/video_01.mp4`
- 단계 산출물이 남아 있으면 **중단 지점부터 재개**된다 (`--force`로 전체 재실행)
- TTS는 로컬 Qwen3-TTS(무료, `.venv-tts` 필요). `--tts-provider mock`으로 GPU 없이 테스트 가능
- 대본 구조 템플릿 5종: `npm run dev -- story-templates`

### UI에서 하기 (초보자용)

```bash
npm run app   # 브라우저   |   npm run desktop  # 데스크톱 앱
```

**원클릭 제작** 탭에서: ① 목소리 등록(브라우저 녹음/파일 업로드 + 테스트 듣기)
→ ② 템플릿 선택·대본 작성 → ③ 쇼츠 만들기 → 결과 미리보기.

### 관련 CLI

```bash
npm run dev -- narrate <스토리보드.yaml|텍스트.txt> --voice 내목소리   # 나레이션만
npm run dev -- autocut <영상.mp4>                                     # 무음 자동컷
```

## Release Bundle

`npm run verify` now builds and checks the local release bundle:

```text
release/shorts-factory-local-app/
release/shorts-factory-local-app.zip
```

Run `npm run release:bundle` after `npm run build` when only the release artifact needs to be refreshed.

## Electron Desktop Test

```bash
npm run electron
```

The desktop window opens the same studio UI with local save, validate, render, and package actions. See [docs/electron.md](docs/electron.md) for the Korean test flow.

## Longform Analysis

```bash
npm run dev -- analyze-longform ./path/to/longform.mp4 --product-name "Product Name" --affiliate-url "https://example.com/product"
npm run dev -- analyze-longform ./path/to/longform.mp4 --vision-scoring --transcript ./path/to/longform.srt --product-name "Product Name" --affiliate-url "https://example.com/product"
```

This creates `longform-analysis/longform_analysis.json` and `longform-analysis/first_shorts_project.yaml` from real media duration, silence boundaries, optional SRT keyword scoring, and optional FFmpeg scene-change scoring.

## Story Image To Video

```bash
set OPENAI_API_KEY=your_key_here
npm run dev -- generate-story-images ./path/to/story-image-input.json --out-dir ./projects/story-generated
npm run dev -- storyboard-render ./projects/story-generated/storyboard.json --out-dir ./projects/story-video
```

Use `--provider mock` on `generate-story-images` for offline testing. This turns generated or owned images into captioned MP4 scene clips and a ready `project.yaml`.

## Source Discovery

```bash
set YOUTUBE_API_KEY=your_key_here
npm run dev -- discover-sources --product-name "Product Name" --out-dir ./projects/source-discovery
```

Use `--provider mock` for offline testing. Discovered videos are saved as reference-only source-board entries by default.

## Direct Upload Automation

Create the upload package first, then run upload automation in the safest mode:

```bash
npm run sample:package
npm run dev -- upload-package ./samples/kitchen-shelf/output/publish_package --mode dry_run
npm run dev -- upload-package ./samples/kitchen-shelf/output/publish_package --mode mock
```

`dry_run` writes the exact upload plan without calling platform APIs. `mock` proves the end-to-end package upload flow offline and is included in the render smoke gate.

Live upload mode uses platform credentials from environment variables:

```bash
set YOUTUBE_ACCESS_TOKEN=your_oauth_token
set INSTAGRAM_ACCESS_TOKEN=your_graph_api_token
set INSTAGRAM_USER_ID=your_ig_user_id
set TIKTOK_ACCESS_TOKEN=your_tiktok_token
npm run dev -- upload-package ./samples/kitchen-shelf/output/publish_package --mode live --public-base-url https://cdn.example.com/package-videos
```

Instagram Reels needs `--public-base-url` because the provider pulls the video from a public URL. Keep live uploads private/self-only first, review the platform result, and only then publish broadly.

## Current Runtime Docs

- Beginner guide: [docs/beginner-guide.md](docs/beginner-guide.md)
- Local app runtime and API: [docs/runtime.md](docs/runtime.md)
- Operations checklist: [docs/operations.md](docs/operations.md)
- Completion audit: [docs/completion-audit.md](docs/completion-audit.md)

로컬 우선 쇼핑 쇼츠 자동 생성 도구 (CLI). 사용자가 준비한 영상 클립과 상품 정보를
넣으면 9:16 쇼핑 쇼츠 여러 버전을 자동 생성하는 것이 목표입니다.

> **현재 상태: Phase 4 MVP** — `validate` + `render` + `package`까지 구현됨.
> `package`는 플랫폼별 업로드 메타데이터, 캡션/고정댓글, 제휴 고지, 소스 위험도 리포트,
> 선택적 성과 기록 CSV 템플릿, ZIP 패키지를 생성합니다.

## 기준선

현재 안정 기준선은 다음 흐름입니다.

1. `npm run verify`가 통과한다.
2. `npm run sample:validate`가 샘플 프로젝트를 검증한다.
3. `npm run sample:package`가 샘플 업로드 패키지와 ZIP을 만든다.
4. `npm run app`으로 앱 콘솔을 열 수 있다.

새 기능을 추가한 뒤에는 이 기준선을 다시 통과해야 합니다.

## 요구 사항

- Node.js >= 20
- pnpm
- FFmpeg / ffprobe (`render`부터 필요) — Windows: `winget install Gyan.FFmpeg`
  - 설치 후 PATH 반영을 위해 터미널/IDE를 재시작하세요.
  - PATH에 없으면 `FFMPEG_PATH` / `FFPROBE_PATH` 환경변수로 실행파일 경로를 지정할 수 있습니다.
  - 자막 폰트는 기본 맑은 고딕(`C:/Windows/Fonts/malgun.ttf`), `SF_FONT_PATH`로 변경 가능.

## 처음 5분

자세한 초보자 안내는 [Beginner Guide](docs/beginner-guide.md)를 먼저 보세요.

```bash
npm install
npm run verify
npm run sample:package
npm run app
```

브라우저에서 `http://127.0.0.1:4173/`을 열고 `Manifest`로
`samples/kitchen-shelf/output/publish_package/manifest.json`을 불러옵니다.
그 다음 `Risk`로 `samples/kitchen-shelf/output/publish_package/source_risk_report.json`을 불러오면
샘플 캠페인, 플랫폼별 캡션, 소스 위험도를 확인할 수 있습니다.

## 설치

```bash
npm install
```

## 명령어

```bash
# 프로젝트 검증 (project.yaml 형식 + 클립 파일 존재 + 권장 역할 확인)
npm run sample:validate

# 플랫폼별 업로드 패키지 생성 (publish_package/ + ZIP)
npm run sample:package

# 앱 콘솔 실행
npm run app

# 빌드 후 실행
npm run build
node dist/cli/index.js render ./samples/kitchen-shelf
node dist/cli/index.js package ./samples/kitchen-shelf
```

## 앱 콘솔

앱 콘솔은 `npm run app`을 실행한 뒤 브라우저에서 `http://127.0.0.1:4173/`을 열면 실행됩니다.
포트가 이미 사용 중이면 `PORT=4174 npm run app`처럼 다른 포트를 지정합니다.

- 기본 샘플 데이터로 캠페인, 변형 영상, 플랫폼별 캡션을 확인할 수 있습니다.
- `Manifest` 버튼으로 `output/publish_package/manifest.json`을 불러옵니다.
- `Risk` 버튼으로 `output/publish_package/source_risk_report.json`을 불러옵니다.
- 제목, 캡션, 고정댓글, 해시태그를 플랫폼별로 조정하고 `Export`로 수정본을 내보냅니다.

| 명령 | 상태 | 설명 |
|------|------|------|
| `validate` | ✅ 구현됨 | project.yaml 검증, 클립 존재 확인, 권장 역할 경고 |
| `render` | ✅ 구현됨 | 클립 trim → 1080×1920 정규화 → 결합 → 변형별 후킹 자막 → MP4 N개 |
| `package` | ✅ 구현됨 | 플랫폼별 캡션/고정댓글/메타데이터 + 선택적 성과 CSV 템플릿 + 소스 위험도 + ZIP |

### render 동작

1. 각 클립을 `start~end`로 잘라 1080×1920·30fps·AAC로 **정규화** (오디오 없으면 무음 트랙 추가)
2. 역할 순서대로 **결합**해 베이스 영상 생성
3. 후킹 템플릿으로 변형별 문장을 만들어 **첫 구간에 자막 burn-in** → `video_01..N.mp4`
4. `render_report.json`에 클립/변형/길이 메타데이터 기록

### package 동작

`render`가 끝난 프로젝트에서 업로드 직전 산출물을 만듭니다.

1. `render_report.json`과 `project.yaml`을 읽어 변형 영상과 플랫폼 조합을 계산
2. YouTube Shorts / Instagram Reels / TikTok별 제목, 캡션, 고정댓글, 해시태그 메타데이터 생성
3. `sources[]` 권리 상태를 `safe` / `caution` / `risk`로 분류해 `source_risk_report.json` 기록
4. 이후 성과 분석 모듈에서 참고할 수 있는 선택적 `performance_template.csv` 생성
5. `output/publish_package/` 폴더와 `<projectName>_publish_package.zip` 생성

## 프로젝트 폴더 구조

```
projects/<프로젝트명>/
  project.yaml      # 상품 정보 + 스타일 + 클립 역할 정의
  clips/            # 영상 클립 (hook/problem/product/use/result/cta)
  bgm/              # (선택) 배경음악
  output/           # 렌더 결과물
```

`samples/kitchen-shelf/`에 예시 프로젝트가 들어 있습니다.
(샘플의 `clips/*.mp4`는 자리표시용 빈 파일이며, 실제 렌더 전 진짜 클립으로 교체해야 합니다.)

`dist/`는 TypeScript 빌드 산출물이고 `output/`은 렌더/패키징 산출물입니다. 둘 다 소스 코드가 아니므로 문제가 생기면 다시 생성하는 대상으로 봅니다.

### project.yaml 핵심 필드

- `product` — 상품명, 카테고리, 가격대(`10000-30000`), 제휴링크, 불편 포인트, 핵심 장점
- `disclosure` — 제휴/광고 표기 문구 (필수)
- `style` — `duration`(초), `ratio`(`9:16`), `resolution`(`1080x1920`), `captionPosition`, `bgmVolume`(0~1)
- `clips[]` — 각 클립의 `file` / `role` / `start` / `end`
- `variants.count` — 생성할 버전 수
- `publish` — 캠페인명, 플랫폼(`youtube_shorts`, `instagram_reels`, `tiktok`), 해시태그, CTA, 고정댓글
- `sources[]` — 편집/참고 소재의 파일·URL, 권리 상태, 사용 목적

역할(`role`): `hook` · `problem` · `product` · `use` · `result` · `cta`
(`hook` / `use` / `result`가 없으면 검증 시 경고합니다.)

소스 권리(`rights`): `owned` · `licensed` · `official_brand` · `creative_commons` ·
`ai_generated` · `permission_pending` · `reference_only` · `unknown`

사용 목적(`usage`): `edit`(실제 편집 소재) · `reference`(구조/후킹 참고)

## 운영 검증 순서

이 도구의 1차 목적은 앱 판매가 아니라, 자체 제휴 콘텐츠 운영으로 수익 결과를 만든 뒤
그 결과를 근거로 시스템을 상품화하는 것입니다.

1. 상품/제휴링크를 정한다.
2. 권리 있는 클립과 참고 소스를 `project.yaml`에 정리한다.
3. `render`로 변형 쇼츠를 만든다.
4. `package`로 플랫폼별 업로드 자료를 만든다.
5. 먼저 앱 사용성과 생성 품질을 충분히 테스트한다.
6. 실제 운영 결과가 쌓이면 성과 입력/분석 기능을 별도 모듈로 붙인다.

## 개발

```bash
npm test             # vitest 실행
npm run test:watch   # 워치 모드
npm run typecheck    # tsc --noEmit
npm run lint         # eslint
npm run verify       # lint + typecheck + test + build + 샘플 validate/package 전체 검증
```

작업을 시작하거나 큰 변경을 마친 뒤에는 `npm run verify`로 기준선을 확인합니다.
