import { writeFile } from 'node:fs/promises'

export interface ZipEntry {
  path: string
  data: Buffer | string
}

interface PreparedEntry {
  path: string
  name: Buffer
  data: Buffer
  crc: number
  offset: number
  local: Buffer
}

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  }
  CRC_TABLE[n] = c >>> 0
}

export function crc32(data: Buffer): number {
  let c = 0xffffffff
  for (const byte of data) {
    c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8)
  }
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear())
  const time =
    (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate()
  return { time, date: dosDate }
}

function normalizeZipPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function localHeader(entry: ZipEntry, modifiedAt: Date): PreparedEntry {
  const path = normalizeZipPath(entry.path)
  const name = Buffer.from(path, 'utf8')
  const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8')
  const crc = crc32(data)
  const stamp = dosDateTime(modifiedAt)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(0x0800, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(stamp.time, 10)
  header.writeUInt16LE(stamp.date, 12)
  header.writeUInt32LE(crc, 14)
  header.writeUInt32LE(data.length, 18)
  header.writeUInt32LE(data.length, 22)
  header.writeUInt16LE(name.length, 26)
  header.writeUInt16LE(0, 28)
  return { path, name, data, crc, offset: 0, local: Buffer.concat([header, name, data]) }
}

function centralHeader(entry: PreparedEntry, modifiedAt: Date): Buffer {
  const stamp = dosDateTime(modifiedAt)
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE(20, 4)
  header.writeUInt16LE(20, 6)
  header.writeUInt16LE(0x0800, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(stamp.time, 12)
  header.writeUInt16LE(stamp.date, 14)
  header.writeUInt32LE(entry.crc, 16)
  header.writeUInt32LE(entry.data.length, 20)
  header.writeUInt32LE(entry.data.length, 24)
  header.writeUInt16LE(entry.name.length, 28)
  header.writeUInt16LE(0, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(0, 38)
  header.writeUInt32LE(entry.offset, 42)
  return Buffer.concat([header, entry.name])
}

export function createZip(entries: ZipEntry[], modifiedAt = new Date()): Buffer {
  let offset = 0
  const prepared = entries.map((entry) => {
    const local = localHeader(entry, modifiedAt)
    local.offset = offset
    offset += local.local.length
    return local
  })

  const central = prepared.map((entry) => centralHeader(entry, modifiedAt))
  const centralOffset = offset
  const centralSize = central.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(prepared.length, 8)
  end.writeUInt16LE(prepared.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(centralOffset, 16)
  end.writeUInt16LE(0, 20)

  return Buffer.concat([...prepared.map((entry) => entry.local), ...central, end])
}

export async function writeZip(
  path: string,
  entries: ZipEntry[],
  modifiedAt = new Date(),
): Promise<void> {
  await writeFile(path, createZip(entries, modifiedAt))
}
