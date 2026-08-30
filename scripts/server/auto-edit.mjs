/**
 * 자동 편집 오케스트레이션 — 넣어두면 알아서 다듬는다.
 *
 * 순서: ① 받아쓰기 → ② 자를 후보 고르기 → (사람 확인) → ③ 자르기 → ④ 자막 → ⑤ 소리
 * 핵심 원칙: **후보를 만들어 보여줄 뿐, 자동으로 자르지 않는다.**
 * 무엇을 왜 자르는지 보여주고 체크된 것만 실행한다.
 */
import { basename, dirname, extname, join } from 'node:path'

export function autoEditPaths(mediaPath) {
  const dir = dirname(mediaPath)
  const stem = basename(mediaPath, extname(mediaPath))
  const ext = extname(mediaPath) || '.mp4'
  return {
    keepJson: join(dir, `.cuts-${stem}.json`),
    edited: join(dir, `${stem}_편집${ext}`),
  }
}

/** 후보 목록을 화면에 보여줄 형태로 다듬는다(시:분:초 표기 포함). */
export function describeCandidates(candidates) {
  return candidates.map((candidate, index) => ({
    id: `c-${index}`,
    startMs: candidate.startMs,
    endMs: candidate.endMs,
    time: `${formatClock(candidate.startMs)} – ${formatClock(candidate.endMs)}`,
    seconds: Number(((candidate.endMs - candidate.startMs) / 1000).toFixed(1)),
    text: candidate.text,
    reason: candidate.reason,
    label: candidate.label,
    suggested: candidate.suggested,
    // 다시 찍은 경우 남길 쪽(뒤 테이크)도 함께 넘긴다 — 화면에서 앞뒤를 나란히 보여준다.
    ...(candidate.keep
      ? {
          keep: candidate.keep,
          keepTime: `${formatClock(candidate.keep.startMs)} – ${formatClock(candidate.keep.endMs)}`,
        }
      : {}),
  }))
}

export function formatClock(ms) {
  const total = Math.max(0, Math.round(ms / 100) / 10)
  const minutes = Math.floor(total / 60)
  const seconds = (total % 60).toFixed(1).padStart(4, '0')
  return `${String(minutes).padStart(2, '0')}:${seconds}`
}

/**
 * ① 받아쓰기 → ② 후보 고르기.
 * @param deps `{ transcribe(mediaPath): Promise<Cue[]>, subtitles, autoCut }`
 */
export async function analyzeForAutoEdit(mediaPath, deps, options = {}) {
  const { transcribe, subtitles, autoCut } = deps
  const words = await transcribe(mediaPath)
  if (!Array.isArray(words) || words.length === 0) {
    return { ok: false, error: '받아쓰기 결과가 비어 있습니다. 음성이 있는 영상인지 확인하세요.' }
  }

  const strength = options.strength ?? 'normal'

  // 무음은 **단어 사이**에서 봐야 잡힌다. 문장으로 묶으면 문장 안의 쉼이 보이지 않는다.
  const silences = autoCut
    .findCutCandidates(words, { strength })
    .filter((candidate) => candidate.reason === 'silence')

  // 군더더기·중복·말끊김은 **문장 단위**로 봐야 판단이 선다.
  const sentences = subtitles.reformatSubtitles(words, { minChars: 12, maxChars: 60 })
  const textual = autoCut
    .findCutCandidates(sentences, { strength })
    .filter((candidate) => candidate.reason !== 'silence')

  const candidates = [...silences, ...textual].sort((left, right) => left.startMs - right.startMs)
  const totalMs = words[words.length - 1]?.endMs ?? 0

  return {
    ok: true,
    totalMs,
    wordCount: words.length,
    sentenceCount: sentences.length,
    candidates: describeCandidates(candidates),
    cues: words,
  }
}

/**
 * ③ 고른 후보로 실제 컷 계획을 만든다.
 * @param deps `{ autoCut, writeFile, runCommand(args): Promise<{ok, outPath, error}> }`
 */
export async function applySelectedCuts(mediaPath, selected, totalMs, deps, options = {}) {
  const { autoCut, writeFile, runCommand } = deps
  if (!Array.isArray(selected) || selected.length === 0) {
    return { ok: false, error: '자를 구간을 하나도 고르지 않았습니다.' }
  }

  const plan = autoCut.buildCutPlan(selected, totalMs)
  const keep = autoCut.keepRanges(plan, totalMs)
  if (keep.length === 0) {
    return { ok: false, error: '전부 잘라내면 남는 영상이 없습니다. 선택을 줄여보세요.' }
  }

  const paths = autoEditPaths(mediaPath)
  await writeFile(paths.keepJson, JSON.stringify(keep), 'utf8')
  const args = ['apply-cuts', mediaPath, '--keep', paths.keepJson, '--json']
  // 자연스럽게 잇기를 끄면 자른 자리에서 소리가 뚝 끊긴다 — 사용자가 고를 수 있게 한다.
  if (options.smoothJoin === false) args.push('--fade-ms', '0')
  const result = await runCommand(args)
  if (!result.ok) return { ok: false, error: result.error ?? '컷 적용에 실패했습니다.' }

  return {
    ok: true,
    outPath: result.outPath ?? paths.edited,
    removedMs: plan.removedMs,
    keptMs: plan.keptMs,
    pieces: keep.length,
  }
}


/**
 * 받아쓰기 진행 상황을 읽는다.
 *
 * 파이썬이 영상 옆 작업 폴더에 퍼센트를 계속 적어 둔다(whisperx가 주는 진짜 값이다).
 * 아직 없거나 반쯤 쓰인 파일이면 '준비 중'으로 답한다 — 진행 표시 때문에 작업이 막히면 안 된다.
 */
export async function readAutoEditProgress(mediaPath, deps) {
  const { readFile, progressPathFor } = deps
  const waiting = { ok: true, stage: 'starting', percent: 0 }
  try {
    const path = progressPathFor ? progressPathFor(mediaPath) : mediaPath
    const raw = await readFile(path, 'utf8')
    const parsed = JSON.parse(raw)
    const percent = Math.min(100, Math.max(0, Number(parsed.percent) || 0))
    return { ok: true, stage: String(parsed.stage || 'starting'), percent }
  } catch {
    return waiting
  }
}
