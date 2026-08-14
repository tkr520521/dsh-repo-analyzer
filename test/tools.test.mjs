import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const plugin = await import('../lib/index.js')

function makeContext() {
  const defs = []
  const ctx = {
    tools: { register: (def) => defs.push(def) },
    on: () => () => {},
    logger: () => ({ info: () => {} }),
  }
  return { ctx, defs }
}

test('plugin registers exactly the three analysis tools', () => {
  const { defs } = makeContext()
  plugin.apply({ tools: { register: (d) => defs.push(d) }, on: () => () => {}, logger: () => ({ info: () => {} }) }, { root: '.', maxDepth: 2, maxFiles: 100, maxFileBytes: 1024 * 1024, exclude: ['node_modules'] })
  assert.deepEqual(defs.map((d) => d.name).sort(), ['repo_deps', 'repo_refs', 'repo_scan'])
  for (const def of defs) {
    assert.ok(def.description.length > 10)
    assert.ok(def.output && def.output.schema)
  }
})

test('repo_scan works against a real temp directory', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'repo-tool-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture' }))
  writeFileSync(path.join(dir, 'index.ts'), 'export const x = 1')

  const { ctx, defs } = makeContext()
  plugin.apply(ctx, { root: dir, maxDepth: 3, maxFiles: 500, maxFileBytes: 1024 * 1024, exclude: ['node_modules'] })
  const scanDef = defs.find((d) => d.name === 'repo_scan')
  const value = await scanDef.execute({}, { signal: new AbortController().signal, agent: undefined })
  assert.equal(value.counts.files, 2)
  assert.ok(value.stack.some((s) => s.name === 'Node.js'))
  assert.ok(value.manifests.includes('package.json'))
})

test('repo_deps reports totals and package impact surface', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'repo-tool-deps-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fixture', dependencies: { lodash: '^4.17.21' } }))
  writeFileSync(path.join(dir, 'index.ts'), "import _ from 'lodash'\nexport default _\n")

  const { ctx, defs } = makeContext()
  plugin.apply(ctx, { root: dir, maxDepth: 3, maxFiles: 500, maxFileBytes: 1024 * 1024, exclude: ['node_modules'] })
  const depsDef = defs.find((d) => d.name === 'repo_deps')
  const value = await depsDef.execute({}, { signal: new AbortController().signal, agent: undefined })
  assert.equal(value.totals.prod, 1)
  assert.equal(value.manifests[0].deps[0].name, 'lodash')

  const pkg = await depsDef.execute({ package: 'lodash' }, { signal: new AbortController().signal, agent: undefined })
  assert.equal(pkg.package.name, 'lodash')
  assert.equal(pkg.package.declared.length, 1)
  assert.ok(pkg.package.referencedBy.includes('index.ts'))
})