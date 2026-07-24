/* global Buffer, fetch, setTimeout */
/**
 * Seedance(fal.ai) 이미지→영상 생성기.
 * 장면 이미지 한 장을 첫 프레임으로 받아 5초 내외의 움직이는 클립(mp4)을 만든다.
 * 흐름: 이미지 base64 업로드 → 큐 등록 → 상태 폴링 → 결과 mp4 다운로드.
 */

import { readFile, writeFile } from 'node:fs/promises'

const QUEUE_BASE = 'https://queue.fal.run/fal-ai/bytedance/seedance/v1/lite/image-to-video'

async function falFetch(url, apiKey, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Key ${apiKey}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`fal.ai 오류(${response.status}): ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

function imageToDataUrl(buffer, filePath) {
  const ext = String(filePath).toLowerCase()
  const mime = ext.endsWith('.png') ? 'image/png' : ext.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  return `data:${mime};base64,${buffer.toString('base64')}`
}

/**
 * @param {string} prompt 장면 묘사(움직임 위주로)
 * @param {{ apiKey: string, imagePath: string, outPath: string, durationSec?: number, resolution?: string }} options
 * @returns {Promise<{ ok: boolean, outPath?: string, error?: string }>}
 */
export async function makeSeedanceVideo(prompt, options, onLog) {
  const { apiKey, imagePath, outPath } = options
  if (!apiKey) return { ok: false, error: 'fal.ai API 키가 필요합니다. 환경설정에서 입력하세요.' }
  try {
    const imageBuffer = await readFile(imagePath)
    onLog?.('Seedance 영상 생성 요청 중...')
    const submitted = await falFetch(QUEUE_BASE, apiKey, {
      method: 'POST',
      body: JSON.stringify({
        prompt,
        image_url: imageToDataUrl(imageBuffer, imagePath),
        duration: String(Math.min(10, Math.max(3, options.durationSec ?? 5))),
        resolution: options.resolution ?? '480p',
      }),
    })
    const statusUrl = submitted.status_url ?? `${QUEUE_BASE}/requests/${submitted.request_id}/status`
    const resultUrl = submitted.response_url ?? `${QUEUE_BASE}/requests/${submitted.request_id}`

    const startTs = Date.now()
    for (;;) {
      if (Date.now() - startTs > 10 * 60 * 1000) return { ok: false, error: 'Seedance 생성 시간 초과(10분)' }
      await new Promise((r) => setTimeout(r, 4000))
      const status = await falFetch(statusUrl, apiKey)
      if (status.status === 'COMPLETED') break
      if (status.status === 'FAILED' || status.status === 'ERROR') {
        return { ok: false, error: `Seedance 생성 실패: ${JSON.stringify(status).slice(0, 200)}` }
      }
      onLog?.(`Seedance 생성 중... (${Math.round((Date.now() - startTs) / 1000)}초 경과)`)
    }

    const result = await falFetch(resultUrl, apiKey)
    const videoUrl = result.video?.url ?? result.video_url
    if (!videoUrl) return { ok: false, error: 'Seedance 응답에 영상 URL이 없습니다.' }
    const videoResponse = await fetch(videoUrl)
    if (!videoResponse.ok) return { ok: false, error: `영상 다운로드 실패(${videoResponse.status})` }
    await writeFile(outPath, Buffer.from(await videoResponse.arrayBuffer()))
    onLog?.('Seedance 영상 저장 완료')
    return { ok: true, outPath }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}
