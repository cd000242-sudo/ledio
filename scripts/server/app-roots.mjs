/**
 * 프로그램 파일과 사용자 데이터가 있을 곳을 정한다.
 *
 * 둘을 한 폴더에 두면 안 된다. 설치본은 업데이트할 때 설치 폴더를 갈아엎기 때문에
 * 그 안에 만든 **작업물과 자막 엔진(5GB)이 통째로 지워진다**(실측으로 확인한 사고).
 *
 *   programRoot  앱과 함께 배포되는 것 — app/, scripts/, dist/, build/
 *   dataRoot     사용자가 만든 것 — projects/, voices/, .venv-stt/
 *
 * 개발 실행에서는 저장소 한 곳이 둘 다를 겸한다(지금까지 쓰던 방식 그대로).
 */

const DATA_FOLDER = 'shorts-factory-data'

/**
 * @param {{isPackaged: boolean, appPath: string, localAppData?: string, userData?: string}} env
 * @returns {{programRoot: string, dataRoot: string}}
 */
export function resolveRoots(env) {
  const programRoot = env.appPath
  if (!env.isPackaged) return { programRoot, dataRoot: programRoot }

  // 작업물과 엔진은 용량이 커서 동기화되는 Roaming이 아니라 Local에 둔다.
  const local = env.localAppData
  if (local) return { programRoot, dataRoot: `${local.replace(/[\\/]+$/, '')}/${DATA_FOLDER}` }
  return { programRoot, dataRoot: env.userData ?? programRoot }
}
