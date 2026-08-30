/**
 * 밀리초를 "n분 m초"로 적는다.
 *
 * 초를 먼저 반올림해야 한다. 분과 초를 따로 계산하면 59.6초가 "3분 60초"로 나온다
 * (실제 화면에 나왔던 표기다).
 */
export function durationText(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(total / 60)}분 ${total % 60}초`
}
