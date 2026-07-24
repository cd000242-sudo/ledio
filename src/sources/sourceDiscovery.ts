import type { Source } from '../config/schema.js'
import { presetSource, traceSource, type SourceTrace } from './sourceBoard.js'

export interface SourceSearchItem {
  title: string
  url: string
  channelTitle?: string
  publishedAt?: string
  description?: string
}

export interface SourceSearchProvider {
  name: string
  search(query: string, maxResults: number): Promise<SourceSearchItem[]>
}

export interface DiscoveredSource {
  query: string
  score: number
  item: SourceSearchItem
  source: Source
  trace: SourceTrace
}

export interface DiscoverProductSourcesOptions {
  productName: string
  queries?: string[]
  maxResultsPerQuery?: number
  provider: SourceSearchProvider
}

interface FetchResponseLike {
  ok: boolean
  status: number
  text(): Promise<string>
}

type FetchLike = (url: string) => Promise<FetchResponseLike>

interface YouTubeSearchItem {
  id?: { videoId?: string }
  snippet?: {
    title?: string
    description?: string
    channelTitle?: string
    publishedAt?: string
  }
}

interface YouTubeSearchResponse {
  items?: YouTubeSearchItem[]
}

export interface YouTubeSearchProviderOptions {
  apiKey: string
  fetchImpl?: FetchLike
  regionCode?: string
  relevanceLanguage?: string
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s]+/gu, ' ')
}

function unique<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const id = key(item)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(item)
  }
  return out
}

export function defaultDiscoveryQueries(productName: string): string[] {
  const clean = productName.trim()
  return [
    `${clean} review`,
    `${clean} unboxing`,
    `${clean} shorts`,
    `${clean} use result`,
    `${clean} 후기`,
  ]
}

export function scoreSourceItem(productName: string, item: SourceSearchItem): number {
  const productTerms = normalize(productName)
    .split(/\s+/)
    .filter((term) => term.length >= 2)
  const haystack = normalize(`${item.title} ${item.description ?? ''} ${item.channelTitle ?? ''}`)
  const productHits = productTerms.filter((term) => haystack.includes(term)).length
  const intentHits = ['review', 'unboxing', 'shorts', 'result', '후기', '리뷰', '사용', '추천'].filter((term) =>
    haystack.includes(term),
  ).length
  return productHits * 20 + intentHits * 8 + Math.min(10, (item.description ?? '').length / 40)
}

function itemToSource(item: SourceSearchItem, query: string): Source {
  return {
    ...presetSource('reference_short', item.title, item.url),
    notes: [
      'Discovery result for structure/reference only. Do not use as edit footage unless rights are separately cleared.',
      `query: ${query}`,
      item.channelTitle ? `channel: ${item.channelTitle}` : '',
      item.publishedAt ? `publishedAt: ${item.publishedAt}` : '',
    ]
      .filter(Boolean)
      .join(' | '),
  }
}

export async function discoverProductSources(
  options: DiscoverProductSourcesOptions,
): Promise<DiscoveredSource[]> {
  const queries = options.queries?.length ? options.queries : defaultDiscoveryQueries(options.productName)
  const maxResultsPerQuery = options.maxResultsPerQuery ?? 5
  const discovered: DiscoveredSource[] = []

  for (const query of queries) {
    const items = await options.provider.search(query, maxResultsPerQuery)
    for (const item of items) {
      const source = itemToSource(item, query)
      discovered.push({
        query,
        score: scoreSourceItem(options.productName, item),
        item,
        source,
        trace: traceSource(source),
      })
    }
  }

  return unique(discovered, (item) => item.item.url).sort((a, b) => b.score - a.score)
}

export class YouTubeSearchProvider implements SourceSearchProvider {
  readonly name = 'youtube'
  readonly #apiKey: string
  readonly #fetchImpl: FetchLike
  readonly #regionCode: string | undefined
  readonly #relevanceLanguage: string | undefined

  constructor(options: YouTubeSearchProviderOptions) {
    if (!options.apiKey.trim()) throw new Error('YOUTUBE_API_KEY is required for YouTube discovery.')
    this.#apiKey = options.apiKey
    this.#fetchImpl = options.fetchImpl ?? fetch
    this.#regionCode = options.regionCode
    this.#relevanceLanguage = options.relevanceLanguage
  }

  async search(query: string, maxResults: number): Promise<SourceSearchItem[]> {
    const url = new URL('https://www.googleapis.com/youtube/v3/search')
    url.searchParams.set('part', 'snippet')
    url.searchParams.set('type', 'video')
    url.searchParams.set('q', query)
    url.searchParams.set('maxResults', String(Math.min(50, Math.max(1, maxResults))))
    url.searchParams.set('safeSearch', 'moderate')
    url.searchParams.set('key', this.#apiKey)
    if (this.#regionCode) url.searchParams.set('regionCode', this.#regionCode)
    if (this.#relevanceLanguage) url.searchParams.set('relevanceLanguage', this.#relevanceLanguage)

    const response = await this.#fetchImpl(url.toString())
    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`YouTube discovery failed (${response.status}): ${raw.slice(0, 800)}`)
    }
    const data = JSON.parse(raw) as YouTubeSearchResponse
    return (data.items ?? [])
      .filter((item) => item.id?.videoId && item.snippet?.title)
      .map((item) => ({
        title: item.snippet?.title ?? '',
        url: `https://www.youtube.com/watch?v=${item.id?.videoId}`,
        channelTitle: item.snippet?.channelTitle,
        publishedAt: item.snippet?.publishedAt,
        description: item.snippet?.description,
      }))
  }
}

export class MockSourceSearchProvider implements SourceSearchProvider {
  readonly name = 'mock'

  async search(query: string, maxResults: number): Promise<SourceSearchItem[]> {
    return Array.from({ length: Math.min(3, maxResults) }, (_, index) => ({
      title: `${query} reference ${index + 1}`,
      url: `https://www.youtube.com/watch?v=mock-${encodeURIComponent(query)}-${index + 1}`,
      channelTitle: 'Mock Reference Channel',
      publishedAt: '2026-06-23T00:00:00Z',
      description: `Reference-only ${query} review result for source discovery tests.`,
    }))
  }
}
