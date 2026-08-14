import path from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Config } from './config.js'
import { resolveWithin, walk, type ScannedFile, type ScanResult } from './fsutil.js'
import {
  buildRefGraph, detectStack, findPackageRefs, languageStats, readManifests,
  type ManifestInfo, type RefEdge, type RefGraph,
} from './analyze.js'

interface ToolRuntime {
  root: string
  config: Config
}

function makeRuntime(config: Config): ToolRuntime {
  const root = path.resolve(process.cwd(), config.root)
  return { root, config }
}

function bytesLabel(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

function renderScan(value: {
  root: string
  stack: Array<{ name: string; evidence: string }>
  counts: { files: number; dirs: number; bytes: number }
  languages: Array<{ ext: string; files: number; bytes: number }>
  topDirs: Array<{ path: string; files: number }>
  manifests: string[]
}): string {
  const lines: string[] = [`Repository: ${value.root}`]
  if (value.stack.length > 0) {
    lines.push(`Stack: ${value.stack.map((s) => s.name).join(', ')}`)
  }
  lines.push(`Files: ${value.counts.files} | Dirs: ${value.counts.dirs} | Size: ${bytesLabel(value.counts.bytes)}`)
  if (value.manifests.length > 0) lines.push(`Manifests: ${value.manifests.join(', ')}`)
  if (value.languages.length > 0) {
    lines.push('')
    lines.push('Languages (by file count):')
    for (const lang of value.languages.slice(0, 12)) {
      lines.push(`  ${lang.ext || '(none)'}: ${lang.files} files, ${bytesLabel(lang.bytes)}`)
    }
  }
  if (value.topDirs.length > 0) {
    lines.push('')
    lines.push('Top-level directories (by file count):')
    for (const dir of value.topDirs.slice(0, 15)) {
      lines.push(`  ${dir.path || '.'}: ${dir.files} files`)
    }
  }
  return lines.join('\n')
}

function renderDeps(value: {
  root: string
  manifests: Array<{ file: string; kind: string; deps: Array<{ name: string; version: string }>; devDeps: Array<{ name: string; version: string }> }>
  totals: { prod: number; dev: number }
  package?: { name: string; declared: Array<{ file: string; version: string; dev: boolean }>; referencedBy: string[] }
}): string {
  const lines: string[] = [`Dependencies for ${value.root}`]
  lines.push(`Total: ${value.totals.prod} prod + ${value.totals.dev} dev`)
  if (value.package) {
    const p = value.package
    lines.push('')
    lines.push(`Package "${p.name}":`)
    if (p.declared.length === 0) lines.push('  not declared in any manifest')
    for (const d of p.declared) lines.push(`  declared in ${d.file} (${d.dev ? 'dev' : 'prod'}) ${d.version}`)
    lines.push(`  referenced by ${p.referencedBy.length} source file(s)`)
    for (const file of p.referencedBy.slice(0, 20)) lines.push(`    ${file}`)
    if (p.referencedBy.length > 20) lines.push(`    ... and ${p.referencedBy.length - 20} more`)
    return lines.join('\n')
  }
  for (const manifest of value.manifests) {
    lines.push('')
    lines.push(`${manifest.file} (${manifest.kind}): ${manifest.deps.length} prod + ${manifest.devDeps.length} dev`)
    const preview = manifest.deps.slice(0, 30).map((d) => `${d.name}@${d.version}`).join(', ')
    if (preview) lines.push(`  ${preview}`)
    if (manifest.deps.length > 30) lines.push(`  ... and ${manifest.deps.length - 30} more`)
  }
  return lines.join('\n')
}

function renderRefs(value: RefGraph & { root: string }): string {
  const lines: string[] = [
    `Module reference graph for ${value.root}`,
    `Source files: ${value.stats.files} | Directory edges: ${value.stats.edges}`,
  ]
  if (value.hotModules.length > 0) {
    lines.push('')
    lines.push('Most-referenced local modules (architecture hot spots):')
    for (const mod of value.hotModules) {
      lines.push(`  ${mod.path} <- ${mod.referencedBy} refs`)
    }
  }
  if (value.edges.length > 0) {
    lines.push('')
    lines.push('Top cross-directory dependencies:')
    for (const edge of value.edges) {
      lines.push(`  ${edge.from || '.'} -> ${edge.to} (${edge.count})`)
    }
  }
  return lines.join('\n')
}

export function registerTools(ctx: Context, config: Config): void {
  ctx.tools.register(defineTool({
    name: 'repo_scan',
    description:
      'Scan the repository: detect the technology stack from manifests, count files by extension, ' +
      'and summarize top-level directory sizes. Use before deeper analysis tools.',
    parameters: {
      path: { type: 'string', description: 'Subdirectory (relative to the configured root) to scan; defaults to the root.' },
      depth: { type: 'number', description: 'Override the configured walk depth.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          stack: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                evidence: { type: 'string', required: true },
              },
            },
          },
          counts: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              files: { type: 'number', required: true },
              dirs: { type: 'number', required: true },
              bytes: { type: 'number', required: true },
            },
          },
          languages: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                ext: { type: 'string', required: true },
                files: { type: 'number', required: true },
                bytes: { type: 'number', required: true },
              },
            },
          },
          topDirs: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                files: { type: 'number', required: true },
              },
            },
          },
          manifests: { type: 'array', required: true, items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderScan(value as never) }],
    },
    async execute(args, _exec) {
      const rt = makeRuntime(config)
      const scanRoot = args.path ? resolveWithin(rt.root, args.path) : rt.root
      const walkConfig = args.depth ? { ...rt.config, maxDepth: args.depth } : rt.config
      const scan: ScanResult = await walk(scanRoot, walkConfig)
      const stack = detectStack(scan.files)
      const languages = languageStats(scan.files)
      const dirCount = new Map<string, number>()
      for (const file of scan.files) {
        const parts = file.rel.split('/')
        const top = parts.length > 1 ? parts[0] : '.'
        dirCount.set(top, (dirCount.get(top) ?? 0) + 1)
      }
      const topDirs = [...dirCount.entries()]
        .map(([dir, files]) => ({ path: dir, files }))
        .sort((a, b) => b.files - a.files)
      const manifests = [...new Set(scan.files
        .filter((f) => ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'requirements.txt', 'tsconfig.json'].includes(path.basename(f.full)))
        .map((f) => f.rel))]
        .sort()
      return {
        root: scanRoot,
        stack,
        counts: { files: scan.files.length, dirs: scan.dirs.length, bytes: scan.totalBytes },
        languages,
        topDirs,
        manifests,
      }
    },
  }))

  ctx.tools.register(defineTool({
    name: 'repo_deps',
    description:
      'List dependency manifests (package.json / pyproject.toml / go.mod / Cargo.toml) with their declared packages. ' +
      'Pass `package` to inspect one dependency: where it is declared and which source files import it (impact surface).',
    parameters: {
      package: { type: 'string', description: 'Package name to inspect (declaration + referencing files).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          totals: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              prod: { type: 'number', required: true },
              dev: { type: 'number', required: true },
            },
          },
          manifests: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                file: { type: 'string', required: true },
                kind: { type: 'string', required: true },
                deps: {
                  type: 'array', required: true,
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      name: { type: 'string', required: true },
                      version: { type: 'string', required: true },
                    },
                  },
                },
                devDeps: {
                  type: 'array', required: true,
                  items: {
                    type: 'object', additionalProperties: false,
                    properties: {
                      name: { type: 'string', required: true },
                      version: { type: 'string', required: true },
                    },
                  },
                },
              },
            },
          },
          package: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', required: true },
              declared: {
                type: 'array', required: true,
                items: {
                  type: 'object', additionalProperties: false,
                  properties: {
                    file: { type: 'string', required: true },
                    version: { type: 'string', required: true },
                    dev: { type: 'boolean', required: true },
                  },
                },
              },
              referencedBy: { type: 'array', required: true, items: { type: 'string' } },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderDeps(value as never) }],
    },
    async execute(args, _exec) {
      const rt = makeRuntime(config)
      const manifests: ManifestInfo[] = await readManifests(rt.root, await allFiles(rt))
      const totals = { prod: 0, dev: 0 }
      for (const manifest of manifests) {
        totals.prod += manifest.deps.length
        totals.dev += manifest.devDeps.length
      }
      const result: {
        root: string
        totals: { prod: number; dev: number }
        manifests: Array<{ file: string; kind: string; deps: Array<{ name: string; version: string }>; devDeps: Array<{ name: string; version: string }> }>
        package?: { name: string; declared: Array<{ file: string; version: string; dev: boolean }>; referencedBy: string[] }
      } = {
        root: rt.root,
        totals,
        manifests: manifests.map((m) => ({ file: m.file, kind: m.kind, deps: m.deps, devDeps: m.devDeps })),
      }
      if (args.package) {
        const declared: Array<{ file: string; version: string; dev: boolean }> = []
        for (const manifest of manifests) {
          for (const dep of manifest.deps) {
            if (dep.name === args.package) declared.push({ file: manifest.file, version: dep.version, dev: false })
          }
          for (const dep of manifest.devDeps) {
            if (dep.name === args.package) declared.push({ file: manifest.file, version: dep.version, dev: true })
          }
        }
        const files = await allFiles(rt)
        const referencedBy = await findPackageRefs(rt.root, files, args.package, rt.config)
        result.package = { name: args.package, declared, referencedBy }
      }
      return result
    },
  }))

  ctx.tools.register(defineTool({
    name: 'repo_refs',
    description:
      'Analyze local module references: which local files import each other (heuristic regex over TS/JS/Python sources). ' +
      'Returns the most-referenced modules (architecture hot spots) and top cross-directory dependency edges.',
    parameters: {
      maxEdges: { type: 'number', description: 'Maximum directory edges to return (default 20).' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          root: { type: 'string', required: true },
          stats: {
            type: 'object', required: true, additionalProperties: false,
            properties: {
              files: { type: 'number', required: true },
              edges: { type: 'number', required: true },
            },
          },
          hotModules: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                path: { type: 'string', required: true },
                referencedBy: { type: 'number', required: true },
              },
            },
          },
          edges: {
            type: 'array', required: true,
            items: {
              type: 'object', additionalProperties: false,
              properties: {
                from: { type: 'string', required: true },
                to: { type: 'string', required: true },
                count: { type: 'number', required: true },
              },
            },
          },
        },
      },
      render: (_args, value) => [{ type: 'text', text: renderRefs(value as never) }],
    },
    async execute(args, _exec) {
      const rt = makeRuntime(config)
      const files = await allFiles(rt)
      const graph: RefGraph = await buildRefGraph(rt.root, files, rt.config, args.maxEdges ?? 20)
      return { root: rt.root, ...graph }
    },
  }))
}

/** Walk the configured root once and return the file list (shared by tools). */
async function allFiles(rt: ToolRuntime): Promise<ScannedFile[]> {
  const scan = await walk(rt.root, rt.config)
  return scan.files
}