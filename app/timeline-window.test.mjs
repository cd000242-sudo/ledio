import { describe, expect, it } from 'vitest'
import { clampWindow, fitAround, fromRatio, toRatio, zoomAround } from './timeline-window.js'

const win = (offset, span) => ({ offset, span })

describe('보이는 구간 다루기', () => {
  it('시간을 화면 비율로, 비율을 다시 시간으로 바꾼다', () => {
    const view = win(60, 30)
    expect(toRatio(view, 75)).toBeCloseTo(0.5, 5)
    expect(fromRatio(view, 0.5)).toBeCloseTo(75, 5)
  })

  it('화면 밖 시간은 0 미만이나 1 초과로 나온다 — 그릴지 말지 판단에 쓴다', () => {
    expect(toRatio(win(60, 30), 50)).toBeLessThan(0)
    expect(toRatio(win(60, 30), 100)).toBeGreaterThan(1)
  })
})

describe('경계 붙잡기', () => {
  it('영상 밖으로 나가지 않는다', () => {
    expect(clampWindow(win(-10, 30), 100)).toEqual(win(0, 30))
    expect(clampWindow(win(90, 30), 100)).toEqual(win(70, 30))
  })

  it('전체보다 넓게 벌어지지 않는다', () => {
    expect(clampWindow(win(0, 500), 100)).toEqual(win(0, 100))
  })
})

describe('가리킨 지점 기준 확대', () => {
  it('마우스가 가리킨 시간이 제자리에 남는다 — 화면 가운데가 아니라', () => {
    const before = win(0, 100)
    const anchor = 0.25 // 25초 지점
    const after = zoomAround(before, anchor, 2, 100)
    expect(after.span).toBeCloseTo(50, 5)
    expect(fromRatio(after, anchor)).toBeCloseTo(25, 5)
  })

  it('너무 잘게 확대하지 않는다 — 0.5초 아래로는 안 내려간다', () => {
    let view = win(0, 100)
    for (let i = 0; i < 20; i += 1) view = zoomAround(view, 0.5, 2, 100)
    expect(view.span).toBeGreaterThanOrEqual(0.5)
  })

  it('축소해도 전체를 넘지 않는다', () => {
    expect(zoomAround(win(20, 10), 0.5, 0.01, 100)).toEqual(win(0, 100))
  })
})

describe('고른 구간에 맞추기', () => {
  it('고른 구간이 화면의 3분의 1쯤 차지하게 맞춘다 — 바로 끌어 조절할 수 있게', () => {
    const view = fitAround({ startMs: 20000, endMs: 21000 }, 600)
    expect(view.span).toBeGreaterThan(1)
    expect(view.span).toBeLessThan(10)
    const middle = fromRatio(view, 0.5)
    expect(middle).toBeCloseTo(20.5, 1)
  })

  it('아주 짧은 구간도 볼 만한 넓이를 준다', () => {
    expect(fitAround({ startMs: 1000, endMs: 1100 }, 600).span).toBeGreaterThanOrEqual(2)
  })
})
