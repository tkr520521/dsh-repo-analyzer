import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { detectStack, languageStats, parsePackageJson, parsePyproject, parseGoMod, parseCargo, buildRefGraph } from '../lib/analyze.js'
import { resolveWithin, walk } from '../lib/fsutil.js'

function fakeFile(rel, size = 10, ext) {
  return { full: path.resolve(rel), rel, size, ext: ext ?? (path.extname(rel).slice(1).toLowerCase() || 'ts') }
}

test('detectStack identifies stacks from manifest presence', () => {
  const files = [
    fakeFile('package.json', 10, 'json'),
    fakeFile('tsconfig.json', 10, 'json'),
    fakeFile('src/index.ts'),
  ]
  const stack = detectStack(files)
  assert.deepEqual(stack.map((s) => s.name).sort(), ['Node.js', 'TypeScript'])
})

test('detectStack handles Go and Python markers', () => {
  const files = [fakeFile('go.mod', 10, 'mod'), fakeFile('pyproject.toml', 10, 'toml')]
  const stack = detectStack(files)
  const names = stack.map((s) => s.name)
  assert.ok(names.includes('Go'))
  assert.ok(names.includes('Python'))
})

test('languageStats aggregates by extension', () => {
  const stats = languageStats([
    fakeFile('a.ts', 10),
    fakeFile('b.ts', 20),
    fakeFile('c.js', 30),
  ])
  const ts = stats.find((s) => s.ext === 'ts')
  const js = stats.find((s) => s.ext === 'js')
  assert.equal(ts.files, 2)
  assert.equal(ts.bytes, 30)
  assert.equal(js.files, 1)
})

test('parsePackageJson reads prod and dev deps', () => {
  const { deps, devDeps } = parsePackageJson(JSON.stringify({
    dependencies: { lodash: '^4.17.21' },
    devDependencies: { typescript: '^5.6.0' },
  }))
  assert.deepEqual(deps, [{ name: 'lodash', version: '^4.17.21' }])
  assert.deepEqual(devDeps, [{ name: 'typescript', version: '^5.6.0' }])
})

test('parsePackageJson tolerates broken JSON', () => {
  const { deps, devDeps } = parsePackageJson('{ not json')
  assert.deepEqual(deps, [])
  assert.deepEqual(devDeps, [])
})

test('parsePyproject separates project and dev deps', () => {
  const { deps, devDeps } = parsePyproject(`
[project]
dependencies = [
  "requests>=2.0",
]
[project.optional-dependencies]
dev = ["pytest"]
`)
  assert.ok(deps.some((d) => d.name === 'requests'))
  assert.ok(devDeps.some((d) => d.name === 'pytest'))
})

test('parseGoMod reads require block', () => {
  const { deps } = parseGoMod('module example\n\nrequire (\n\tgithub.com/foo/bar v1.2.3\n)')
  assert.ok(deps.some((d) => d.name === 'github.com/foo/bar' && d.version === 'v1.2.3'))
})

test('parseCargo separates dev-dependencies', () => {
  const { deps, devDeps } = parseCargo('[dependencies]\nserde = "1.0"\n[dev-dependencies]\ncriterion = "0.5"')
  assert.deepEqual(deps, [{ name: 'serde', version: '1.0' }])
  assert.deepEqual(devDeps, [{ name: 'criterion', version: '0.5' }])
})

test('resolveWithin rejects path traversal', () => {
  const root = path.resolve('C:/tmp/repo')
  assert.throws(() => resolveWithin(root, '../escape'))
  assert.throws(() => resolveWithin(root, 'a/../../escape'))
  assert.doesNotThrow(() => resolveWithin(root, 'src'))
  assert.doesNotThrow(() => resolveWithin(root, '.'))
})

test('buildRefGraph finds hot modules and cross-directory edges', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'repo-refs-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(path.join(dir, 'a'), { recursive: true })
  mkdirSync(path.join(dir, 'b'), { recursive: true })
  mkdirSync(path.join(dir, 'c'), { recursive: true })
  writeFileSync(path.join(dir, 'a', 'index.ts'), 'export const a = 1')
  writeFileSync(path.join(dir, 'b', 'util.ts'), 'export const u = 2')
  writeFileSync(path.join(dir, 'a', 'x.ts'), "import { u } from '../b/util'\nimport { a } from './index'")
  writeFileSync(path.join(dir, 'c', 'entry.ts'), "import { x } from '../a/x'\nimport { u } from '../b/util'")

  const config = { root: dir, maxDepth: 5, maxFiles: 2000, maxFileBytes: 1048576, exclude: ['node_modules'] }
  const scan = await walk(dir, config)
  const graph = await buildRefGraph(dir, scan.files, config, 20)

  assert.equal(graph.stats.files, 4)
  assert.equal(graph.hotModules[0].path, 'b/util.ts')
  assert.equal(graph.hotModules[0].referencedBy, 2)
  const edgeKeys = graph.edges.map((e) => `${e.from}->${e.to}`)
  assert.ok(edgeKeys.includes('a->b'))
  assert.ok(edgeKeys.includes('c->a'))
  assert.ok(edgeKeys.includes('c->b'))
})

test('walk respects exclude, maxDepth and maxFileBytes', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'repo-walk-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  mkdirSync(path.join(dir, 'node_modules'), { recursive: true })
  mkdirSync(path.join(dir, 'src', 'deep'), { recursive: true })
  writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'x')
  writeFileSync(path.join(dir, 'src', 'a.ts'), 'a')
  writeFileSync(path.join(dir, 'src', 'deep', 'b.ts'), 'b')

  const config = { root: dir, maxDepth: 1, maxFiles: 2000, maxFileBytes: 10, exclude: ['node_modules'] }
  const scan = await walk(dir, config)
  assert.ok(!scan.files.some((f) => f.rel.includes('node_modules')))
  assert.ok(scan.files.some((f) => f.rel === 'src/a.ts'))
  assert.ok(!scan.files.some((f) => f.rel.includes('deep')))
})