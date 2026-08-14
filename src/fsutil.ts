import { promises as fsp, constants as fsConstants } from 'node:fs'
import path from 'node:path'
import type { Config } from './config.js'

export interface ScannedFile {
  /** Absolute path. */
  full: string
  /** Path relative to the configured root. */
  rel: string
  /** File size in bytes. */
  size: number
  /** Lower-cased extension without the dot, or '' for none. */
  ext: string
}

export interface ScanResult {
  files: ScannedFile[]
  dirs: string[]
  /** Absolute, verified root actually used for the walk. */
  root: string
  /** Total bytes of scanned files. */
  totalBytes: number
}

/** Resolve `rel` against `root` and assert the result stays inside `root`. */
export function resolveWithin(root: string, rel: string): string {
  const resolved = path.resolve(root, rel)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`path "${rel}" escapes the configured root "${root}"`)
  }
  return resolved
}

/** True when a name should be skipped according to the exclude list. */
export function shouldSkip(name: string, config: Config): boolean {
  return config.exclude.includes(name) || config.exclude.includes(name.toLowerCase())
}

/**
 * Depth-limited walk over the configured root. Directory entries that match
 * the exclude list (by name) are pruned entirely; oversized files are skipped.
 */
export async function walk(root: string, config: Config): Promise<ScanResult> {
  const resolvedRoot = path.resolve(root)
  const files: ScannedFile[] = []
  const dirs: string[] = []
  let totalBytes = 0

  async function visit(dir: string, rel: string, depth: number): Promise<void> {
    if (depth > config.maxDepth) return
    if (files.length >= config.maxFiles) return
    let entries
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return // unreadable directory: skip silently
    }
    for (const entry of entries) {
      if (files.length >= config.maxFiles) break
      if (shouldSkip(entry.name, config)) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        dirs.push(path.relative(resolvedRoot, full).split(path.sep).join('/'))
        await visit(full, rel + '/' + entry.name, depth + 1)
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        let stat
        try {
          stat = await fsp.stat(full)
        } catch {
          continue // broken link or unreadable
        }
        if (!stat.isFile()) continue
        if (stat.size > config.maxFileBytes) continue
        const relPath = path.relative(resolvedRoot, full).split(path.sep).join('/')
        files.push({
          full,
          rel: relPath,
          size: stat.size,
          ext: path.extname(entry.name).slice(1).toLowerCase(),
        })
        totalBytes += stat.size
      }
    }
  }

  await visit(resolvedRoot, '', 0)
  return { files, dirs, root: resolvedRoot, totalBytes }
}

/** Cheap existence probe used to canonicalize local import specifiers. */
export async function exists(p: string): Promise<boolean> {
  try {
    await fsp.access(p, fsConstants.F_OK)
    return true
  } catch {
    return false
  }
}