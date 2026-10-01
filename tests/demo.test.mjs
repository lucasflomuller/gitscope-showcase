import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { createDemo } from '../scripts/demo-fixtures.mjs'

test('demo creates independent synthetic histories and never reuses existing state', async () => {
  const parent = await mkdtemp(path.join(tmpdir(), 'gitscope-fixture-test-'))
  try {
    const first = await createDemo(parent)
    const second = await createDemo(parent)
    assert.notEqual(first.state, second.state)
    const git = (repo, ...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
    for (const repo of first.repos) {
      assert.equal(git(repo.path, 'remote'), '')
      assert.equal(git(repo.path, 'log', '--format=%ae', '-1'), 'demo@example.invalid')
      assert.ok(repo.path.startsWith(first.root + path.sep))
    }
    const atlas = first.repos[0].path
    assert.equal(git(atlas, 'rev-list', '--count', 'main..feature/reliable-metrics'), '2')
    assert.match(git(atlas, 'diff', 'main...feature/reliable-metrics'), /activeUsers <= 0/)
    assert.match(git(first.repos[1].path, 'diff', '--cached'), /retryLimit = 3/)
    const guides = JSON.parse(await readFile(path.join(first.state, 'guides.json'), 'utf8'))
    assert.ok(guides[first.repos[0].id]['merge-base:main...feature/reliable-metrics'])
    execFileSync(process.execPath, ['--experimental-strip-types', '--test', 'src/metrics.test.ts'], { cwd: atlas, stdio: ['ignore', 'pipe', 'pipe'] })
  } finally { await rm(parent, { recursive: true, force: true }) }
})
