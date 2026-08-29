/* global URL */
/**
 * 화면 어디서나 쓰는 순수 헬퍼 — 문자열·숫자·태그·파일명 다루기.
 *
 * app.js에서 그대로 옮겨온 것이라 동작은 같다.
 * 상태(state)나 DOM을 건드리지 않아 테스트가 쉽고, 다른 탭에서도 안심하고 쓸 수 있다.
 */

export function clean(value) {
  return String(value ?? '').trim();
}

export function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function intValue(value, fallback = 1) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function unique(values) {
  return Array.from(new Set(values));
}

export function isValidUrl(value) {
  try {
    const url = new URL(clean(value));
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function parseTags(value) {
  if (Array.isArray(value)) return value.map((tag) => clean(tag).replace(/^#/, '')).filter(Boolean);
  return String(value ?? '')
    .split(/[,\s]+/)
    .map((tag) => clean(tag).replace(/^#/, ''))
    .filter(Boolean);
}

export function formatTags(tags) {
  return parseTags(tags)
    .map((tag) => `#${tag}`)
    .join(' ');
}

export function trimLine(value, maxLength) {
  const text = clean(value).replace(/\s+/g, ' ');
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(0, maxLength - 1)).trim()}…`;
}

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function safeFileName(value, fallback = 'media') {
  const withoutControlChars = Array.from(String(value ?? '')).filter((char) => {
    const code = char.codePointAt(0) ?? 0;
    return code >= 32 && code !== 127;
  });
  const cleaned = withoutControlChars
    .join('')
    .replace(/[<>:"/\\|?*]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.replace(/^\.+/, '').slice(0, 120) || fallback;
}
