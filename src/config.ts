import z from '@deepseek-ai/schemastery'

/** Plugin configuration for dsh-repo-analyzer. */
export interface Config {
  /** Repository root relative to the calling agent's cwd. */
  root: string
  /** Maximum directory depth to walk. */
  maxDepth: number
  /** Hard cap on scanned files per analysis. */
  maxFiles: number
  /** Files larger than this (bytes) are skipped. */
  maxFileBytes: number
  /** Directory/file names skipped during the walk. */
  exclude: string[]
}

export const Config: z<Config> = z.object({
  root: z.string().default('.').description('Repository root relative to the calling agent\'s cwd.'),
  maxDepth: z.number().default(4).min(1).max(20).description('Maximum directory depth to walk.'),
  maxFiles: z.number().default(20000).min(100).description('Hard cap on scanned files per analysis.'),
  maxFileBytes: z.number().default(1048576).min(1024).description('Files larger than this (bytes) are skipped.'),
  exclude: z.array(z.string()).default([
    'node_modules', '.git', 'dist', 'build', 'out', 'coverage', '.next', '.nuxt',
    '.venv', 'venv', '__pycache__', 'target', '.idea', '.vscode', '.DS_Store', 'lib',
  ]).description('Directory/file names skipped during the walk.'),
})