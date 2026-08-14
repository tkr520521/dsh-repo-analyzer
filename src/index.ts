import type { Context } from '@deepseek-ai/cordis'
import { registerTools } from './tools.js'
import { Config } from './config.js'

export const name = 'dsh-repo-analyzer'
export const inject = ['tools']

export { Config }
export type { Config as DshRepoAnalyzerConfig } from './config.js'

export function apply(ctx: Context, config: Config): void {
  registerTools(ctx, config)
  ctx.logger?.(name).info(
    'dsh-repo-analyzer loaded: root=%s maxDepth=%d maxFiles=%d',
    config.root,
    config.maxDepth,
    config.maxFiles,
  )
}