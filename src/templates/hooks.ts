import type { Product } from '../config/schema.js'

export const HOOK_TEMPLATES = [
  '좁은 {공간} 때문에 불편했다면 이 장면부터 보세요',
  '{문제상황} 해결 전후를 15초 안에 보여드립니다',
  '처음엔 별거 아닌 줄 알았는데 써보면 바로 이해됩니다',
  '{상품명} 하나로 {문제상황}이 이렇게 달라집니다',
  '살림 동선 줄이고 싶다면 이 포인트만 확인하세요',
] as const

export interface HookReview {
  duplicates: string[]
  tooLong: string[]
}

export function fillHook(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([^}]+)\}/g, (_, key: string) => vars[key] ?? `{${key}}`)
}

export function buildHooks(product: Product, count: number): string[] {
  const space = product.category.split(/\s+/)[0] ?? product.category
  const vars: Record<string, string> = {
    공간: space,
    문제상황: product.painPoint,
    상품명: product.name,
  }
  const filled = HOOK_TEMPLATES.map((template) => fillHook(template, vars))
  return Array.from({ length: count }, (_, index) => filled[index % filled.length] as string)
}

export function reviewHooks(hooks: string[], maxChars = 72): HookReview {
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  const tooLong: string[] = []

  for (const hook of hooks) {
    if (seen.has(hook)) duplicates.add(hook)
    seen.add(hook)
    if ([...hook].length > maxChars) tooLong.push(hook)
  }

  return {
    duplicates: [...duplicates],
    tooLong,
  }
}
