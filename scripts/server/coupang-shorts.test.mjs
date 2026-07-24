import { describe, expect, it } from 'vitest'
import {
  captureMimeType,
  claudeVisionContent,
  geminiVisionParts,
  openaiVisionContent,
} from './coupang-shorts.mjs'

const images = [{ base64: 'QUJD', mimeType: 'image/png' }]

describe('vision request bodies', () => {
  it('OpenAI: text + image_url(data URL) 배열', () => {
    const content = openaiVisionContent('분석해줘', images)
    expect(content[0]).toEqual({ type: 'text', text: '분석해줘' })
    expect(content[1]).toEqual({
      type: 'image_url',
      image_url: { url: 'data:image/png;base64,QUJD' },
    })
  })

  it('Gemini: text + inline_data 파트', () => {
    const parts = geminiVisionParts('분석해줘', images)
    expect(parts[0]).toEqual({ text: '분석해줘' })
    expect(parts[1]).toEqual({ inline_data: { mime_type: 'image/png', data: 'QUJD' } })
  })

  it('Claude: text + base64 source 이미지', () => {
    const content = claudeVisionContent('분석해줘', images)
    expect(content[0]).toEqual({ type: 'text', text: '분석해줘' })
    expect(content[1]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'QUJD' },
    })
  })
})

describe('captureMimeType', () => {
  it('확장자별 MIME 타입을 돌려준다', () => {
    expect(captureMimeType('a.jpg')).toBe('image/jpeg')
    expect(captureMimeType('b.PNG')).toBe('image/png')
    expect(captureMimeType('c.webp')).toBe('image/webp')
    expect(captureMimeType('없음')).toBe('image/png')
  })
})
