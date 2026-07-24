import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  discoverProductSources,
  MockSourceSearchProvider,
  YouTubeSearchProvider,
} from '../../sources/sourceDiscovery.js'
import { logger } from '../../utils/logger.js'

interface DiscoverSourcesOptions {
  productName?: string
  query?: string[]
  maxResults?: string
  provider?: string
  outDir?: string
}

function requireOption(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new Error(`${label} is required.`)
  return value
}

function parseMaxResults(value: string | undefined): number {
  const parsed = Number(value ?? 5)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new Error('--max-results must be an integer from 1 to 50.')
  }
  return parsed
}

function createProvider(options: DiscoverSourcesOptions) {
  const provider = options.provider ?? 'youtube'
  if (provider === 'mock') return new MockSourceSearchProvider()
  if (provider === 'youtube') {
    return new YouTubeSearchProvider({
      apiKey: process.env.YOUTUBE_API_KEY ?? '',
      regionCode: 'KR',
      relevanceLanguage: 'ko',
    })
  }
  throw new Error(`Unknown discovery provider: ${provider}`)
}

export async function runDiscoverSources(options: DiscoverSourcesOptions): Promise<number> {
  logger.step('Discovering product reference sources')

  try {
    const productName = requireOption(options.productName, '--product-name')
    const provider = createProvider(options)
    const outDir = resolve(options.outDir ?? join('tmp', 'source-discovery'))
    const discovered = await discoverProductSources({
      productName,
      queries: options.query,
      maxResultsPerQuery: parseMaxResults(options.maxResults),
      provider,
    })

    await mkdir(outDir, { recursive: true })
    const reportPath = join(outDir, 'source_discovery.json')
    const boardPath = join(outDir, 'source_board.json')
    const tracePath = join(outDir, 'source_traceability.json')
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          productName,
          provider: provider.name,
          count: discovered.length,
          items: discovered,
        },
        null,
        2,
      ),
      'utf8',
    )
    await writeFile(
      boardPath,
      JSON.stringify(
        {
          productName,
          sources: discovered.map((item) => item.source),
        },
        null,
        2,
      ),
      'utf8',
    )
    await writeFile(
      tracePath,
      JSON.stringify(
        discovered.map((item) => item.trace),
        null,
        2,
      ),
      'utf8',
    )

    logger.success(`Discovery report: ${reportPath}`)
    logger.success(`Source board: ${boardPath}`)
    logger.dim(`  provider: ${provider.name}`)
    logger.dim(`  reference-only results: ${discovered.length}`)
    return 0
  } catch (err) {
    logger.error(`Source discovery failed: ${(err as Error).message}`)
    return 1
  }
}
