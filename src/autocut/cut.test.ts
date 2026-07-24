import { describe, it, expect } from 'vitest'
import { buildCutFilter } from './cut.js'

describe('buildCutFilter', () => {
  it('구간마다 trim/atrim + concat 필터를 만든다', () => {
    const f = buildCutFilter([
      { start: 0, end: 3.1 },
      { start: 4.9, end: 8 },
    ])
    expect(f).toContain('[0:v]trim=start=0:end=3.1,setpts=PTS-STARTPTS[v0]')
    expect(f).toContain('[0:a]atrim=start=4.9:end=8,asetpts=PTS-STARTPTS[a1]')
    expect(f).toContain('[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]')
  })

  it('구간 1개도 처리한다', () => {
    const f = buildCutFilter([{ start: 1, end: 2 }])
    expect(f).toContain('concat=n=1:v=1:a=1[v][a]')
  })
})
