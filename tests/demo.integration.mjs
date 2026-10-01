import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createDemo } from '../scripts/demo-fixtures.mjs'

const parent = await mkdtemp(path.join(tmpdir(), 'gitscope-demo-http-'))
const demo = await createDemo(parent)
const port = process.env.GITSCOPE_DEMO_TEST_PORT || '3418'
const origin = `http://127.0.0.1:${port}`
let logs = ''
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', port], {
  env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1', GITSCOPE_DEMO: '1', GITSCOPE_CONFIG_DIR: demo.state, GITSCOPE_DIST_DIR: '.next', GITSCOPE_PUBLIC_URL: origin },
  stdio: ['ignore', 'pipe', 'pipe'],
})
server.stdout.on('data', data => logs += data)
server.stderr.on('data', data => logs += data)
const request = (route, method = 'GET', body) => fetch(origin + route, {
  method, headers: { 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
})
try {
  let ready = false
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(`Demo server exited: ${logs}`)
    try { if ((await request('/api/repos')).ok) { ready = true; break } } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  assert.ok(ready, logs)
  assert.match(await (await request('/')).text(), /Synthetic demo/)
  const repos = await (await request('/api/repos')).json()
  assert.deepEqual(repos.map(repo => repo.name), ['Atlas Metrics', 'Signal Pipeline'])
  assert.deepEqual(repos.map(repo => repo.path), ['/demo/atlas-metrics', '/demo/signal-pipeline'])
  const id = repos[0].id
  const base = `/api/repos/${id}`
  const refs = await (await request(base + '/refs')).json()
  assert.ok(refs.worktrees.every(tree => tree.path.startsWith('/demo/')))
  assert.ok(!JSON.stringify(refs).includes(demo.root))
  const comparison = '?base=main&compare=feature%2Freliable-metrics&mode=merge-base'
  const diff = await (await request(base + '/diff' + comparison)).json()
  assert.match(diff.patch, /activeUsers <= 0/)
  assert.equal(diff.stats.files, 3)
  assert.equal((await (await request(base + '/prs')).json()).available, false)
  assert.ok((await (await request(base + '/guide' + comparison)).json()).guide)
  const before = await readFile(path.join(demo.state, 'repos.json'), 'utf8')
  for (const [route, method, body] of [
    ['/api/repos', 'POST', { path: process.cwd() }],
    [base, 'DELETE'], [base + '/comments', 'POST', { body: 'must not persist' }],
    [base + '/guide/generate', 'POST', {}], [base + '/prereview', 'POST', {}],
    [base + '/preflight/allowlist', 'POST', {}],
    ['/api/mcp', 'POST', { jsonrpc: '2.0', method: 'tools/call', id: 1 }],
  ]) assert.equal((await request(route, method, body)).status, 403, route)
  assert.equal(await readFile(path.join(demo.state, 'repos.json'), 'utf8'), before)
  assert.equal((await request('/api/repos/unknown/refs')).status, 404)
  const symbols = await request(base + '/symbols', 'POST', { path: 'src/metrics.ts', ref: 'feature/reliable-metrics' })
  assert.equal(symbols.status, 200)
  console.log('PASS: synthetic dashboard, real diff, seeded guide, read APIs and demo write/AI/MCP guards')
} finally {
  server.kill('SIGTERM')
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve))
  await rm(parent, { recursive: true, force: true })
}
