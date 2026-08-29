/* global AbortSignal, URL, fetch */
/**
 * 로컬 서버(/api/*) 호출 래퍼 — MCP 도구가 앱 기능을 부르는 유일한 통로.
 * 여기서는 HTTP만 담당한다. 도구 정의는 tools.mjs, 프로토콜 배선은 shorts-mcp.mjs.
 */

/** 워크스페이스 밖으로 나가는 경로를 도구 계층에서 한 번 더 막는다(서버도 막지만 이중 방어). */
export function safeProjectPath(value) {
  const raw = String(value ?? '').trim().replace(/\u005c/g, '/')
  if (!raw) throw new Error('projectPath가 필요합니다.')
  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('/')) {
    throw new Error('절대 경로는 쓸 수 없습니다. projects/<프로젝트명> 형태로 넘기세요.')
  }
  const parts = raw.split('/').filter((part) => part && part !== '.')
  if (parts.some((part) => part === '..')) {
    throw new Error('상위 폴더(..)로 나가는 경로는 쓸 수 없습니다.')
  }
  if (parts.length === 0) throw new Error('projectPath가 필요합니다.')
  return parts.join('/')
}

/** 서버 응답에서 사람이 읽을 실패 사유를 뽑는다. */
function failureMessage(status, payload) {
  const detail = payload && typeof payload === 'object' ? payload.error : null
  if (detail) return String(detail)
  if (status === 404) return '없는 API입니다(앱 버전이 낮을 수 있습니다).'
  return `요청 실패(HTTP ${status})`
}

export function createApiClient({ baseUrl, fetchImpl = fetch, timeoutMs = 900000 } = {}) {
  const base = String(baseUrl ?? '').replace(/\/+$/, '')
  if (!base) throw new Error('baseUrl이 필요합니다(SHORTS_API_BASE).')

  async function request(method, path, { params = null, body = null } = {}) {
    const url = new URL(base + path)
    for (const [key, value] of Object.entries(params ?? {})) {
      if (value !== undefined && value !== null) url.searchParams.set(key, String(value))
    }
    let response
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers: body === null ? undefined : { 'content-type': 'application/json' },
        body: body === null ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (error) {
      const reason = error?.name === 'TimeoutError' ? '응답 시간 초과' : String(error?.message ?? error)
      throw new Error(`앱 서버에 연결하지 못했습니다: ${reason}`)
    }
    const text = await response.text()
    let payload = null
    try {
      payload = text ? JSON.parse(text) : null
    } catch {
      throw new Error(`앱 서버 응답을 해석하지 못했습니다: ${text.slice(0, 200)}`)
    }
    if (!response.ok) throw new Error(failureMessage(response.status, payload))
    if (payload && payload.ok === false) throw new Error(failureMessage(response.status, payload))
    return payload ?? {}
  }

  return {
    get: (path, params) => request('GET', path, { params }),
    post: (path, body) => request('POST', path, { body: body ?? {} }),
  }
}
