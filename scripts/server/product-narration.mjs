/** 상품 정보만으로 짧고 명확한 쇼핑쇼츠 나레이션 대본을 만든다. */
export function buildProductNarrationText(input) {
  const productName = String(input?.productName ?? '').trim() || '이 제품'
  const painPoint = String(input?.painPoint ?? '').trim()
  const benefit = String(input?.benefit ?? '').trim()
  const hook = painPoint
    ? `${painPoint}, 아직도 그대로 두고 계신가요?`
    : `일상에서 은근히 불편했던 순간, 있으셨죠?`
  const introduction = `그럴 때 눈여겨볼 제품이 바로 ${productName}입니다.`
  const value = benefit
    ? `${benefit}, 직접 써보면 차이가 더 확실하게 느껴집니다.`
    : `간편하게 쓰기 좋고 일상의 번거로움을 줄이는 데 도움이 됩니다.`
  const cta = `자세한 정보와 조건은 프로필 링크에서 지금 확인해 보세요.`
  return [hook, introduction, value, cta].join(' ')
}
