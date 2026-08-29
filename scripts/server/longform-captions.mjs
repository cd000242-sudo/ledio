/**
 * 롱폼 자막 오케스트레이션 — 노션 "자막 자동화" 4단계를 잇는다.
 *   ① 세밀 STT(CLI/WhisperX) → ② 대본 대조 보정(LLM) → ③ 롱폼 재편성 → ④ 공백 메움 → ⑤ 검수
 *
 * 무거운 STT는 CLI가 하고, 여기서는 순수 변환(dist 모듈)과 LLM 호출만 엮는다.
 * 시각(타임스탬프)은 STT 결과에서만 오고, 어떤 단계에서도 새로 만들지 않는다.
 */
import { basename, dirname, extname, join } from 'node:path'
import { rm } from 'node:fs/promises'

/** 결과 파일 경로 — 원본 옆에 두고 기존 파일은 절대 덮어쓰지 않는다(노션 규칙). */
export function outputPaths(mediaPath) {
  const dir = dirname(mediaPath)
  const stem = basename(mediaPath, extname(mediaPath))
  return {
    aligned: join(dir, `${stem}_정렬.srt`),
    filled: join(dir, `${stem}_정렬_공백메움.srt`),
    script: join(dir, `${stem}_대본.txt`),
    burnSrt: join(dir, `${stem}_영상자막.srt`),
  }
}

/**
 * 대본 대조 보정 — 배치로 나눠 LLM에 보내고, 형식이 어긋난 배치는 조용히 원본을 유지한다.
 * @param {object} deps `{ askModel(prompt): Promise<string>, correct: dist/subtitles/correct 모듈 }`
 */
export async function correctWithScript(cues, script, deps, onProgress = () => {}) {
  const { askModel, correct } = deps
  const batches = correct.splitIntoBatches(cues)
  const results = []
  for (let index = 0; index < batches.length; index += 1) {
    const batch = batches[index]
    onProgress({ stage: 'correct', done: index, total: batches.length })
    try {
      const response = await askModel(correct.buildCorrectionPrompt(batch.cues, script))
      results.push({ offset: batch.offset, cues: correct.applyCorrectionResponse(batch.cues, response) })
    } catch {
      // 한 배치가 실패해도 전체를 버리지 않는다 — 그 구간만 원본을 쓴다.
      results.push({ offset: batch.offset, cues: null })
    }
  }
  const corrected = correct.mergeCorrectedBatches(cues, results)
  const failed = results.filter((result) => !result.cues).length
  return { cues: corrected, batches: batches.length, failedBatches: failed }
}

/**
 * 세밀 큐 → 최종 파일 2개 + 검수 리포트.
 * @param {object} deps `{ subtitles: { reformatSubtitles, fillGaps, serializeSrt, auditSubtitles, summarizeAudit }, writeFile }`
 */
export async function buildLongformOutputs(cues, mediaPath, deps, options = {}) {
  const { subtitles, writeFile } = deps
  const minChars = options.minChars ?? 18
  const maxChars = options.maxChars ?? 44

  const aligned = subtitles.reformatSubtitles(cues, { minChars, maxChars })
  const filled = subtitles.fillGaps(aligned)
  const paths = outputPaths(mediaPath)

  await writeFile(paths.aligned, subtitles.serializeSrt(aligned), 'utf8')
  await writeFile(paths.filled, subtitles.serializeSrt(filled), 'utf8')

  const alignedAudit = subtitles.auditSubtitles(aligned, { minChars, maxChars })
  const filledAudit = subtitles.auditSubtitles(filled, { minChars, maxChars, expectNoGaps: true })

  return {
    files: paths,
    cueCount: aligned.length,
    audit: {
      aligned: { ...alignedAudit, summary: subtitles.summarizeAudit(alignedAudit) },
      filled: { ...filledAudit, summary: subtitles.summarizeAudit(filledAudit) },
    },
  }
}

/**
 * 음성에서 읽을 수 있는 대본을 만든다 — 대본이 없는 영상에서 쓴다.
 * 다듬기(선택)는 표기만 고치고, 분량이 크게 달라지면 원본을 지킨다.
 * @param {object} deps `{ script: dist/subtitles/script 모듈, writeFile, askModel? }`
 */
export async function buildScriptFile(cues, mediaPath, deps, options = {}) {
  const { script: scriptModule, writeFile, askModel } = deps
  const raw = scriptModule.cuesToScript(cues, { paragraphGapMs: options.paragraphGapMs ?? 1200 })
  if (!raw) return null

  let text = raw
  let polished = false
  if (options.polish && askModel) {
    try {
      const response = await askModel(scriptModule.buildScriptPolishPrompt(raw))
      text = scriptModule.acceptPolishedScript(raw, response)
      polished = text !== raw
    } catch {
      // 다듬기 실패는 치명적이지 않다 — 받아쓴 대본을 그대로 저장한다.
    }
  }

  const path = outputPaths(mediaPath).script
  await writeFile(path, text, 'utf8')
  return { path, chars: [...text].length, polished }
}

/**
 * 영상에 구울 자막을 따로 만든다.
 * 화면 자막은 파일 자막보다 짧아야 한다 — 길면 libass가 두 줄로 접으면서 어절 중간을 자른다(실측).
 */
export async function buildBurnSrt(cues, mediaPath, deps, options = {}) {
  const { subtitles, writeFile } = deps
  const maxChars = options.burnMaxChars ?? 26
  const short = subtitles.reformatSubtitles(cues, { minChars: Math.min(12, maxChars), maxChars })
  const filled = subtitles.fillGaps(short)
  const path = outputPaths(mediaPath).burnSrt
  await writeFile(path, subtitles.serializeSrt(filled), 'utf8')
  return { path, cueCount: filled.length }
}

/**
 * 결과물 정리 — 중간 파일이 원본 옆에 쌓이는 것을 막는다.
 *
 * 'video'  완성 영상만 남긴다(자막 파일·대본·임시 폴더 삭제)
 * 'script' 완성 영상 + 대본 (기본)
 * 'all'    전부 남긴다
 *
 * 영상을 만들지 못했으면 무엇도 지우지 않는다 — 유일한 결과물을 날리면 안 된다.
 */
export async function tidyOutputs(mediaPath, keep, madeVideo, deps = {}) {
  const remove = deps.remove ?? ((path) => rm(path, { recursive: true, force: true }))
  if (keep === 'all' || !madeVideo) return { removed: [] }

  const paths = outputPaths(mediaPath)
  const targets = [paths.aligned, paths.filled, paths.burnSrt]
  if (keep === 'video') targets.push(paths.script)
  targets.push(join(dirname(mediaPath), '.whisperx'))

  const removed = []
  for (const target of targets) {
    try {
      await remove(target)
      removed.push(target)
    } catch {
      // 지우지 못해도 작업 자체는 성공이다 — 조용히 넘어간다.
    }
  }
  return { removed }
}

/**
 * 대본 없이 문맥만으로 오타를 교정한다.
 * 대본 대조와 같은 안전장치를 쓴다 — 줄 수가 어긋난 배치는 버리고 원본을 지킨다.
 */
export async function proofreadCues(cues, glossaryText, deps) {
  const { askModel, correct, glossary } = deps
  const terms = glossary.parseGlossary(glossaryText).terms
  const batches = correct.splitIntoBatches(cues)
  const results = []
  for (const batch of batches) {
    try {
      const response = await askModel(correct.buildProofreadPrompt(batch.cues, terms))
      results.push({ offset: batch.offset, cues: correct.applyCorrectionResponse(batch.cues, response) })
    } catch {
      results.push({ offset: batch.offset, cues: null })
    }
  }
  return {
    cues: correct.mergeCorrectedBatches(cues, results),
    batches: batches.length,
    failedBatches: results.filter((result) => !result.cues).length,
  }
}
