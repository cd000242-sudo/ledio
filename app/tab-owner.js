/**
 * 탭 화면의 '주인'을 표시한다.
 *
 * 탭 내용은 모두 같은 DOM 자리(#tabContent)에 그려진다. 그래서 어떤 탭에서 보낸 요청의
 * 응답이 늦게 돌아오면, 사용자가 이미 다른 탭으로 옮겼는데도 그 자리에 자기 화면을
 * 덮어써 버린다(자동 편집 중에 자막 화면이 튀어나오는 사고로 확인).
 *
 * 그래서 그리기 직전에 "지금 이 자리 주인이 나인가"를 확인한다.
 */

/** 이 자리를 이 탭이 쓴다고 표시한다. 탭을 바꿀 때마다 부른다. */
export function claimTab(container, tabId) {
  if (container && container.dataset) container.dataset.tabOwner = tabId
}

/** 지금 이 자리의 주인이 이 탭인지. 아니면 그리지 않는다. */
export function ownsTab(container, tabId) {
  return Boolean(container && container.dataset && container.dataset.tabOwner === tabId)
}
