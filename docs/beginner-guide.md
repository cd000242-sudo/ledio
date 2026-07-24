# Beginner Guide

이 문서는 처음 사용하는 사람이 `shorts-factory`로 샘플을 확인하고, 어떤 파일이 어떤 역할을 하는지 이해하기 위한 안내입니다.

## First Run

1. Node.js 20 이상을 설치합니다.
2. 프로젝트 폴더에서 `npm install`을 실행합니다.
3. `npm run verify`로 현재 기준선이 통과하는지 확인합니다.
4. `npm run sample:package`로 샘플 업로드 패키지를 만듭니다.
5. `npm run app`을 실행하고 브라우저에서 `http://127.0.0.1:4173/`을 엽니다.
6. 앱에서 `Manifest`로 `samples/kitchen-shelf/output/publish_package/manifest.json`을 불러옵니다.
7. 앱에서 `Risk`로 `samples/kitchen-shelf/output/publish_package/source_risk_report.json`을 불러옵니다.

처음 성공 기준은 앱 화면에서 상품명, 플랫폼 탭 3개, 소스 위험도, 변형 영상 목록, 플랫폼별 캡션이 보이는 것입니다.

## Glossary

`프로젝트`는 상품 하나를 쇼츠 여러 개로 만들기 위한 작업 단위입니다.

`project.yaml`은 상품 정보, 클립, 소스, 플랫폼 설정을 담는 설계서입니다. 초보자는 나중에 앱에서 이 파일을 만들고 수정하게 됩니다.

`상품 정보`는 상품명, 카테고리, 가격대, 제휴링크, 불편 포인트, 핵심 장점입니다.

`클립`은 쇼츠에 들어갈 짧은 영상 조각입니다. 각 클립은 `hook`, `problem`, `product`, `use`, `result`, `cta` 중 하나의 역할을 가집니다.

`소스`는 실제 편집에 쓰는 영상/이미지 또는 참고용 링크입니다. 직접 촬영한 파일은 `edit`, 경쟁 영상 구조 참고는 `reference`로 구분합니다.

`렌더`는 클립을 잘라 세로 영상으로 결합하고 자막을 입혀 MP4를 만드는 과정입니다.

`패키지`는 렌더 결과를 유튜브 쇼츠, 인스타 릴스, 틱톡 업로드용 캡션/고정댓글/메타데이터/ZIP으로 묶는 과정입니다.

`제휴 고지`는 광고 또는 제휴 수익 가능성을 알리는 문구입니다. 비워두면 안 됩니다.

## Folder Map

`samples/kitchen-shelf/project.yaml`은 샘플 프로젝트 설정입니다.

`samples/kitchen-shelf/clips/`는 샘플 클립이 들어가는 폴더입니다.

`samples/kitchen-shelf/output/`은 렌더와 패키징 결과가 생성되는 폴더입니다.

`samples/kitchen-shelf/output/publish_package/manifest.json`은 플랫폼별 업로드 자료를 한곳에 모은 파일입니다.

`samples/kitchen-shelf/output/publish_package/source_risk_report.json`은 소스 권리 상태를 정리한 파일입니다.

`samples/kitchen-shelf/output/kitchen-shelf-001_publish_package.zip`은 업로드 직전 자료를 묶은 ZIP 파일입니다.

`dist/`는 빌드 결과입니다. 문제가 생기면 `npm run build`로 다시 만들 수 있습니다.

## Sample Walkthrough

처음에는 렌더보다 패키지를 먼저 확인합니다. 샘플 output에는 이미 렌더 결과가 있으므로 `npm run sample:package`만으로 업로드 패키지를 다시 만들 수 있습니다.

앱에서 manifest와 risk report를 불러오면 플랫폼별 캡션을 확인할 수 있습니다. 제목, 캡션, 고정댓글, 해시태그를 수정한 뒤 `Export`로 수정본을 내보낼 수 있습니다.

실제 상품 작업에서는 먼저 권리 있는 클립을 `clips/`에 넣고 `project.yaml`을 수정합니다. 그 뒤 `validate`, `render`, `package` 순서로 진행합니다.

## FFmpeg Help

`render`는 FFmpeg와 ffprobe가 필요합니다. Windows에서는 다음 명령으로 설치할 수 있습니다.

```bash
winget install Gyan.FFmpeg
```

설치 후 터미널을 다시 열어야 PATH가 반영됩니다. PATH에 없다면 `FFMPEG_PATH`와 `FFPROBE_PATH` 환경변수로 실행파일 경로를 지정할 수 있습니다.

`validate`와 `package`는 FFmpeg 없이도 실행할 수 있습니다. 영상 파일을 실제로 만들 때만 FFmpeg가 필요합니다.

## Common Failures

`project.yaml을 찾을 수 없습니다`가 나오면 프로젝트 폴더 경로를 확인합니다.

`클립 파일 없음`이 나오면 `clips/` 폴더에 파일이 있는지, YAML의 파일명이 정확한지 확인합니다.

`end는 start보다 커야 합니다`가 나오면 클립 종료 시간이 시작 시간보다 큰지 확인합니다.

`affiliateUrl은 올바른 URL이어야 합니다`가 나오면 `https://`로 시작하는 링크인지 확인합니다.

`ffmpeg/ffprobe를 찾을 수 없습니다`가 나오면 FFmpeg 설치와 PATH를 확인합니다.

`Port 4173 is already in use`가 나오면 `PORT=4174 npm run app`처럼 다른 포트를 사용합니다.

## Safe Defaults

처음에는 `ratio: 9:16`, `resolution: 1080x1920`, `captionPosition: bottom`, `bgmVolume: 0.18`, `variants.count: 5`를 그대로 사용합니다.

필수에 가까운 클립 역할은 `hook`, `use`, `result`입니다. 이 세 가지가 있으면 첫 쇼츠 흐름을 만들기 쉽습니다.

소스 권리 상태를 모르면 `unknown`으로 두고 실제 편집에는 쓰지 않습니다. 경쟁 영상은 `reference_only`와 `reference`로 두는 것이 안전합니다.

## What Not To Do

남의 영상을 무조건 다운로드해서 편집 소재로 쓰는 흐름을 기본값으로 만들지 않습니다.

참고용 영상과 실제 편집 소재를 섞지 않습니다.

제휴 고지 문구를 빼지 않습니다.

처음부터 모든 플랫폼과 모든 기능을 한 번에 완성하려고 하지 않습니다. 먼저 샘플 패키지를 재현하고, 그 다음 실제 상품 하나를 끝까지 만들어봅니다.

## Onboarding QA

처음 사용자 기준으로 다음 항목이 모두 되면 온보딩은 통과입니다.

1. `npm install`을 실행했다.
2. `npm run verify`가 통과했다.
3. `npm run sample:package`가 통과했다.
4. `npm run app`으로 앱 주소가 표시됐다.
5. 앱에서 manifest와 risk report를 불러왔다.
6. 플랫폼별 캡션을 확인했다.
7. 소스 위험도에서 `safe`, `caution`, `risk`의 의미를 이해했다.
8. 첫 성공 기준이 무엇인지 설명할 수 있다.
