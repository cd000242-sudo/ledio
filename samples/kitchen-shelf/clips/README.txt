이 폴더의 .mp4 파일은 합성(synthetic) 데모 클립입니다.
색상 배경 + 역할 라벨(HOOK/PROBLEM/...)만 들어있는 테스트용 영상으로,
`render` 파이프라인을 바로 시험해볼 수 있게 만들어 둔 것입니다.

실제 쇼츠를 만들 때는 아래 파일들을 진짜 영상 클립으로 교체하세요:
  hook.mp4     - 첫 1~3초용 강한 장면
  problem.mp4  - 문제 상황
  product.mp4  - 제품 클로즈업
  use.mp4      - 사용 장면
  result.mp4   - 결과/전후 변화

project.yaml의 clips[].end 값이 실제 클립 길이를 넘으면 render가 에러로 막아줍니다.
