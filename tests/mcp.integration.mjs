import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm, access } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync, spawn } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const root = await mkdtemp(join(tmpdir(), 'gitscope-mcp-'))
const repo = join(root, 'project with spaces')
await mkdir(repo)
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
git('init', '-b', 'main'); git('config', 'user.email', 'test@example.test'); git('config', 'user.name', 'MCP test')
await writeFile(join(repo, 'hello.txt'), 'before\n'); git('add', '.'); git('commit', '-m', 'base')
git('checkout', '-b', 'feature/link-test')
await writeFile(join(repo, 'hello.txt'), 'after\n'); git('commit', '-am', 'change')
const port = process.env.GITSCOPE_TEST_PORT || '3307'
const origin = `http://127.0.0.1:${port}`
const publicOrigin = 'https://gitscope.example.ts.net:8447'
let logs = ''
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '-H', '127.0.0.1', '-p', port], { env: { ...process.env, GITSCOPE_CONFIG_DIR: join(root, 'state'), GITSCOPE_PUBLIC_URL: publicOrigin }, stdio: ['ignore', 'pipe', 'pipe'] })
server.stdout.on('data', d => logs += d); server.stderr.on('data', d => logs += d)
const client = new Client({ name: 'gitscope-integration', version: '1.0.0' })
const rpc = (body, headers = {}) => fetch(`${origin}/api/mcp`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) })
const call = async (name, args = {}, error = false) => {
  const result = await client.callTool({ name, arguments: args })
  assert.equal(!!result.isError, error, JSON.stringify(result))
  return error ? result : JSON.parse(result.content[0].text)
}
try {
  let ready = false
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${origin}/api/repos`)).ok) { ready = true; break } } catch {}
    await new Promise(r => setTimeout(r, 200))
  }
  assert.ok(ready, logs)
  await client.connect(new StreamableHTTPClientTransport(new URL(`${origin}/api/mcp`)))
  const tools = await client.listTools()
  assert.equal(tools.tools.length, 12)
  assert.equal((await call('list_repos')).length, 0)
  const project = await call('add_repo', { path: repo })
  assert.equal((await call('add_repo', { path: repo })).id, project.id)
  const duplicates = await Promise.all(Array.from({ length: 8 }, () => call('add_repo', { path: repo })))
  assert.ok(duplicates.every(item => item.id === project.id))
  assert.equal((await call('list_repos')).length, 1)
  assert.ok((await call('list_refs', { repoId: project.id })).branches.some(b => b.name === 'feature/link-test'))
  const cmp = { repoId: project.id, base: 'main', compare: 'feature/link-test' }
  const link = await call('create_comparison_link', { ...cmp, file: 'hello.txt' })
  const url = new URL(link.url)
  assert.equal(url.origin, publicOrigin)
  assert.equal(url.searchParams.get('base'), 'branch:main')
  assert.equal(url.searchParams.get('compare'), 'branch:feature/link-test')
  assert.equal(url.searchParams.get('file'), 'hello.txt')
  const pinned = await call('create_comparison_link', { ...cmp, pin: true, mode: 'direct' })
  assert.equal(new URL(pinned.url).searchParams.get('compare'), `commit:${git('rev-parse', 'HEAD')}`)
  assert.equal((await call('list_commits', cmp)).length, 1)
  assert.equal((await call('get_diff', cmp)).stats.files, 1)
  await call('create_comparison_link', { ...cmp, compare: 'missing' }, true)
  await call('get_diff', { ...cmp, base: '--output=/tmp/unsafe' }, true)
  await call('create_comparison_link', { ...cmp, file: 'absent.txt' }, true)
  await call('create_comparison_link', { ...cmp, compare: 'WORKING', pin: true }, true)
  await call('create_comparison_link', { ...cmp, mode: 'typo' }, true)
  await call('create_comparison_link', { ...cmp, extra: true }, true)
  await call('create_comparison_link', { repoId: 'missing' }, true)
  await call('list_commits', { repoId: project.id, limit: 101 }, true)
  await call('add_repo', { path: root }, true)
  git('checkout', '--orphan', 'unrelated'); git('commit', '-m', 'unrelated')
  await call('create_comparison_link', { ...cmp, compare: 'unrelated' }, true)
  await call('create_comparison_link', { ...cmp, compare: 'unrelated', mode: 'direct' })
  const comment = await call('add_comment', { ...cmp, path: 'hello.txt', startLine: 1, body: 'Review this change' })
  assert.ok(comment)
  assert.equal((await call('get_comments', cmp)).length, 1)
  await call('submit_review_guide', { ...cmp, title: 'Guide', sections: [{ title: 'Change', explanation: 'Read this', paths: ['hello.txt'] }] })
  assert.ok((await call('get_review_guide', cmp)).guide)
  await call('remove_repo', { repoId: project.id })
  assert.equal((await call('list_repos')).length, 0)
  await access(join(repo, '.git'))
  for (const malformed of [null, [], {}, { jsonrpc: '1.0', method: 'ping', id: 1 }]) assert.equal((await rpc(malformed)).status, 400)
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: 'https://evil.example' })).status, 403)
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { Origin: publicOrigin })).status, 200)
  assert.equal((await rpc({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'MCP-Protocol-Version': 'unknown' })).status, 400)
  assert.equal((await fetch(`${origin}/api/mcp`)).status, 405)
  console.log('PASS: SDK initialize/list/call, project lifecycle, links, pinned refs, diff, commits, review tools, invalid refs/arguments, unrelated histories, protocol and origin guards')
} finally {
  await client.close().catch(() => {})
  server.kill('SIGTERM')
  await new Promise(resolve => server.exitCode !== null ? resolve() : server.once('exit', resolve))
  await rm(root, { recursive: true, force: true })
}
