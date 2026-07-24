#!/usr/bin/env node
import { Command } from 'commander'
import { runValidate } from './commands/validate.js'
import { runRender } from './commands/render.js'
import { runPackage } from './commands/package.js'
import { runReleaseBundle } from './commands/releaseBundle.js'
import { runAnalyzeLongform } from './commands/analyzeLongform.js'
import { runStoryboardRender } from './commands/storyboardRender.js'
import { runGenerateStoryImages } from './commands/generateStoryImages.js'
import { runDiscoverSources } from './commands/discoverSources.js'
import { runUploadPackage } from './commands/uploadPackage.js'
import { runAnalyzeSilence } from './commands/analyzeSilence.js'
import { runAutoCaption } from './commands/autoCaption.js'
import { runAutocut } from './commands/autocut.js'
import { runNarrate } from './commands/narrate.js'
import { runStoryPipeline } from './commands/storyPipeline.js'
import { runSourceRemix } from './commands/sourceRemix.js'
import { runProductRender } from './commands/productRender.js'
import { STORY_TEMPLATES } from '../story/scriptTemplates.js'
import { logger } from '../utils/logger.js'

const program = new Command()

program
  .name('shorts-factory')
  .description('로컬 우선 쇼핑 쇼츠 자동 생성 도구')
  .version('0.1.0')

program
  .command('validate')
  .description('project.yaml과 클립을 검증한다')
  .argument('<projectPath>', '프로젝트 폴더 또는 project.yaml 경로')
  .action(async (projectPath: string) => {
    process.exitCode = await runValidate(projectPath)
  })

program
  .command('render')
  .description('쇼츠 MP4 변형들을 생성한다')
  .argument('<projectPath>', '프로젝트 폴더 또는 project.yaml 경로')
  .action(async (projectPath: string) => {
    process.exitCode = await runRender(projectPath)
  })

program
  .command('package')
  .description('플랫폼별 업로드 자료와 성과 기록 템플릿을 ZIP으로 묶는다')
  .argument('<projectPath>', '프로젝트 폴더 또는 project.yaml 경로')
  .action(async (projectPath: string) => {
    process.exitCode = await runPackage(projectPath)
  })

program
  .command('release-bundle')
  .description('Builds the local app release folder and ZIP')
  .option('-o, --out-dir <dir>', 'release output directory')
  .action(async (options: { outDir?: string }) => {
    process.exitCode = await runReleaseBundle(options)
  })

program
  .command('analyze-longform')
  .description('Analyzes a longform video and creates highlight candidate files')
  .argument('<file>', 'longform source video file')
  .requiredOption('--product-name <name>', 'product name for generated shorts projects')
  .requiredOption('--affiliate-url <url>', 'affiliate or product URL')
  .option('--project-name <name>', 'analysis project name')
  .option('--target-duration <seconds>', 'target highlight duration in seconds', '45')
  .option('--transcript <srt>', 'SRT transcript for semantic highlight scoring')
  .option('--vision-scoring', 'enable FFmpeg scene-change scoring')
  .option('--scene-threshold <value>', 'FFmpeg scene-change threshold', '0.18')
  .option('--out-dir <dir>', 'output directory for analysis files')
  .action(async (file: string, options: Parameters<typeof runAnalyzeLongform>[1]) => {
    process.exitCode = await runAnalyzeLongform(file, options)
  })

program
  .command('analyze-silence')
  .description('Analyzes silence ranges for one project clip and returns an edit plan')
  .argument('<projectPath>', '프로젝트 폴더 또는 project.yaml 경로')
  .option('--clip <file>', 'clip file path from project.yaml')
  .option('--noise-db <db>', 'silence threshold in dB', '-35')
  .option('--min-duration <seconds>', 'minimum silence duration', '0.6')
  .option('--padding <seconds>', 'silent cut padding to keep around speech', '0.08')
  .option('--json', 'print JSON report')
  .action(async (projectPath: string, options: Parameters<typeof runAnalyzeSilence>[1]) => {
    process.exitCode = await runAnalyzeSilence(projectPath, options)
  })

program
  .command('auto-caption')
  .description('Generates SRT captions for one project clip')
  .argument('<projectPath>', 'project folder or project.yaml path')
  .option('--clip <file>', 'clip file path from project.yaml')
  .option('--provider <provider>', 'caption provider: local-whisper or mock', 'local-whisper')
  .option('--language <language>', 'spoken language code, or auto', 'ko')
  .option('--model <model>', 'Whisper model name', 'base')
  .option('--model-dir <dir>', 'directory for downloaded Whisper model files')
  .option('--min-chars <count>', 'minimum subtitle text length before merging', '8')
  .option('--max-chars <count>', 'maximum subtitle text length per cue', '28')
  .option('--whisper-bin <path>', 'absolute path or command name for whisper')
  .option('--json', 'print JSON report')
  .action(async (projectPath: string, options: Parameters<typeof runAutoCaption>[1]) => {
    process.exitCode = await runAutoCaption(projectPath, options)
  })

program
  .command('storyboard-render')
  .description('Turns story scene images into video clips and a project.yaml')
  .argument('<inputPath>', 'storyboard JSON or YAML file')
  .option('--out-dir <dir>', 'output directory for clips and project.yaml')
  .option('--motion-dir <dir>', 'scene_XX.mp4 i2v 결과 폴더(있으면 정지 이미지 대신 사용)')
  .option('--bgm <path>', '배경음악 파일(mp3/wav 등) — 낮은 볼륨으로 깔림')
  .action(async (inputPath: string, options: Parameters<typeof runStoryboardRender>[1]) => {
    process.exitCode = await runStoryboardRender(inputPath, options)
  })

program
  .command('generate-story-images')
  .description('Generates story scene images and a storyboard.json from a script')
  .argument('<inputPath>', 'story image generation JSON or YAML input')
  .option('--out-dir <dir>', 'output directory for generated images and storyboard')
  .option('--provider <provider>', 'image provider: gpt, gemini, leaders_nano_banana_pro, or mock', 'gpt')
  .option('--model <model>', 'model name for the selected image provider')
  .option('--shots <path>', 'AI 촬영감독 숏 연출 JSON({world, shots})')
  .action(async (inputPath: string, options: Parameters<typeof runGenerateStoryImages>[1]) => {
    process.exitCode = await runGenerateStoryImages(inputPath, options)
  })

program
  .command('discover-sources')
  .description('Discovers product-related reference videos for the source board')
  .requiredOption('--product-name <name>', 'product name or query seed')
  .option('--query <query...>', 'explicit discovery queries')
  .option('--max-results <count>', 'max results per query', '5')
  .option('--provider <provider>', 'discovery provider: youtube or mock', 'youtube')
  .option('--out-dir <dir>', 'output directory for discovery files')
  .action(async (options: Parameters<typeof runDiscoverSources>[0]) => {
    process.exitCode = await runDiscoverSources(options)
  })

program
  .command('upload-package')
  .description('Uploads a publish_package using dry-run, mock, or live providers')
  .argument('<packageDir>', 'publish_package folder')
  .option('--mode <mode>', 'upload mode: dry_run, mock, or live', 'dry_run')
  .option('--platform <platform...>', 'limit upload to one or more platforms')
  .option('--public-base-url <url>', 'public base URL for providers that pull video by URL')
  .option('--out <file>', 'output JSON result file')
  .action(async (packageDir: string, options: Parameters<typeof runUploadPackage>[1]) => {
    process.exitCode = await runUploadPackage(packageDir, options)
  })

program
  .command('autocut')
  .description('무음 구간을 자동으로 잘라 편집 시간을 줄인다 (영상/오디오 파일)')
  .argument('<input>', '입력 영상/오디오 파일 경로')
  .option('--min-silence <seconds>', '이 길이 이상인 무음만 컷', '0.6')
  .option('--padding <seconds>', '말 앞뒤로 남길 무음(초)', '0.1')
  .option('--min-keep <seconds>', '이보다 짧은 유지 구간은 버림', '0.3')
  .option('--noise-db <db>', '무음 판정 음량 임계값(dB, 음수)', '-30')
  .option('-o, --out <file>', '출력 파일 경로')
  .action(
    async (
      input: string,
      options: {
        minSilence: string
        padding: string
        minKeep: string
        noiseDb: string
        out?: string
      },
    ) => {
      process.exitCode = await runAutocut(input, {
        minSilence: Number(options.minSilence),
        padding: Number(options.padding),
        minKeep: Number(options.minKeep),
        noiseDb: Number(options.noiseDb),
        out: options.out,
      })
    },
  )

program
  .command('story-templates')
  .description('대본 구조 템플릿(훅/전개/반전/CTA) 목록을 출력한다')
  .option('--json', 'JSON으로 출력')
  .action((options: { json?: boolean }) => {
    if (options.json) {
      console.log(JSON.stringify({ ok: true, templates: STORY_TEMPLATES }, null, 2))
      return
    }
    for (const t of STORY_TEMPLATES) {
      logger.info(`${t.key.padEnd(12)} ${t.label} — ${t.description}`)
    }
  })

program
  .command('product-render')
  .description('쇼핑쇼츠 스펙(JSON)으로 클립+상품정보 → 변형 N개 렌더')
  .argument('<spec>', '쇼핑쇼츠 스펙 JSON 파일')
  .action(async (spec: string) => {
    process.exitCode = await runProductRender(spec)
  })

program
  .command('story-pipeline')
  .description('대본 입력 → 이미지 → 나레이션 → 완성 쇼츠까지 한 번에 (중단 지점 재개)')
  .argument('<input>', 'story-image-input yaml/json (projectName, script 포함)')
  .option('--voice <name>', 'voices/<이름>.wav (없으면 나레이션 생략)')
  .option('--image-provider <provider>', 'gpt|gemini|leaders|dropshot|mock', 'gpt')
  .option('--image-model <model>', '이미지 모델명')
  .option('--tts-provider <provider>', 'qwen3|typecast|mock', 'qwen3')
  .option('--motion-mode <mode>', '장면 영상화: none|hook|all', 'none')
  .option('--motion-engine <engine>', '영상화 엔진: seedance|dropshot', 'seedance')
  .option('--bgm <path>', '배경음악 파일(mp3/wav 등) — 낮은 볼륨으로 깔림')
  .option('--shots <path>', 'AI 촬영감독 숏 연출 JSON(장면별 구도·앵글)')
  .option('--delivery <path>', '문장별 낭독 말투 연출 계획 JSON')
  .option('--caption-position <position>', '자막 위치: top|center|bottom (기본: 종전 하단)')
  .option('--caption-max-chars <n>', '자막을 N자 이하 cue로 쪼개 TTS 타이밍에 동기화')
  .option('--out-dir <dir>', '파이프라인 산출물 폴더')
  .option('--force', '산출물이 있어도 전체 재실행')
  .action(
    async (
      input: string,
      options: {
        voice?: string
        imageProvider: string
        imageModel?: string
        ttsProvider: string
        motionMode?: string
        motionEngine?: string
        outDir?: string
        force?: boolean
        delivery?: string
        captionPosition?: string
        captionMaxChars?: string
      },
    ) => {
      process.exitCode = await runStoryPipeline(input, {
        ...options,
        captionMaxChars: options.captionMaxChars ? Number(options.captionMaxChars) : undefined,
      })
    },
  )

program
  .command('source-remix')
  .description('소스 영상 짜집기: plan.json → 나레이션 → 컷·자막 블러 → 12자 센터 자막 → 완성 영상')
  .argument('<plan>', '리믹스 계획 JSON(서버 분석 산출물)')
  .requiredOption('--voice <name>', 'voices/<이름>.wav 또는 typecast:<voice_id>')
  .option('--tts-provider <provider>', 'qwen3|typecast|mock', 'qwen3')
  .option('--delivery <path>', '문장별 낭독 말투 연출 계획 JSON')
  .option('--out-dir <dir>', '산출물 폴더 (기본: plan.json 폴더)')
  .action(async (plan: string, options: Parameters<typeof runSourceRemix>[1]) => {
    process.exitCode = await runSourceRemix(plan, options)
  })

program
  .command('narrate')
  .description('내 목소리(보이스 클로닝)로 나레이션 wav를 생성한다')
  .argument('<input>', '스토리보드 yaml 또는 텍스트 파일')
  .requiredOption('--voice <name>', 'voices/<이름>.wav 또는 wav 경로, 또는 typecast:<voice_id>')
  .option('--provider <provider>', 'qwen3, typecast 또는 mock', 'qwen3')
  .option('--language <language>', '언어', 'Korean')
  .option('--out-dir <dir>', '출력 폴더 (기본: 입력 옆 narration/)')
  .option('--delivery <path>', '낭독 연출 계획 JSON (문장별 pace/pause)')
  .action(async (input: string, options: Parameters<typeof runNarrate>[1]) => {
    process.exitCode = await runNarrate(input, options)
  })

await program.parseAsync(process.argv)

// 작업이 끝나면 드롭샷 브라우저를 닫고 프로세스를 확실하게 종료한다.
// 열린 브라우저 소켓 같은 핸들이 남으면 CLI가 매달려서 잡이 영원히 running으로 보인다.
try {
  const { pathToFileURL } = await import('node:url')
  const { join } = await import('node:path')
  const dropshot = (await import(
    pathToFileURL(join(process.cwd(), 'scripts', 'dropshot-generator.mjs')).href
  ).catch(() => null)) as { closeDropshotBrowser?: () => Promise<void> } | null
  await dropshot?.closeDropshotBrowser?.()
} catch {
  // 정리 실패는 종료를 막지 않는다
}
process.exit(process.exitCode ?? 0)
