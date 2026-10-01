import "server-only"

import { execFile } from "node:child_process"
import { promisify } from "node:util"

import { git } from "@/lib/git"
import type {
  PrInfo,
  PrReviewDecision,
  PrState,
  PullsResponse,
} from "@/lib/types"

/**
 * Server-only GitHub Pull Request reader — `gh pr list`, branch-keyed.
 *
 * Why `gh` (not the GitHub REST/GraphQL API directly): GitScope is a local,
 * single-user tool, and the user is already authenticated with the `gh` CLI.
 * Shelling out to `gh` inherits that auth for free (no token handling here) and
 * matches how the rest of GitScope reads git state via child processes.
 *
 * A cheap remote-URL parse gates the spawn: a non-GitHub repo (or one with no
 * usable remote) NEVER spawns `gh`. github.com only for v1 — GitHub Enterprise
 * hosts are intentionally excluded (they simply get no badges).
 *
 * Everything here is best-effort, exactly like symbols.ts / references.ts:
 * `gh` not installed, not authed, offline, rate-limited, timed out, or emitting
 * malformed JSON all resolve to `{ available:false, prs:{} }` and NEVER throw.
 * A real GitHub repo with no matching PRs resolves to `{ available:true, prs:{} }`
 * — that one distinction is the whole point of the `available` flag. The picker
 * and the diff must render byte-identically when PR data is unavailable.
 */

const execFileAsync = promisify(execFile)

/** Warm `gh pr list` is ~370ms; tolerate a cold / slow network before bailing. */
const GH_TIMEOUT_MS = 5_000
/** Single user re-opens the picker within seconds — a short TTL is plenty. */
const PULLS_TTL_MS = 60_000
/** Cap captured stdout so a pathological repo can't balloon memory. */
const GH_MAX_BUFFER = 8 * 1024 * 1024

/** owner/repo guard — rejects shell metacharacters and 3-segment paths. */
const SLUG_RE = /^[\w.-]+\/[\w.-]+$/

/**
 * Remote URL → [host, path]. Covers the scp-short form (git@host:owner/repo),
 * git://, ssh:// (optional user@ and :port), and https/http (optional user@),
 * tolerating a trailing `.git` and/or `/`.
 */
const REMOTE_RE =
  /^(?:git@|git:\/\/|ssh:\/\/(?:[^@/]+@)?|https?:\/\/(?:[^@/]+@)?)([^/:]+)(?::\d+)?[:/](.+?)(?:\.git)?\/?$/i

/** The exact `--json` field set requested from `gh` (validated live). */
const GH_FIELDS =
  "number,state,isDraft,headRefName,baseRefName,url,title,reviewDecision,updatedAt,isCrossRepository"

/** Raw shape of one `gh pr list --json …` record (only the requested fields). */
interface GhPr {
  number: number
  state: "OPEN" | "CLOSED" | "MERGED"
  isDraft: boolean
  headRefName: string
  baseRefName: string
  url: string
  title: string
  reviewDecision: string
  updatedAt: string
  isCrossRepository: boolean
}

/** The single answer for every "not available" path — frozen, shared. */
const UNAVAILABLE: PullsResponse = { available: false, prs: {} }

/** Parse a remote URL → "owner/repo" when it's a github.com remote, else null. */
function githubSlug(url: string): string | null {
  const m = REMOTE_RE.exec(url.trim())
  if (!m) return null
  // GitHub Enterprise hosts are excluded in v1 — only github.com (and any
  // subdomain that ends in .github.com) qualifies.
  if (!/(^|\.)github\.com$/i.test(m[1])) return null
  return SLUG_RE.test(m[2]) ? m[2] : null
}

/** First github.com slug among origin, then upstream, then any remote. */
async function detectGitHub(repoPath: string): Promise<string | null> {
  let remotes: { name: string; refs: { fetch?: string; push?: string } }[]
  try {
    remotes = await git(repoPath).getRemotes(true)
  } catch {
    return null
  }
  const find = (n: string) => remotes.find((r) => r.name === n)
  // Prefer origin, then upstream, then fall back to scanning every remote.
  const ordered = [find("origin"), find("upstream"), ...remotes].filter(
    (r): r is NonNullable<typeof r> => Boolean(r),
  )
  for (const r of ordered) {
    const slug = githubSlug(r.refs?.fetch || r.refs?.push || "")
    if (slug) return slug
  }
  return null
}

/** Primary-selection priority: open beats draft beats merged beats closed. */
const STATE_RANK: Record<PrState, number> = {
  open: 0,
  draft: 1,
  merged: 2,
  closed: 3,
}

/** Fold gh's state + isDraft into the normalized PrState the UI switches on. */
function toState(p: GhPr): PrState {
  if (p.state === "MERGED") return "merged"
  if (p.state === "CLOSED") return "closed"
  return p.isDraft ? "draft" : "open"
}

/** gh's reviewDecision string → typed value, with "" (and anything else) → null. */
function toReviewDecision(raw: string): PrReviewDecision | null {
  return raw === "APPROVED" ||
    raw === "CHANGES_REQUESTED" ||
    raw === "REVIEW_REQUIRED"
    ? raw
    : null
}

/**
 * headRefName → primary PrInfo. Cross-fork PRs are dropped (their headRefName is
 * just a branch on a different repo and can't map to a local branch); the rest
 * are grouped by head branch and reduced to one primary per branch.
 */
function selectPrs(prs: GhPr[]): Record<string, PrInfo> {
  const groups = new Map<string, GhPr[]>()
  for (const p of prs) {
    if (p.isCrossRepository) continue // a fork PR can't map to a local branch.
    const g = groups.get(p.headRefName) ?? []
    g.push(p)
    groups.set(p.headRefName, g)
  }

  const out: Record<string, PrInfo> = {}
  for (const [head, group] of groups) {
    // Primary: open > draft > merged > closed; tie → newest updatedAt, then #.
    const primary = [...group].sort((a, b) => {
      const r = STATE_RANK[toState(a)] - STATE_RANK[toState(b)]
      if (r !== 0) return r
      const t = b.updatedAt.localeCompare(a.updatedAt)
      return t !== 0 ? t : b.number - a.number
    })[0]
    out[head] = {
      number: primary.number,
      state: toState(primary),
      title: primary.title,
      url: primary.url,
      reviewDecision: toReviewDecision(primary.reviewDecision),
      baseRefName: primary.baseRefName,
      updatedAt: primary.updatedAt,
      extra: group.length - 1,
    }
  }
  return out
}

// ── Module-level, HMR-safe cache (pinned to globalThis) ───────────────────────
// Mirrors symbols.ts: a naive module-scope singleton would re-create/leak on
// every Next.js dev HMR save. The cache holds resolved responses (TTL'd) plus an
// in-flight map so N concurrent dashboard cards collapse to ONE `gh` spawn.
interface PullsCache {
  entries: Map<string, { expires: number; value: PullsResponse }>
  inflight: Map<string, Promise<PullsResponse>>
}

const G = globalThis as typeof globalThis & { __gitscopePulls?: PullsCache }

function cache(): PullsCache {
  if (!G.__gitscopePulls) {
    G.__gitscopePulls = { entries: new Map(), inflight: new Map() }
  }
  return G.__gitscopePulls
}

/** The uncached computation: detect GitHub → `gh pr list` → group → normalize. */
async function compute(repoPath: string): Promise<PullsResponse> {
  const slug = await detectGitHub(repoPath)
  if (!slug) return UNAVAILABLE // short-circuit: never spawn gh for a non-GitHub repo.

  let stdout: string
  try {
    // execFile (NOT exec/shell): the args are a fixed array and repoPath is only
    // ever passed as `cwd`, never interpolated — injection-safe. gh infers the
    // repo from cwd (no --repo needed); captured stdout means no TTY, so gh can't
    // prompt. `--state all` (default is open-only) + `--limit 100` (default 30).
    ;({ stdout } = await execFileAsync(
      "gh",
      ["pr", "list", "--state", "all", "--limit", "100", "--json", GH_FIELDS],
      {
        cwd: repoPath,
        signal: AbortSignal.timeout(GH_TIMEOUT_MS), // Node 22+: SIGTERM on timeout.
        maxBuffer: GH_MAX_BUFFER,
        windowsHide: true,
        env: process.env,
      },
    ))
  } catch {
    // ENOENT (no gh) / not logged in / 403 rate-limit / offline / timeout — all
    // indistinguishable here and all equally non-fatal. Never echo gh's stderr.
    return UNAVAILABLE
  }

  let raw: unknown
  try {
    raw = JSON.parse(stdout)
  } catch {
    return UNAVAILABLE
  }
  if (!Array.isArray(raw)) return UNAVAILABLE

  return { available: true, repo: slug, prs: selectPrs(raw as GhPr[]) }
}

/**
 * Branch → primary GitHub PR map for a repo, best-effort. NEVER throws.
 *
 * Returns `{ available:false, prs:{} }` for a non-GitHub remote or ANY failure
 * (no/unauthed gh, offline, rate-limited, timeout, malformed JSON), and
 * `{ available:true, prs:{} }` for a GitHub repo that simply has no PRs.
 *
 * Cached per `repoPath` (TTL 60s, globalThis-pinned to survive HMR, with
 * in-flight coalescing) so the often-opened picker and the N-card dashboard
 * spawn at most one `gh` per repo per minute. `{ refresh: true }` bypasses the
 * cached value but still coalesces and re-populates it.
 */
export async function getPullRequests(
  repoPath: string,
  opts?: { refresh?: boolean },
): Promise<PullsResponse> {
  const c = cache()
  if (!opts?.refresh) {
    const hit = c.entries.get(repoPath)
    if (hit && hit.expires > Date.now()) return hit.value
    const inflight = c.inflight.get(repoPath)
    if (inflight) return inflight // coalesce concurrent callers onto one spawn.
  }

  const p = compute(repoPath)
    .catch(() => UNAVAILABLE) // belt-and-suspenders: compute never rejects, but be sure.
    .then((value) => {
      c.entries.set(repoPath, { expires: Date.now() + PULLS_TTL_MS, value })
      return value
    })
    .finally(() => c.inflight.delete(repoPath))

  c.inflight.set(repoPath, p)
  return p
}
