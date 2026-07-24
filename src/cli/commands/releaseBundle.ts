import { resolve } from 'node:path'
import { buildReleaseBundle } from '../../release/bundle.js'
import { logger } from '../../utils/logger.js'

interface ReleaseBundleOptions {
  outDir?: string
}

export async function runReleaseBundle(options: ReleaseBundleOptions = {}): Promise<number> {
  logger.step('Building release bundle')

  try {
    const result = await buildReleaseBundle({
      rootDir: process.cwd(),
      releaseDir: options.outDir ? resolve(options.outDir) : undefined,
    })
    logger.success(`Release folder: ${result.bundleDir}`)
    logger.success(`Release ZIP: ${result.zipPath}`)
    logger.dim(`  files: ${result.files.length}`)
    logger.dim(`  app: ${result.manifest.entrypoint}`)
    return 0
  } catch (err) {
    logger.error(`Release bundle failed: ${(err as Error).message}`)
    return 1
  }
}
