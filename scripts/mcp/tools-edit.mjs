/**
 * 편집·진단 도구 — Phase 4. 자막·무음·낭독 조정과 환경 점검을 에이전트에게 연다.
 * 기본 조작 도구는 tools.mjs에 있고, 여기는 "고치기"와 "왜 실패했는지 보기" 쪽이다.
 */
import { z } from 'zod'
import { safeProjectPath } from './api-client.mjs'

const projectPathArg = z
  .string()
  .describe('workspaceRoot 기준 상대 경로. 예: projects/my-item 또는 projects/my-item/project.yaml')

/** 실패한 CLI 결과에서 사람이 읽을 사유를 뽑는다. */
function failureText(data, fallback) {
  const detail = String(data.error || data.stderr || data.stdout || '').trim()
  return detail ? `${fallback}:\n${detail.split('\n').slice(-6).join('\n')}` : fallback
}

export function createEditTools({ api }) {
  return [
    {
      name: 'check_environment',
      title: '실행 환경 점검',
      description:
        '자막·컷 편집에 필요한 외부 도구(ffmpeg, 로컬 Whisper 등)가 깔려 있는지 확인한다. 렌더나 자막이 실패하면 가장 먼저 이걸 돌려 원인을 좁힌다.',
      risk: 'read',
      schema: {},
      async run() {
        const [health, captions] = await Promise.all([api.get('/api/health'), api.get('/api/captions/status')])
        const tools = captions.tools ?? []
        const missing = tools.filter((tool) => !tool.available).map((tool) => tool.id ?? tool.name)
        const lines = [
          `앱 서버: 정상 (${health.workspaceRoot ?? '경로 불명'})`,
          ...tools.map((tool) => `- ${tool.id ?? tool.name}: ${tool.available ? '있음' : '없음'}`),
          `로컬 Whisper 자막: ${captions.localWhisperReady ? '가능' : '불가 — ffmpeg와 whisper가 모두 있어야 한다'}`,
        ]
        if (missing.length > 0) lines.push(`빠진 도구: ${missing.join(', ')}`)
        return { text: lines.join('\n'), data: { health, captions } }
      },
    },
    {
      name: 'analyze_silence',
      title: '무음 구간 분석',
      description:
        '클립에서 잘라낼 무음 구간을 찾는다. 결과는 구간 목록이며, 실제로 자르는 것은 사용자가 타임라인에서 확인한 뒤 한다.',
      risk: 'run',
      schema: {
        projectPath: projectPathArg,
        clipFile: z.string().optional().describe('특정 클립만 볼 때. 생략하면 프로젝트 기본 클립'),
        noiseDb: z.number().min(-90).max(0).optional().describe('무음으로 볼 음량 기준(dB). 기본값이 안 맞을 때만 조정'),
        minDurationSec: z.number().min(0.05).max(10).optional().describe('이 길이보다 짧은 무음은 무시'),
        paddingSec: z.number().min(0).max(2).optional().describe('자를 때 앞뒤로 남길 여유'),
      },
      async run(args) {
        const data = await api.post('/api/silence/analyze', {
          projectPath: safeProjectPath(args.projectPath),
          ...(args.clipFile ? { clipFile: args.clipFile } : {}),
          ...(args.noiseDb !== undefined ? { noiseDb: args.noiseDb } : {}),
          ...(args.minDurationSec !== undefined ? { minDurationSec: args.minDurationSec } : {}),
          ...(args.paddingSec !== undefined ? { paddingSec: args.paddingSec } : {}),
        })
        if (!data.ok) return { text: failureText(data, '무음 분석 실패'), data }
        const ranges = data.report?.silences ?? data.report?.ranges ?? []
        return {
          text: [`무음 구간 ${ranges.length}개`, JSON.stringify(data.report ?? {}).slice(0, 1200)].join('\n'),
          data,
        }
      },
    },
    {
      name: 'generate_captions',
      title: '자막 생성(STT)',
      description:
        '영상 음성을 받아써서 자막을 만든다. 로컬 Whisper가 필요하니 실패하면 check_environment로 확인한다. 시간이 걸리는 작업이다.',
      risk: 'run',
      schema: {
        projectPath: projectPathArg,
        clipFile: z.string().optional().describe('특정 클립만 받아쓸 때'),
        language: z.string().max(10).optional().describe('언어 코드. 한국어는 ko'),
      },
      async run(args) {
        const data = await api.post('/api/captions/generate', {
          projectPath: safeProjectPath(args.projectPath),
          ...(args.clipFile ? { clipFile: args.clipFile } : {}),
          ...(args.language ? { language: args.language } : {}),
        })
        if (!data.ok) return { text: failureText(data, '자막 생성 실패'), data }
        const cues = data.report?.cues ?? []
        return { text: `자막 ${cues.length}줄을 만들었습니다.\n${JSON.stringify(data.report ?? {}).slice(0, 1200)}`, data }
      },
    },
    {
      name: 'save_captions',
      title: '자막 저장',
      description:
        '고친 자막을 SRT 파일로 저장한다(덮어쓰기). 시간은 밀리초 단위이고, 먼저 generate_captions나 read_project로 현재 자막을 확인한 뒤 고친 전체 목록을 넘긴다.',
      risk: 'write',
      approval: true,
      schema: {
        projectPath: projectPathArg,
        srtFile: z.string().min(1).describe('프로젝트 폴더 기준 상대 경로. 예: captions/main.srt'),
        cues: z
          .array(
            z.object({
              startMs: z.number().int().min(0).describe('시작 시각(밀리초)'),
              endMs: z.number().int().min(0).describe('끝 시각(밀리초)'),
              text: z.string().describe('자막 한 줄'),
            }),
          )
          .min(1)
          .describe('자막 전체 목록 — 일부만 넘기면 나머지는 사라진다'),
      },
      async run(args) {
        const data = await api.post('/api/captions/save', {
          projectPath: safeProjectPath(args.projectPath),
          srtFile: args.srtFile,
          cues: args.cues,
        })
        return { text: `자막 ${data.cueCount ?? args.cues.length}줄을 저장했습니다: ${data.srtFile}`, data }
      },
    },
    {
      name: 'list_narrations',
      title: '낭독 파일 목록',
      description: '만들어 둔 낭독 오디오 목록을 본다. adjust_narration에 넘길 이름을 여기서 찾는다.',
      risk: 'read',
      schema: {},
      async run() {
        const data = await api.get('/api/narrations')
        const items = data.narrations ?? []
        if (items.length === 0) return { text: '낭독 파일이 없습니다.', data }
        return { text: [`낭독 ${items.length}개:`, ...items.map((item) => `- ${item.name ?? item.id}`)].join('\n'), data }
      },
    },
    {
      name: 'adjust_narration',
      title: '낭독 속도·음정 조정',
      description:
        '기존 낭독의 속도와 음정을 바꿔 새 파일로 만든다(원본은 그대로 둔다). 속도 1은 원본, 1.2면 20% 빠르게. 음정은 반음 단위.',
      risk: 'run',
      schema: {
        name: z.string().min(1).describe('list_narrations가 준 낭독 이름(확장자 없이)'),
        speed: z.number().min(0.5).max(2).default(1).describe('배속. 0.5~2'),
        pitch: z.number().int().min(-6).max(6).default(0).describe('반음 단위 음정. -6~6'),
      },
      async run(args) {
        const data = await api.post('/api/narrations/adjust', {
          name: args.name,
          speed: args.speed,
          pitch: args.pitch,
        })
        return { text: `조정한 낭독을 만들었습니다: ${data.name ?? data.output ?? args.name}`, data }
      },
    },
    {
      name: 'source_remix',
      title: '소스 짜집기',
      description:
        '대본 문장과 업로드된 소스 영상을 AI로 매칭해 한 편으로 엮는다. 소스 영상 업로드는 사용자가 앱에서 먼저 해야 한다(도구로는 못 올린다).',
      risk: 'run',
      approval: true,
      schema: {
        projectName: z.string().min(1).describe('프로젝트 이름(폴더명)'),
        script: z.string().min(1).describe('낭독·자막에 쓸 대본 전문'),
        clips: z.array(z.string()).min(1).max(10).describe('프로젝트 폴더 기준 소스 영상 상대 경로'),
        voice: z.string().min(1).describe('낭독 목소리 id — 자막이 이 타이밍에 맞춰진다'),
        ratio: z.enum(['9:16', '16:9']).default('9:16'),
      },
      async run(args) {
        const data = await api.post('/api/source-remix', {
          projectName: args.projectName,
          script: args.script,
          clips: args.clips.map((path) => safeProjectPath(path)),
          voice: args.voice,
          ratio: args.ratio,
        })
        if (!data.ok) return { text: failureText(data, '소스 짜집기 실패'), data }
        return { text: `짜집기를 마쳤습니다: ${data.finalVideo ?? data.projectDir ?? ''}`, data }
      },
    },
  ]
}
