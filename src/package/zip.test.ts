import { describe, expect, it } from 'vitest'
import { createZip, crc32 } from './zip.js'

describe('zip', () => {
  it('CRC32를 계산한다', () => {
    expect(crc32(Buffer.from('hello'))).toBe(0x3610a686)
  })

  it('ZIP 로컬 헤더와 중앙 디렉터리를 만든다', () => {
    const zip = createZip(
      [
        { path: 'manifest.json', data: '{"ok":true}' },
        { path: 'platforms/youtube/video.caption.txt', data: 'caption' },
      ],
      new Date('2026-06-23T00:00:00.000Z'),
    )
    expect(zip.readUInt32LE(0)).toBe(0x04034b50)
    expect(zip.includes(Buffer.from('manifest.json'))).toBe(true)
    expect(zip.includes(Buffer.from('platforms/youtube/video.caption.txt'))).toBe(true)
    expect(zip.includes(Buffer.from([0x50, 0x4b, 0x05, 0x06]))).toBe(true)
  })
})
