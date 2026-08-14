import { promises as fsp } from 'node:fs'
import path from 'node:path'
import type { Config } from './config.js'
import { exists, resolveWithin, type ScannedFile, type ScanResult } from './fsutil.js'

/** Languages / frameworks identified by manifest presence. */
const STACK_RULES: Array<{ name: string; markers: string[] }> = [
  { name: 'Node.js', markers: ['package.json', 'pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'] },
  { name: 'TypeScript', markers: ['tsconfig.json'] },
  { name: 'Python', markers: ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'] },
  { name: 'Go', markers: ['go.mod', 'go.sum'] },
  { name: 'Rust', markers: ['Cargo.toml', 'Cargo.lock'] },
  { name: 'Java', markers: ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle'] },
  { name: 'C#/.NET', markers: ['*.csproj', '*.sln'] },
  { name: 'Docker', markers: ['Dockerfile', 'docker-compose.yml', 'compose.yaml'] },
  { name: 'Make', markers: ['Makefile', 'makefile'] },
  { name: 'Ruby', markers: ['Gemfile'] },
  { name: 'PHP', markers: ['composer.json'] },
  { name: 'Swift', markers: ['Package.swift', '*.xcodeproj'] },
]

/** Manifest kinds understood by the dependency parser. */
export interface ManifestDep {
  name: string
  version: string
}

export interface ManifestInfo {
  file: string
  kind: 'package.json' | 'pyproject.toml' | 'go.mod' | 'Cargo.toml'
  deps: ManifestDep[]
  devDeps: ManifestDep[]
}

/** Source extensions scanned for import/require statements. */
const SOURCE_EXTS = new Set(['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py'])

/** ESM + CJS import/require regexes. */
const JS_IMPORT_RE = /import\s+(?:[\w*{},\s]+?\s+from\s+)?['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g
/** Python import/from regexes. */
const PY_IMPORT_RE = /^\s*(?:import|from)\s+([\w.]+)/gm

function manifestOf(name: string): ManifestInfo['kind'] | undefined {
  if (name === 'package.json') return 'package.json'
  if (name === 'pyproject.toml') return 'pyproject.toml'
  if (name === 'go.mod') return 'go.mod'
  if (name === 'Cargo.toml') return 'Cargo.toml'
  return undefined
}

/** Identify the technology stack from the scanned file set. */
export function detectStack(files: ScannedFile[]): Array<{ name: string; evidence: string }> {
  const names = new Set(files.map((f) => path.basename(f.full)))
  const stack: Array<{ name: string; evidence: string }> = []
  for (const rule of STACK_RULES) {
    const marker = rule.markers.find((m) => (m.includes('*') ? files.some((f) => f.rel.endsWith(m.slice(1))) : names.has(m)))
    if (marker) stack.push({ name: rule.name, evidence: marker })
  }
  return stack
}

/** Parse a package.json manifest into a flat dependency list. */
function parsePackageJson(content: string): { deps: ManifestDep[]; devDeps: ManifestDep[] } {
  let json: Record<string, Record<string, string>> = {}
  try {
    json = JSON.parse(content) as Record<string, Record<string, string>>
  } catch {
    return { deps: [], devDeps: [] }
  }
  const toDeps = (obj: unknown): ManifestDep[] =>
    typeof obj === 'object' && obj !== null
      ? Object.entries(obj as Record<string, string>).map(([name, version]) => ({ name, version }))
      : []
  return { deps: toDeps(json.dependencies), devDeps: toDeps(json.devDependencies) }
}

/** Parse a pyproject.toml dependency block (heuristic TOML subset). */
function parsePyproject(content: string): { deps: ManifestDep[]; devDeps: ManifestDep[] } {
  const deps: ManifestDep[] = []
  const devDeps: ManifestDep[] = []
  const sectionRe = /^\[([^\]]+)\]/gm
  let current = 'project'
  for (const line of content.split(/\r?\n/)) {
    const section = sectionRe.exec(line)
    if (section) {
      current = section[1]
      continue
    }
    const m = /^["']?([A-Za-z0-9_.-]+)["']?\s*[=:]\s*["']?([^"'#]+)/.exec(line.trim())
    if (!m) continue
    const [, name, version] = m
    if (current === 'project' || current.includes('dependencies')) deps.push({ name, version: version.trim() })
    if (current.includes('optional-dependencies') || current.includes('dev')) devDeps.push({ name, version: version.trim() })
  }
  return { deps, devDeps }
}

/** Parse a go.mod require block. */
function parseGoMod(content: string): { deps: ManifestDep[]; devDeps: ManifestDep[] } {
  const deps: ManifestDep[] = []
  const devDeps: ManifestDep[] = []
  for (const line of content.split(/\r?\n/)) {
    const m = /^\s*([\w./-]+)\s+(v[\w.+-]+)/.exec(line)
    if (m) {
      if (line.trim().startsWith('require')) deps.push({ name: m[1], version: m[2] })
      else if (line.includes('// indirect')) devDeps.push({ name: m[1], version: m[2] })
      else deps.push({ name: m[1], version: m[2] })
    }
  }
  return { deps, devDeps }
}

/** Parse a Cargo.toml dependency block (heuristic subset). */
function parseCargo(content: string): { deps: ManifestDep[]; devDeps: ManifestDep[] } {
  const deps: ManifestDep[] = []
  const devDeps: ManifestDep[] = []
  let current = 'dependencies'
  for (const line of content.split(/\r?\n/)) {
    const section = /^\[([^\]]+)\]/.exec(line.trim())
    if (section) {
      current = section[1]
      continue
    }
    const m = /^([A-Za-z0-9_-]+)\s*=\s*["'{]?([^"'#}\s]+)?/.exec(line.trim())
    if (!m || m[1].startsWith('[')) continue
    if (current === 'dependencies' || current === 'workspace.dependencies') deps.push({ name: m[1], version: m[2] ?? '*' })
    if (current === 'dev-dependencies') devDeps.push({ name: m[1], version: m[2] ?? '*' })
  }
  return { deps, devDeps }
}

/** Collect dependency manifests from the scanned file set. */
export async function readManifests(root: string, files: ScannedFile[]): Promise<ManifestInfo[]> {
  const out: ManifestInfo[] = []
  for (const file of files) {
    const kind = manifestOf(path.basename(file.full))
    if (!kind) continue
    let content: string
    try {
      content = await fsp.readFile(file.full, 'utf8')
    } catch {
      continue
    }
    let parsed: { deps: ManifestDep[]; devDeps: ManifestDep[] }
    switch (kind) {
      case 'package.json': parsed = parsePackageJson(content); break
      case 'pyproject.toml': parsed = parsePyproject(content); break
      case 'go.mod': parsed = parseGoMod(content); break
      case 'Cargo.toml': parsed = parseCargo(content); break
    }
    if (parsed.deps.length > 0 || parsed.devDeps.length > 0) {
      out.push({ file: file.rel, kind, ...parsed })
    }
  }
  return out
}

export interface RefEdge {
  /** Source directory (relative) that imports from `to`. */
  from: string
  /** Target directory (relative). */
  to: string
  count: number
}

export interface RefModule {
  /** Relative source path. */
  path: string
  /** Number of distinct local files that reference it. */
  referencedBy: number
}

export interface RefGraph {
  stats: { files: number; edges: number }
  /** Top modules by inbound references. */
  hotModules: RefModule[]
  /** Top directory-level edges, largest first. */
  edges: RefEdge[]
}

function isLocalSpec(spec: string): boolean {
  return spec.startsWith('.') || spec.startsWith('/')
}

function stripQueryFragment(spec: string): string {
  return spec.split(/[?#]/)[0]
}

/** Normalize a local specifier to a relative path with a candidate extension. */
async function resolveLocalSpec(root: string, fromFile: string, spec: string): Promise<string | undefined> {
  const base = path.resolve(path.dirname(fromFile), spec)
  const candidates = [
    base,
    ...(path.extname(base) ? [] : ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '/index.ts', '/index.js', '/index.tsx', '/index.jsx', '/index.py'].map((suffix) => base + suffix)),
  ]
  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return path.relative(root, candidate).split(path.sep).join('/')
    }
  }
  return undefined
}

/** Build the local module reference graph from scanned source files. */
export async function buildRefGraph(root: string, files: ScannedFile[], config: Config, maxEdges: number): Promise<RefGraph> {
  const sourceFiles = files.filter((f) => SOURCE_EXTS.has(f.ext))
  const inbound = new Map<string, number>()
  const edgeCount = new Map<string, number>()

  for (const file of sourceFiles) {
    let content: string
    try {
      content = await fsp.readFile(file.full, 'utf8')
    } catch {
      continue
    }
    const isPy = file.ext === 'py'
    const re = isPy ? PY_IMPORT_RE : JS_IMPORT_RE
    re.lastIndex = 0
    const seen = new Set<string>()
    let match: RegExpExecArray | null
    while ((match = re.exec(content)) !== null) {
      const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim()
      const spec = stripQueryFragment(raw)
      if (!spec || !isLocalSpec(spec)) continue
      const resolved = await resolveLocalSpec(root, file.full, spec)
      if (!resolved) continue
      if (seen.has(resolved)) continue
      seen.add(resolved)
      inbound.set(resolved, (inbound.get(resolved) ?? 0) + 1)
      const fromDir = path.posix.dirname(file.rel)
      const toDir = path.posix.dirname(resolved)
      if (fromDir !== toDir) {
        const key = `${fromDir}\u0000${toDir}`
        edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1)
      }
    }
  }

  const hotModules = [...inbound.entries()]
    .map(([file, referencedBy]) => ({ path: file, referencedBy }))
    .sort((a, b) => b.referencedBy - a.referencedBy)
    .slice(0, 10)

  const edges = [...edgeCount.entries()]
    .map(([key, count]) => {
      const [from, to] = key.split('\u0000')
      return { from, to, count }
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, maxEdges)

  return { stats: { files: sourceFiles.length, edges: edges.length }, hotModules, edges }
}

/** Find source files that reference a given external package (impact surface). */
export async function findPackageRefs(root: string, files: ScannedFile[], packageName: string, config: Config): Promise<string[]> {
  const rootPath = resolveWithin(root, '.')
  const sourceFiles = files.filter((f) => SOURCE_EXTS.has(f.ext))
  const hits: string[] = []
  const re = new RegExp(`['"](?:${packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?:/|['"])`, 'g')
  for (const file of sourceFiles) {
    let content: string
    try {
      content = await fsp.readFile(file.full, 'utf8')
    } catch {
      continue
    }
    re.lastIndex = 0
    if (re.test(content)) hits.push(file.rel)
  }
  return hits
}

/** Compute per-extension file statistics. */
export function languageStats(files: ScannedFile[]): Array<{ ext: string; files: number; bytes: number }> {
  const byExt = new Map<string, { files: number; bytes: number }>()
  for (const file of files) {
    const ext = file.ext || '(none)'
    const current = byExt.get(ext) ?? { files: 0, bytes: 0 }
    current.files += 1
    current.bytes += file.size
    byExt.set(ext, current)
  }
  return [...byExt.entries()]
    .map(([ext, value]) => ({ ext, ...value }))
    .sort((a, b) => b.files - a.files)
}