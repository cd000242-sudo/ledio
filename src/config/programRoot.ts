import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * 앱과 함께 배포되는 파일(scripts/, app/, dist/)이 있는 곳.
 *
 * **실행 위치(cwd)로 찾으면 안 된다.** 설치본에서는 작업 폴더가 사용자 데이터 쪽
 * (`%LOCALAPPDATA%\shorts-factory-data`)이라, 거기서 파이썬 스크립트를 찾으면
 * "No such file or directory"로 죽는다(실측으로 확인한 사고).
 *
 * 그래서 이 모듈 자기 위치에서 거슬러 올라간다.
 * 빌드본은 `<루트>/dist/config/`, 개발 실행은 `<루트>/src/config/` — 둘 다 두 단계 위가 루트다.
 */
export const PROGRAM_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** 함께 배포되는 스크립트의 절대 경로. */
export function programScript(...parts: string[]): string {
  return join(PROGRAM_ROOT, 'scripts', ...parts)
}
