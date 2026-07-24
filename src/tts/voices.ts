import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

export interface VoiceRef {
  refAudio: string
  refText?: string
}

/**
 * 목소리 참조를 해석한다.
 * - 절대/상대 wav 경로를 그대로 받거나
 * - 이름만 주면 <workspace>/voices/<이름>.wav (+ 같은 이름 .txt가 있으면 전사로 사용)
 */
export async function resolveVoice(workspaceRoot: string, voice: string): Promise<VoiceRef> {
  const direct = isAbsolute(voice) ? voice : resolve(workspaceRoot, voice)
  if (voice.toLowerCase().endsWith('.wav') || voice.toLowerCase().endsWith('.mp3')) {
    if (!existsSync(direct)) throw new Error(`목소리 샘플을 찾을 수 없습니다: ${voice}`)
    return { refAudio: direct, refText: await readSiblingText(direct) }
  }

  const named = join(workspaceRoot, 'voices', `${voice}.wav`)
  if (!existsSync(named)) {
    throw new Error(
      `등록된 목소리가 없습니다: voices/${voice}.wav\n` +
        `내 목소리 3~10초를 녹음해 voices/${voice}.wav 로 저장하세요. ` +
        `같은 이름의 .txt(말한 문장 그대로)를 함께 두면 품질이 올라갑니다.`,
    )
  }
  return { refAudio: named, refText: await readSiblingText(named) }
}

async function readSiblingText(audioPath: string): Promise<string | undefined> {
  const txt = audioPath.replace(/\.(wav|mp3)$/i, '.txt')
  if (!existsSync(txt)) return undefined
  const content = (await readFile(txt, 'utf8')).trim()
  return content || undefined
}
