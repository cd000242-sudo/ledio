# Ultra Plan v4: Affiliate Content Factory

## Product Direction

이 프로젝트의 1차 목적은 앱 판매가 아니다. 먼저 자체 제휴 콘텐츠 운영으로 실제 제작 속도와 수익 가능성을 증명하고, 그 결과를 근거로 앱/시스템을 상품화한다.

`shorts-factory`는 단순 편집기가 아니라 상품 링크 하나로 판매형 콘텐츠를 만들고, 플랫폼별 업로드 패키지를 생성하고, 초보자도 막히지 않게 안내하는 AI 콘텐츠 제작 엔진으로 확장한다. 성과 입력/분석은 앱으로 충분히 콘텐츠를 만들고 실제 운영 결과가 쌓인 뒤 후순위 모듈로 붙인다.

## Global Completion Gate

각 코드 페이즈는 `npm run verify` 또는 그에 준하는 `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`를 통과해야 완료된다. CLI 페이즈는 샘플 `validate`, `package`, 가능하면 `render`까지 확인한다. 앱 페이즈는 데스크톱과 모바일 브라우저 검증을 포함한다. 렌더 페이즈는 synthetic mp4와 ffprobe 기반 smoke test를 목표로 한다. 초보자 UX 페이즈는 사용자가 다음 행동을 알 수 있는 문구와 오류 복구 안내가 있어야 완료된다.

## Layer 1: Baseline And Stability

### Phase 001: Current Baseline Lock
현재 CLI, 패키징, 정적 앱, 샘플, 테스트 통과 상태를 기준선으로 기록한다.

### Phase 002: Unified Verify Command
테스트, 타입체크, 린트, 빌드를 한 번에 돌리는 명령을 추가한다.

### Phase 003: Baseline README Section
초보자와 개발자가 현재 안정 상태를 재현할 수 있는 명령을 README에 정리한다.

### Phase 004: Package Command Recheck
샘플 `package` 결과가 manifest, risk report, platform metadata, ZIP을 생성하는지 재확인한다.

### Phase 005: App Console Recheck
정적 앱이 샘플 데이터를 열고 데스크톱/모바일에서 깨지지 않는지 재확인한다.

### Phase 006: Dist Output Hygiene
빌드 산출물과 샘플 산출물의 역할을 문서화하고 불필요한 추적/수정 혼선을 줄인다.

### Phase 007: Test Naming Cleanup
기존 테스트 이름과 파일 구조가 기능별로 찾기 쉬운지 정리한다.

### Phase 008: Error Type Boundary
사용자에게 보여줄 검증 오류와 내부 오류의 경계를 정리한다.

### Phase 009: Baseline Snapshot Document
현재 구현된 기능과 아직 구현하지 않을 기능을 명확히 구분한다.

### Phase 010: Phase Gate Checklist
앞으로 모든 페이즈가 통과해야 하는 검증 체크를 문서화한다.

## Layer 2: Beginner Onboarding

### Phase 011: Beginner First Run
Node, FFmpeg, 샘플 실행, 앱 열기 순서를 초보자용으로 다시 쓴다.

### Phase 012: Concept Glossary
상품, 클립, 소스, 렌더, 패키지, 제휴 고지, 플랫폼 메타데이터 용어를 통일한다.

### Phase 013: Folder Map
프로젝트 폴더, clips, output, publish_package가 무엇인지 그림 없이도 이해되게 설명한다.

### Phase 014: Sample Walkthrough
샘플 프로젝트 하나로 validate, render, package, 앱 확인 흐름을 따라 하게 만든다.

### Phase 015: FFmpeg Install Help
FFmpeg가 없을 때 Windows 기준 설치와 환경변수 설정을 더 쉽게 안내한다.

### Phase 016: Common Failure Guide
파일 없음, YAML 오류, FFmpeg 없음, 렌더 실패의 원인과 해결법을 정리한다.

### Phase 017: Beginner Safe Defaults
초보자가 값을 몰라도 시작할 수 있게 기본값을 문서와 앱에서 맞춘다.

### Phase 018: What Not To Do
무단 다운로드/짜깁기와 참고 분석의 차이를 초보자 눈높이로 설명한다.

### Phase 019: First Success Definition
처음 사용자가 어떤 산출물을 만들면 성공인지 명확히 한다.

### Phase 020: Onboarding QA
초보자 흐름을 실제로 따라 하며 빠진 설명을 보완한다.

## Layer 3: Project Creation In The App

### Phase 021: New Project Entry
앱에 새 프로젝트 만들기 시작점을 만든다.

### Phase 022: Product Name Input
상품명 입력 UI를 추가하고 상태 모델에 연결한다.

### Phase 023: Affiliate URL Input
제휴링크 입력과 URL 검증 피드백을 추가한다.

### Phase 024: Category And Price Input
카테고리와 가격대 입력을 스키마 형식에 맞게 처리한다.

### Phase 025: Pain Point Input
불편 포인트 입력을 후킹 생성에 쓸 수 있게 저장한다.

### Phase 026: Benefit Input
핵심 장점 입력을 캡션과 후킹 구성에 쓸 수 있게 저장한다.

### Phase 027: Disclosure Input
제휴/광고 고지 문구를 필수 입력으로 만든다.

### Phase 028: Style Defaults
duration, ratio, resolution, tone, captionPosition, bgmVolume 기본값을 앱 상태로 만든다.

### Phase 029: Style Editing
스타일 값을 초보자가 안전하게 수정할 수 있는 컨트롤을 추가한다.

### Phase 030: Clip Role Education
hook, problem, product, use, result, cta 역할을 앱에서 짧게 안내한다.

### Phase 031: Clip Row Add
클립 행 추가 UI를 만든다.

### Phase 032: Clip Role Select
클립 역할을 선택하는 UI를 만든다.

### Phase 033: Clip Timing Input
start/end 구간 입력과 end > start 검증을 추가한다.

### Phase 034: Required Role Hint
hook/use/result 누락을 초보자에게 경고로 보여준다.

### Phase 035: Project Draft State
상품, 스타일, 클립 입력을 하나의 프로젝트 draft 상태로 합친다.

## Layer 4: Validation And Error UX

### Phase 036: Client Side Schema Validation
앱 입력값을 CLI 스키마와 같은 규칙으로 검증한다.

### Phase 037: Friendly Validation Messages
Zod 오류를 초보자가 이해할 수 있는 문장으로 변환한다.

### Phase 038: Missing File Guidance
클립 파일 경로가 없을 때 어디를 확인해야 하는지 알려준다.

### Phase 039: Invalid URL Guidance
제휴링크 URL 오류를 명확히 표시한다.

### Phase 040: Invalid Price Range Guidance
가격대 형식 오류를 예시와 함께 표시한다.

### Phase 041: Timing Error Guidance
클립 시작/종료 시간이 잘못됐을 때 수정 방법을 안내한다.

### Phase 042: Source Risk Guidance
safe, caution, risk의 뜻과 다음 행동을 앱에서 보여준다.

### Phase 043: Render Preflight Guidance
렌더 전에 FFmpeg, 클립 파일, 구간 값을 점검하는 안내를 만든다.

### Phase 044: Package Preflight Guidance
패키징 전에 render_report와 영상 파일 존재 여부를 안내한다.

### Phase 045: Validation QA
오류 케이스별 테스트와 앱 화면 검증을 수행한다.

## Layer 5: Local App Runtime

### Phase 046: Runtime Decision Record
정적 앱, Node 로컬 서버, Electron/Tauri 후보를 비교하고 1차 방식을 확정한다.

### Phase 047: Local Server Skeleton
Node 로컬 서버 기반 앱 실행 구조를 만든다.

### Phase 048: Static Asset Serving
현재 app 파일을 로컬 서버에서 안정적으로 서빙한다.

### Phase 049: Project File Read API
로컬 프로젝트 파일을 읽는 API를 만든다.

### Phase 050: Project File Write API
앱에서 만든 project.yaml을 저장하는 API를 만든다.

### Phase 051: Validate API
앱 버튼에서 validateProject를 호출할 수 있게 한다.

### Phase 052: Package API
앱 버튼에서 packageProject를 호출할 수 있게 한다.

### Phase 053: Render API Shell
렌더 실행을 위한 API 껍데기와 안전장치를 만든다.

### Phase 054: Command Progress Channel
검증, 렌더, 패키징 진행 상태를 앱에 전달하는 구조를 만든다.

### Phase 055: Server Error Handling
서버 오류를 앱 친화적인 메시지로 변환한다.

### Phase 056: Runtime Start Script
초보자가 명령 하나로 앱을 실행할 수 있는 npm script를 추가한다.

### Phase 057: Runtime Shutdown Handling
서버 종료와 포트 충돌 처리를 안정화한다.

### Phase 058: Runtime README
앱 실행 방법과 포트 문제 해결을 문서화한다.

### Phase 059: Runtime Tests
API와 서버 기초 테스트를 추가한다.

### Phase 060: Runtime Browser QA
localhost 앱을 데스크톱/모바일에서 검증한다.

## Layer 6: Shorts Production Quality

### Phase 061: Hook Template Review
후킹 템플릿을 상품 판매형 구조에 맞게 정리한다.

### Phase 062: Hook Editing UI
변형별 후킹 문구를 앱에서 수정한다.

### Phase 063: Hook Duplicate Warning
중복 후킹 문구를 경고한다.

### Phase 064: Hook Length Warning
플랫폼/자막 기준으로 너무 긴 후킹 문구를 경고한다.

### Phase 065: Body Caption Model
본문 자막 데이터 구조를 설계한다.

### Phase 066: CTA Caption Model
CTA 자막 데이터 구조를 설계한다.

### Phase 067: Disclosure Caption Model
제휴 고지 자막 데이터 구조를 설계한다.

### Phase 068: Caption Timeline Model
후킹, 본문, CTA, 고지가 어느 구간에 나올지 timeline으로 표현한다.

### Phase 069: Caption Burn-In Engine
FFmpeg drawtext 기반 자막 렌더를 다중 구간으로 확장한다.

### Phase 070: Caption Position Support
captionPosition 값을 실제 렌더에 반영한다.

### Phase 071: Caption Style Defaults
폰트 크기, 박스, 여백, 줄간격 기본값을 안정화한다.

### Phase 072: Korean Wrap Stability
긴 한글 문장이 화면 밖으로 나가지 않게 줄바꿈을 강화한다.

### Phase 073: BGM Input Model
BGM 파일과 볼륨 설정 모델을 만든다.

### Phase 074: BGM Mix Engine
배경음악 믹싱을 FFmpeg 파이프라인에 추가한다.

### Phase 075: Audio Safety Defaults
BGM이 음성을 덮지 않도록 기본 볼륨과 무음 처리 규칙을 정한다.

### Phase 076: Platform Duration Warnings
플랫폼별 권장 길이를 넘을 때 경고한다.

### Phase 077: Shorts Preview Upgrade
앱 프리뷰가 자막 위치와 안전영역을 더 정확히 보여주게 한다.

### Phase 078: Production Quality QA
실제 mp4 샘플로 렌더 품질을 확인한다.

## Layer 7: Packaging And Upload Preparation

### Phase 079: Manifest Schema Hardening
manifest 구조를 앱/CLI 공용 계약으로 고정한다.

### Phase 080: Platform Metadata Review
유튜브/인스타/틱톡별 제목, 캡션, 고정댓글 필드를 재검토한다.

### Phase 081: Hashtag Generator Review
해시태그 기본 생성 로직을 판매형 콘텐츠에 맞게 조정한다.

### Phase 082: Caption Export Stability
플랫폼별 caption 파일이 깨지지 않게 테스트를 강화한다.

### Phase 083: Fixed Comment Export Stability
고정댓글 파일 생성과 문구 기본값을 안정화한다.

### Phase 084: ZIP Structure Review
ZIP 안의 폴더 구조를 업로드 직전 작업에 맞게 정리한다.

### Phase 085: Package Result UI
패키지 결과를 앱에서 플랫폼별로 검토한다.

### Phase 086: Edited Manifest Export
앱에서 수정한 메타데이터를 다시 manifest로 내보낸다.

### Phase 087: Package Rebuild From Edited Manifest
수정한 manifest로 패키지를 재생성하는 흐름을 만든다.

### Phase 088: Packaging QA
샘플 패키지 산출물 전체를 테스트와 브라우저로 확인한다.

## Layer 8: Source Hunter Differentiation

### Phase 089: Source Data Contract
소스의 title, url, file, rights, usage, notes 계약을 확정한다.

### Phase 090: Manual Source Board
앱에서 소스를 카드/테이블로 관리한다.

### Phase 091: Source Type Presets
직접 촬영, 공식 자료, 참고 쇼츠, 상세페이지, AI 생성 자료 프리셋을 만든다.

### Phase 092: Edit Vs Reference Separation
편집 소재와 참고 자료를 화면에서 확실히 분리한다.

### Phase 093: Risk Escalation Rules
reference_only를 edit로 쓰는 등 위험 조합을 강하게 경고한다.

### Phase 094: Source Notes Workflow
소스별로 참고할 포인트와 사용 제한을 메모한다.

### Phase 095: Product Research Notes
상품 키워드, pain point, 경쟁 콘텐츠 메모를 프로젝트에 묶는다.

### Phase 096: Reference Pattern Notes
참고 영상에서 후킹 구조와 장면 순서를 기록한다.

### Phase 097: Candidate URL Inbox
상품 관련 URL 후보를 임시 보관하는 inbox를 만든다.

### Phase 098: Candidate Classification
후보 URL을 공식 자료, 참고용, 위험, 보류로 분류한다.

### Phase 099: Source Risk Report UI
source_risk_report를 앱에서 읽고 이해하기 쉽게 보여준다.

### Phase 100: Source Package Traceability
패키지 산출물에 어떤 소스 상태로 만들었는지 추적 정보를 남긴다.

### Phase 101: Source Hunter QA
안전/주의/위험 케이스를 테스트한다.

### Phase 102: Source Hunter Workflow Review
수익형 콘텐츠 운영 도구로서 차별화가 드러나는지 점검한다.

## Layer 9: Extended Creation Modes

### Phase 103: Story Project Contract
썰채널 프로젝트 데이터 계약을 설계한다.

### Phase 104: Story Script Input
썰/대본 입력 UI를 만든다.

### Phase 105: Story Scene Splitter
대본을 장면 단위로 나누는 로직을 만든다.

### Phase 106: Image Prompt Model
장면별 이미지 프롬프트 구조를 만든다.

### Phase 107: Narration Model
장면별 나레이션/TTS 텍스트 구조를 만든다.

### Phase 108: Story Caption Model
썰채널 자막 구조를 기존 subtitle 시스템과 연결한다.

### Phase 109: Story Package Bridge
스토리 프로젝트가 기존 package 흐름을 사용할 수 있게 한다.

### Phase 110: Story MVP QA
대본 하나가 장면 계획 JSON과 패키지 메타데이터로 이어지는지 검증한다.

### Phase 111: Longform Project Contract
긴 영상 프로젝트 데이터 계약을 설계한다.

### Phase 112: Longform Probe
ffprobe로 긴 영상의 기본 메타데이터를 읽는다.

### Phase 113: Silence Analysis
무음 구간 기반 하이라이트 후보를 추출한다.

### Phase 114: Scene Boundary Candidate
장면 전환 후보를 표현하는 구조를 만든다.

### Phase 115: Longform Highlight Candidate JSON
긴 영상에서 쇼츠 후보 구간 JSON을 생성한다.

### Phase 116: Longform To Shorts Project
하이라이트 후보를 기존 쇼츠 프로젝트로 변환한다.

### Phase 117: Longform QA
긴 영상 fixture로 후보 구간 생성과 변환을 검증한다.

### Phase 118: Extended Mode Boundary
쇼츠 코어가 흔들리지 않도록 확장 모드의 경계를 문서화한다.

## Layer 10: Operations, Performance, And Productization

### Phase 119: Performance Lab Hold Line
성과 입력은 실제 운영 결과가 생기기 전까지 CSV 템플릿만 유지한다.

### Phase 120: Internal Operation Checklist
상품 하나를 선정해 콘텐츠를 만들 때 따라갈 체크리스트를 만든다.

### Phase 121: Multi Product Workflow
여러 상품 프로젝트를 관리하는 폴더/명명 규칙을 정리한다.

### Phase 122: Speed Measurement
상품 하나를 프로젝트화하고 패키징하는 데 걸리는 시간을 기록한다.

### Phase 123: Quality Review Rubric
업로드 전 영상 품질, 캡션, 고지, 소스 위험도를 점검하는 기준을 만든다.

### Phase 124: Beginner Usability Review
초보자가 어디에서 막히는지 실제 흐름 기준으로 점검한다.

### Phase 125: Performance Lab Entry Criteria
성과 입력 기능을 시작해도 되는 조건을 정한다.

### Phase 126: Performance Data Contract
조회수, 클릭, 주문, 매출, 비용, 수익 데이터 구조를 설계한다.

### Phase 127: Performance Input UI
운영 결과가 쌓이면 성과 입력 화면을 만든다.

### Phase 128: Performance Analysis UI
후킹, 상품, 플랫폼별 승률과 수익성을 비교한다.

### Phase 129: Sales Proof Package
제작 시간 절감, 생성 영상 수, 업로드 수, 반응, 수익 데이터를 판매 전 증명 자료로 정리한다.

### Phase 130: Release Hardening
설치, 문서, 샘플, QA, 오류 복구, 전체 검증을 묶어 릴리즈 가능한 상태로 다듬는다.

## Immediate Next Work

다음 실행은 Phase 001부터 시작한다. 현재 기준선을 고정하고 `npm run verify`를 추가한 뒤, README와 검증 명령을 맞춘다. 이후 Phase 011까지는 초보자 온보딩과 안정성 위주로 진행한다.
