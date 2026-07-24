/**
 * 쿠팡 전부-AI 쇼핑쇼츠 — 비전(이미지 입력) 요청 본문 조립용 순수 함수 모음.
 * 부수효과 금지: 파일·네트워크 접근은 local-server가 담당하고 여기서는 데이터만 만든다.
 * images: [{ base64, mimeType }]
 */

export function openaiVisionContent(prompt, images) {
  return [
    { type: 'text', text: prompt },
    ...images.map((image) => ({
      type: 'image_url',
      image_url: { url: `data:${image.mimeType};base64,${image.base64}` },
    })),
  ]
}

export function geminiVisionParts(prompt, images) {
  return [
    { text: prompt },
    ...images.map((image) => ({
      inline_data: { mime_type: image.mimeType, data: image.base64 },
    })),
  ]
}

export function claudeVisionContent(prompt, images) {
  return [
    { type: 'text', text: prompt },
    ...images.map((image) => ({
      type: 'image',
      source: { type: 'base64', media_type: image.mimeType, data: image.base64 },
    })),
  ]
}

/** 파일 확장자로 캡처 이미지의 MIME 타입을 정한다. */
export function captureMimeType(fileName) {
  const ext = String(fileName ?? '').toLowerCase().split('.').pop() ?? ''
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  return 'image/png'
}
