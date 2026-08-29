/**
 * MCP 도구 카탈로그 — 앱 기능(/api/*)을 에이전트가 쓸 수 있는 도구로 승격한다.
 * 파이프라인 로직은 전부 기존 서버에 있고, 여기서는 인자 검증과 결과 요약만 한다.
 * risk 태그는 UI 승인 게이트(Phase 3)가 읽는다: read=자동, write/run=확인 후 실행.
 */
import { z } from 'zod'
import { safeProjectPath } from './api-client.mjs'

const projectPathArg = z
  .string()
  .describe('workspaceRoot 기준 상대 경로. 예: projects/my-item 또는 projects/my-item/project.yaml')

/** 도구 결과 텍스트 — 에이전트가 읽기 좋게 요약하고, 원본은 structured로 넘긴다. */
function summarize(lines) {
  return lines.filter((line) => line !== null && line !== undefined && line !== '').join('\n')
}

function scriptMethodArg(defaults) {
  return z
    .enum(['api-gpt', 'api-gemini', 'api-claude', 'agent-claude', 'agent-codex', 'agent-gemini'])
    .default(defaults.method ?? 'agent-claude')
    .describe('생성 엔진. 지정하지 않으면 사용자가 환경설정에서 고른 방식을 쓴다.')
}

/**
 * @param {{ api: { get: Function, post: Function }, defaults?: { method?: string, apiKey?: string } }} options
 * @returns {Array<{ name: string, title: string, description: string, risk: 'read'|'write'|'run', schema: object, run: Function }>}
 */
export function createTools({ api, defaults = {} }) {
  const withKey = (args) => (args.method ?? defaults.method ?? '').startsWith('api-')
    ? { apiKey: defaults.apiKey ?? '' }
    : {}

  return [
    {
      name: 'app_health',
      title: '앱 상태 확인',
      description: '앱 서버가 살아 있는지, 워크스페이스 경로가 어디인지 확인한다. 다른 도구가 실패할 때 가장 먼저 호출한다.',
      risk: 'read',
      schema: {},
      async run() {
        const data = await api.get('/api/health')
        return { text: summarize(['앱 서버 정상', `워크스페이스: ${data.workspaceRoot ?? '알 수 없음'}`]), data }
      },
    },
    {
      name: 'list_projects',
      title: '프로젝트 목록',
      description: '만들어진 프로젝트 폴더 목록을 최신순으로 돌려준다. 프로젝트 이름·제목·마지막 수정 시각 포함.',
      risk: 'read',
      schema: {},
      async run() {
        const data = await api.get('/api/projects')
        const projects = data.projects ?? []
        if (projects.length === 0) return { text: '프로젝트가 아직 없습니다.', data }
        return {
          text: summarize([
            `프로젝트 ${projects.length}개:`,
            ...projects.map((p) => `- ${p.name}${p.title ? ` (${p.title})` : ''} — ${p.projectPath}`),
          ]),
          data,
        }
      },
    },
    {
      name: 'read_project',
      title: '프로젝트 읽기',
      description: '프로젝트의 project.yaml 원문을 읽는다. 장면·자막·오디오 구성을 확인할 때 쓴다.',
      risk: 'read',
      schema: { projectPath: projectPathArg },
      async run(args) {
        const data = await api.get('/api/project/read', { projectPath: safeProjectPath(args.projectPath) })
        return { text: data.yaml ?? '', data }
      },
    },
    {
      name: 'write_project',
      approval: true,
      title: '프로젝트 저장',
      description:
        'project.yaml 전체를 저장한다(덮어쓰기). 부분 수정을 하려면 먼저 read_project로 읽고, 고친 YAML 전체를 넘긴다.',
      risk: 'write',
      schema: {
        yaml: z.string().min(1).describe('저장할 project.yaml 전체 내용'),
        projectDir: projectPathArg.optional().describe('생략하면 yaml의 projectName으로 폴더를 정한다'),
      },
      async run(args) {
        const body = { yaml: args.yaml }
        if (args.projectDir) body.projectDir = safeProjectPath(args.projectDir)
        const data = await api.post('/api/project/write', body)
        return { text: `저장했습니다: ${data.projectFile}`, data }
      },
    },
    {
      name: 'generate_script',
      title: '대본 생성',
      description:
        '앱의 대본 엔진(2초안 + 자가 심사)으로 쇼츠 대본을 만든다. 톤·장르·길이 규칙이 이미 프롬프트에 박혀 있으니 대본은 직접 쓰지 말고 이 도구를 쓴다.',
      risk: 'run',
      schema: {
        topic: z.string().min(1).describe('영상 주제 한 줄'),
        durationSec: z.number().int().min(15).max(600).default(30).describe('목표 길이(초)'),
        format: z.string().max(30).optional().describe('형식 프리셋(예: 정보전달, 스토리)'),
        genre: z.string().max(30).optional().describe('장르 프리셋'),
        tone: z.string().max(20).optional().describe('말투 프리셋(예: 충청도)'),
        polish: z.boolean().default(true).describe('심사·다듬기 단계 사용 여부'),
        method: scriptMethodArg(defaults),
      },
      async run(args) {
        const data = await api.post('/api/script/generate', {
          topic: args.topic,
          durationSec: args.durationSec,
          format: args.format ?? '',
          genre: args.genre ?? '',
          tone: args.tone ?? '',
          polish: args.polish,
          method: args.method,
          ...withKey(args),
        })
        return { text: data.script ?? '', data }
      },
    },
    {
      name: 'analyze_coupang',
      title: '쿠팡 캡처 분석',
      description:
        '프로젝트에 올려둔 쿠팡 상품 캡처 이미지를 비전으로 읽어 상품명·가격·특징을 뽑는다. 이미지는 프로젝트 폴더 기준 상대 경로로 넘긴다.',
      risk: 'run',
      schema: {
        projectName: z.string().min(1).describe('프로젝트 이름(폴더명)'),
        images: z.array(z.string()).min(1).max(5).describe('프로젝트 폴더 기준 상대 경로 목록. 예: images/capture-1.png'),
        method: z
          .enum(['api-gpt', 'api-gemini', 'api-claude'])
          .default('api-claude')
          .describe('비전 분석 엔진. 이미지 분석은 API 방식만 지원한다.'),
      },
      async run(args) {
        const data = await api.post('/api/coupang/analyze', {
          projectName: args.projectName,
          images: args.images.map((path) => safeProjectPath(path)),
          method: args.method,
          apiKey: defaults.apiKey ?? '',
        })
        return { text: JSON.stringify(data.productInfo ?? {}, null, 2), data }
      },
    },
    {
      name: 'list_voices',
      title: '목소리 목록',
      description: '낭독에 쓸 수 있는 목소리(로컬 클로닝 + 타입캐스트 AI 성우) 목록을 돌려준다.',
      risk: 'read',
      schema: {},
      async run() {
        const data = await api.get('/api/voices')
        const voices = data.voices ?? []
        return {
          text: summarize([`목소리 ${voices.length}개:`, ...voices.map((v) => `- ${v.id ?? v.name}${v.label ? ` (${v.label})` : ''}`)]),
          data,
        }
      },
    },
    {
      name: 'narrate',
      title: '낭독 생성',
      description: '프로젝트 대본을 지정한 목소리로 낭독해 오디오를 만든다. 시간이 걸리는 작업이다.',
      risk: 'run',
      schema: {
        storyboardPath: projectPathArg.describe('낭독할 프로젝트(project.yaml) 경로'),
        voice: z.string().min(1).describe('list_voices가 준 목소리 id'),
        provider: z.string().optional().describe('생략하면 목소리 종류에 맞춰 자동 결정'),
      },
      async run(args) {
        const data = await api.post('/api/narrate', {
          storyboardPath: safeProjectPath(args.storyboardPath),
          voice: args.voice,
          ...(args.provider ? { provider: args.provider } : {}),
        })
        return { text: data.ok ? '낭독을 만들었습니다.' : `낭독 실패: ${data.stderr ?? ''}`.trim(), data }
      },
    },
    {
      name: 'validate_project',
      title: '프로젝트 검증',
      description: '렌더 전에 project.yaml 구성이 올바른지 검사한다. 렌더가 실패하면 먼저 이걸 돌린다.',
      risk: 'run',
      schema: { projectPath: projectPathArg },
      async run(args) {
        const data = await api.post('/api/validate', { projectPath: safeProjectPath(args.projectPath) })
        return { text: data.ok ? '검증 통과' : `검증 실패:\n${data.stderr || data.stdout || ''}`, data }
      },
    },
    {
      name: 'render',
      approval: true,
      title: '영상 렌더',
      description: '프로젝트를 최종 영상으로 렌더한다. 수 분이 걸릴 수 있고 되돌릴 수 없으니 사용자 확인 후 호출한다.',
      risk: 'run',
      schema: { projectPath: projectPathArg },
      async run(args) {
        const data = await api.post('/api/render', { projectPath: safeProjectPath(args.projectPath) })
        return { text: data.ok ? '렌더 완료' : `렌더 실패:\n${data.stderr || data.stdout || ''}`, data }
      },
    },
    {
      name: 'list_jobs',
      title: '작업 목록',
      description: '진행 중이거나 최근 끝난 파이프라인 작업 목록을 본다.',
      risk: 'read',
      schema: {},
      async run() {
        const data = await api.get('/api/jobs')
        const jobs = data.jobs ?? []
        if (jobs.length === 0) return { text: '진행 중인 작업이 없습니다.', data }
        return {
          text: summarize([`작업 ${jobs.length}개:`, ...jobs.map((j) => `- ${j.id} ${j.status} ${j.title ?? ''}`)]),
          data,
        }
      },
    },
    {
      name: 'job_status',
      title: '작업 상태',
      description: '작업 하나의 진행률과 실패 로그 꼬리를 본다. 오래 걸리는 작업은 이걸로 확인한다.',
      risk: 'read',
      schema: { jobId: z.string().min(1) },
      async run(args) {
        const data = await api.get(`/api/jobs/${encodeURIComponent(args.jobId)}`)
        return {
          text: summarize([
            `상태: ${data.status ?? '알 수 없음'}`,
            data.progress ? `진행: ${JSON.stringify(data.progress)}` : null,
            data.stderrTail ? `오류 로그:\n${data.stderrTail}` : null,
          ]),
          data,
        }
      },
    },
    {
      name: 'cancel_job',
      approval: true,
      title: '작업 취소',
      description: '진행 중인 작업을 취소한다. 사용자가 명시적으로 요청했을 때만 쓴다.',
      risk: 'write',
      schema: { jobId: z.string().min(1) },
      async run(args) {
        const data = await api.post(`/api/jobs/${encodeURIComponent(args.jobId)}/cancel`, {})
        return { text: `작업 ${args.jobId}을(를) 취소했습니다.`, data }
      },
    },
    {
      name: 'list_scripts',
      title: '대본 보관함',
      description: '저장해 둔 대본 목록을 본다.',
      risk: 'read',
      schema: {},
      async run() {
        const data = await api.get('/api/scripts')
        const scripts = data.scripts ?? []
        return {
          text: summarize([`대본 ${scripts.length}개:`, ...scripts.map((s) => `- [${s.id}] ${s.title}`)]),
          data,
        }
      },
    },
    {
      name: 'save_script',
      title: '대본 저장',
      description: '완성한 대본을 보관함에 저장한다.',
      risk: 'write',
      schema: {
        script: z.string().min(1),
        title: z.string().max(80).optional(),
        topic: z.string().max(80).optional(),
        durationSec: z.number().int().min(15).max(600).default(30),
        tone: z.string().max(20).optional(),
      },
      async run(args) {
        const data = await api.post('/api/scripts', {
          script: args.script,
          title: args.title ?? '',
          topic: args.topic ?? '',
          durationSec: args.durationSec,
          tone: args.tone ?? '',
        })
        return { text: `보관함에 저장했습니다(${data.id}).`, data }
      },
    },
  ]
}
