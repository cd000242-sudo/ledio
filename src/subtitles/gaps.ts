import type { Cue } from './srt.js'

/**
 * 각 자막의 종료 시간을 다음 자막 시작 시간까지 연장한다.
 * - 시작 시간은 그대로 유지(겹침 방지)
 * - 마지막 자막은 변경 없음
 * 말 사이 멈춤 구간에 자막이 깜빡이며 사라지는 현상을 없앤다.
 */
export function fillGaps(cues: Cue[]): Cue[] {
  return cues.map((cue, i) => {
    const next = cues[i + 1]
    if (!next) return { ...cue }
    // 종료를 다음 시작에 맞춰 연속시킨다(겹침 제거 포함). 비정상 순서는 그대로 둠.
    const endMs = next.startMs > cue.startMs ? next.startMs : cue.endMs
    return { ...cue, endMs }
  })
}
