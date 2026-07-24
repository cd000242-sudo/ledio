import { describe, expect, it } from 'vitest'
import {
  discoverProductSources,
  MockSourceSearchProvider,
  scoreSourceItem,
  YouTubeSearchProvider,
} from './sourceDiscovery.js'

describe('source discovery', () => {
  it('calls YouTube search.list with video snippet parameters', async () => {
    const requested: string[] = []
    const provider = new YouTubeSearchProvider({
      apiKey: 'test-key',
      fetchImpl: async (url) => {
        requested.push(url)
        return {
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              items: [
                {
                  id: { videoId: 'abc123' },
                  snippet: {
                    title: 'Folding shelf review',
                    description: 'review result',
                    channelTitle: 'Review Lab',
                    publishedAt: '2026-06-23T00:00:00Z',
                  },
                },
              ],
            }),
        }
      },
      regionCode: 'KR',
      relevanceLanguage: 'ko',
    })

    const items = await provider.search('folding shelf review', 7)
    const url = new URL(requested[0] as string)

    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/youtube/v3/search')
    expect(url.searchParams.get('part')).toBe('snippet')
    expect(url.searchParams.get('type')).toBe('video')
    expect(url.searchParams.get('maxResults')).toBe('7')
    expect(url.searchParams.get('safeSearch')).toBe('moderate')
    expect(url.searchParams.get('key')).toBe('test-key')
    expect(items[0]?.url).toBe('https://www.youtube.com/watch?v=abc123')
  })

  it('keeps discovered videos as reference-only sources', async () => {
    const discovered = await discoverProductSources({
      productName: 'folding shelf',
      queries: ['folding shelf review'],
      maxResultsPerQuery: 2,
      provider: new MockSourceSearchProvider(),
    })

    expect(discovered).toHaveLength(2)
    expect(discovered[0]?.source.rights).toBe('reference_only')
    expect(discovered[0]?.source.usage).toBe('reference')
    expect(discovered[0]?.trace.level).toBe('safe')
    expect(discovered[0]?.source.notes).toContain('Do not use as edit footage')
  })

  it('scores title and intent matches higher', () => {
    const high = scoreSourceItem('folding shelf', {
      title: 'Folding shelf review result',
      url: 'https://example.com/1',
      description: 'price discount recommend result',
    })
    const low = scoreSourceItem('folding shelf', {
      title: 'random desk vlog',
      url: 'https://example.com/2',
      description: 'daily routine',
    })

    expect(high).toBeGreaterThan(low)
  })
})
