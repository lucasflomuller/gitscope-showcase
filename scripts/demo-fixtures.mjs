import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import path from 'node:path'

const date = '2026-01-15T12:00:00Z'
const baseline = {
  'src/metrics.ts': `export interface MetricPoint {
  date: string;
  activeUsers: number;
  sessions: number;
}

export function sessionsPerUser(point: MetricPoint): number {
  return point.sessions / point.activeUsers;
}
`,
  'src/MetricCard.tsx': `import { sessionsPerUser, type MetricPoint } from "./metrics";

export function MetricCard({ point }: { point: MetricPoint }) {
  return (
    <article>
      <h2>Sessions per active user</h2>
      <p>{sessionsPerUser(point)}</p>
    </article>
  );
}
`,
  'data/weekly.json': JSON.stringify([
    { date: '2026-01-12', activeUsers: 240, sessions: 720 },
    { date: '2026-01-13', activeUsers: 0, sessions: 0 },
    { date: '2026-01-14', activeUsers: 320, sessions: 1120 },
  ], null, 2) + '\n',
  'README.md': '# Atlas Metrics\n\nFictional analytics UI, created only for the GitScope demo.\nAll records, authors and commits are synthetic.\n',
}

/** Create fresh fixture repositories, never register or copy real user projects. */
export async function createDemo(parent) {
  await mkdir(parent, { recursive: true })
  const root = await mkdtemp(path.join(parent, 'run-'))
  const state = path.join(root, 'state')
  await mkdir(state)
  const gitEnv = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Demo Author', GIT_AUTHOR_EMAIL: 'demo@example.invalid',
    GIT_COMMITTER_NAME: 'Demo Author', GIT_COMMITTER_EMAIL: 'demo@example.invalid',
    GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
  }
  // Ignore inherited Git routing and injected config, including test/agent shells.
  for (const key of Object.keys(gitEnv)) {
    if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|COMMON_DIR|OBJECT_DIRECTORY|ALTERNATE_OBJECT_DIRECTORIES|CONFIG_COUNT|CONFIG_PARAMETERS|CONFIG_KEY_\d+|CONFIG_VALUE_\d+)$/.test(key)) delete gitEnv[key]
  }
  const git = (repo, ...args) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-C', repo, ...args], { env: gitEnv, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  async function put(repo, file, content) {
    const target = path.join(repo, file)
    await mkdir(path.dirname(target), { recursive: true })
    await writeFile(target, content)
  }
  const repos = []
  for (const [slug, name] of [['atlas-metrics', 'Atlas Metrics'], ['signal-pipeline', 'Signal Pipeline']]) {
    const repo = path.join(root, slug)
    await mkdir(repo)
    git(repo, 'init', '-b', 'main')
    git(repo, 'config', 'user.name', 'Demo Author')
    git(repo, 'config', 'user.email', 'demo@example.invalid')
    if (slug === 'atlas-metrics') {
      for (const [file, content] of Object.entries(baseline)) await put(repo, file, content)
      git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Add fictional weekly engagement dashboard')
      git(repo, 'checkout', '-b', 'feature/reliable-metrics')
      await put(repo, 'src/metrics.ts', baseline['src/metrics.ts'].replace('return point.sessions / point.activeUsers;', 'if (point.activeUsers <= 0) return 0;\n  return point.sessions / point.activeUsers;'))
      await put(repo, 'src/metrics.test.ts', `import assert from "node:assert/strict";
import { test } from "node:test";
import { sessionsPerUser } from "./metrics.ts";

test("handles a day without active users", () => {
  assert.equal(sessionsPerUser({ date: "2026-01-13", activeUsers: 0, sessions: 0 }), 0);
});

test("computes sessions per active user", () => {
  assert.equal(sessionsPerUser({ date: "2026-01-12", activeUsers: 240, sessions: 720 }), 3);
});
`)
      git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Guard empty cohorts and test the metric boundary')
      await put(repo, 'src/MetricCard.tsx', baseline['src/MetricCard.tsx'].replace('<article>', '<article aria-label="Engagement metric">').replace('<p>{sessionsPerUser(point)}</p>', '<p>{sessionsPerUser(point).toFixed(1)}</p>\n      <small>Based on synthetic daily activity</small>'))
      git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Label metric cards and format the result')
      await put(repo, 'REVIEW.md', '# Demo review\n\nCompare main with feature/reliable-metrics. Inspect the zero-user guard, unit tests and accessible metric card.\n')
    } else {
      await put(repo, 'README.md', '# Signal Pipeline\n\nFictional ingestion worker for the GitScope demo.\n')
      await put(repo, 'src/batch.ts', 'export const batchSize = 100;\nexport const retryLimit = 1;\n')
      git(repo, 'add', '.'); git(repo, 'commit', '-m', 'Add fictional batch worker')
      git(repo, 'checkout', '-b', 'feature/bounded-retries')
      await put(repo, 'src/batch.ts', 'export const batchSize = 250;\nexport const retryLimit = 3;\n')
      git(repo, 'add', 'src/batch.ts')
    }
    repos.push({ id: createHash('sha1').update(repo).digest('hex').slice(0, 12), path: repo, name, addedAt: date })
  }
  const id = repos[0].id
  const compareKey = 'merge-base:main...feature/reliable-metrics'
  await writeFile(path.join(state, 'repos.json'), JSON.stringify(repos, null, 2) + '\n', { mode: 0o600 })
  await writeFile(path.join(state, 'guides.json'), JSON.stringify({ [id]: { [compareKey]: {
    id: 'synthetic-guide', compareKey, title: 'Make engagement metrics reliable',
    summary: 'Seeded walkthrough written for this demo; no AI service was called.',
    generatedBy: 'mcp', createdAt: date,
    sections: [
      { id: 'boundary', title: 'Start with the metric boundary', explanation: 'An empty cohort must return zero instead of NaN. The synthetic test makes the regression reproducible.', paths: ['src/metrics.ts', 'src/metrics.test.ts'] },
      { id: 'presentation', title: 'Then inspect the React presentation', explanation: 'The component gives the metric a readable label and consistent precision.', paths: ['src/MetricCard.tsx'] },
    ],
  } } }, null, 2) + '\n')
  await writeFile(path.join(state, 'comments.json'), JSON.stringify({ [id]: [{
    id: 'synthetic-note', path: 'src/metrics.ts', startLine: 0, endLine: 0,
    anchorHash: '', body: 'Synthetic review note: should negative activity be rejected upstream or treated as an empty cohort?',
    createdAt: date, ref: 'feature/reliable-metrics', state: 'open', source: 'user',
  }] }, null, 2) + '\n')
  const query = new URLSearchParams({ repo: id, base: 'branch:main', compare: 'branch:feature/reliable-metrics', mode: 'merge-base', file: 'src/metrics.ts' })
  return { root, state, repos, query: query.toString() }
}
