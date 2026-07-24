/* global Buffer, fetch, process, setTimeout */
/**
 * 힉스필드(Higgsfield DoP) 이미지→영상 생성기.
 * 장면 이미지 한 장을 첫 프레임으로 받아 5초 내외의 시네마틱 클립(mp4)을 만든다.
 * 흐름: POST /v1/image2video/dop (job-set 등록) → job-set 폴링 → 결과 mp4 다운로드.
 * 인증: hf-api-key + hf-secret 헤더 (platform.higgsfield.ai에서 발급).
 */

import { readFile, writeFile } from 'node:fs/promises'

function apiBase() {
  return (process.env.HIGGSFIELD_API_BASE ?? 'https://platform.higgsfield.ai').replace(/\/+$/, '')
}

async function hfFetch(url, apiKey, apiSecret, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      'hf-api-key': apiKey,
      'hf-secret': apiSecret,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  })
  const text = await response.text()
  if (!response.ok) throw new Error(`힉스필드 오류(${response.status}): ${text.slice(0, 300)}`)
  return JSON.parse(text)
}

function imageToDataUrl(buffer, filePath) {
  const ext = String(filePath).toLowerCase()
  const mime = ext.endsWith('.png') ? 'image/png' : ext.endsWith('.webp') ? 'image/webp' : 'image/jpeg'
  return `data:${mime};base64,${buffer.toString('base64')}`
}

/** 응답 어디에 있든 첫 mp4/영상 URL을 찾는다(플랫폼 응답 형태 변화에 관대하게). */
export function findVideoUrl(value) {
  if (typeof value === 'string') {
    return /^https?:\/\//.test(value) && /\.(mp4|webm|mov)(\?|$)/i.test(value) ? value : null
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findVideoUrl(item)
      if (found) return found
    }
    return null
  }
  if (value && typeof value === 'object') {
    for (const key of ['raw', 'url', 'video', 'result', 'results', 'jobs', 'outputs']) {
      if (key in value) {
        const found = findVideoUrl(value[key])
        if (found) return found
      }
    }
    for (const item of Object.values(value)) {
      const found = findVideoUrl(item)
      if (found) return found
    }
  }
  return null
}

/** job-set 응답에서 전체 상태를 뽑는다: completed | failed | nsfw | 진행 중(null). */
export function jobSetStatus(value) {
  const jobs = Array.isArray(value?.jobs) ? value.jobs : []
  const statuses = jobs.map((job) => String(job?.status ?? '').toLowerCase())
  if (statuses.length === 0) return null
  if (statuses.some((status) => status === 'failed')) return 'failed'
  if (statuses.some((status) => status === 'nsfw')) return 'nsfw'
  if (statuses.every((status) => status === 'completed')) return 'completed'
  return null
}

/**
 * @param {string} prompt 장면 묘사(움직임 위주로)
 * @param {{ apiKey: string, apiSecret: string, imagePath: string, outPath: string, model?: string }} options
 * @returns {Promise<{ ok: boolean, outPath?: string, error?: string }>}
 */
export async function makeHiggsfieldVideo(prompt, options, onLog) {
  const { apiKey, apiSecret, imagePath, outPath } = options
  if (!apiKey || !apiSecret) {
    return { ok: false, error: '힉스필드 API 키와 시크릿이 필요합니다. 환경설정에서 입력하세요.' }
  }
  const model = options.model ?? process.env.HIGGSFIELD_MOTION_MODEL ?? 'dop-turbo'
  try {
    const imageBuffer = await readFile(imagePath)
    onLog?.(`힉스필드(${model}) 영상 생성 요청 중...`)
    const submitted = await hfFetch(`${apiBase()}/v1/image2video/dop`, apiKey, apiSecret, {
      method: 'POST',
      body: JSON.stringify({
        params: {
          model,
          prompt,
          input_images: [{ type: 'image_url', image_url: imageToDataUrl(imageBuffer, imagePath) }],
        },
      }),
    })
    const jobSetId = submitted.id ?? submitted.job_set_id ?? submitted.jobSet?.id
    if (!jobSetId) return { ok: false, error: `힉스필드 응답에 job-set id가 없습니다: ${JSON.stringify(submitted).slice(0, 200)}` }

    const startTs = Date.now()
    let jobSet = submitted
    for (;;) {
      if (Date.now() - startTs > 10 * 60 * 1000) return { ok: false, error: '힉스필드 생성 시간 초과(10분)' }
      await new Promise((r) => setTimeout(r, 4000))
      jobSet = await hfFetch(`${apiBase()}/v1/job-sets/${jobSetId}`, apiKey, apiSecret)
      const status = jobSetStatus(jobSet)
      if (status === 'completed') break
      if (status === 'failed') return { ok: false, error: `힉스필드 생성 실패: ${JSON.stringify(jobSet).slice(0, 200)}` }
      if (status === 'nsfw') return { ok: false, error: '힉스필드가 콘텐츠를 거부했습니다(NSFW 판정). 다른 이미지로 시도하세요.' }
      onLog?.(`힉스필드 생성 중... (${Math.round((Date.now() - startTs) / 1000)}초 경과)`)
    }

    const videoUrl = findVideoUrl(jobSet)
    if (!videoUrl) return { ok: false, error: '힉스필드 응답에 영상 URL이 없습니다.' }
    const videoResponse = await fetch(videoUrl)
    if (!videoResponse.ok) return { ok: false, error: `영상 다운로드 실패(${videoResponse.status})` }
    await writeFile(outPath, Buffer.from(await videoResponse.arrayBuffer()))
    onLog?.('힉스필드 영상 저장 완료')
    return { ok: true, outPath }
  } catch (error) {
    return { ok: false, error: error.message }
  }
}
