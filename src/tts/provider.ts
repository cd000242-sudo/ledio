export interface TtsItem {
  /** 생성할 문장 */
  text: string
  /** 출력 wav 절대경로 */
  out: string
}

export interface TtsRequest {
  /** 내 목소리 참조 샘플(wav) 절대경로, 또는 typecast:<voice_id> (타입캐스트 성우) */
  refAudio: string
  /** 참조 샘플에서 말한 문장(있으면 클로닝 품질 상승) */
  refText?: string
  language: string
  items: TtsItem[]
  /** 항목 하나가 완성될 때마다 호출된다(진행 게이지용). JSON 직렬화 시 자동 제외. */
  onProgress?: (done: number, total: number) => void
}

export interface TtsItemResult {
  out: string
  durationSec: number
}

export interface TtsResult {
  ok: boolean
  device?: string
  results: TtsItemResult[]
}

export interface TtsProvider {
  readonly name: string
  synthesize(request: TtsRequest): Promise<TtsResult>
}
