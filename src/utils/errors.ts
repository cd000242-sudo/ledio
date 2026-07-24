/** 프로젝트 파일/검증 단계에서 사용자에게 그대로 보여줄 수 있는 오류. */
export class ProjectValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectValidationError'
  }
}
