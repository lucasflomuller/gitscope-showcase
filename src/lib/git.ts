import "server-only"

import { spawn } from "node:child_process"
import { realpathSync } from "node:fs"
import { readFile, stat } from "node:fs/promises"
import path from "node:path"

import simpleGit, { type SimpleGit, type StatusResult } from "simple-git"

import type {
  BlameLine,
  BranchInfo,
  CommitInfo,
  DiffFileStatus,
  DiffFileSummary,
  DiffMode,
  DiffResult,
  RepoRefs,
  RepoStatus,
  TagInfo,
  WorktreeInfo,
} from "@/lib/types"

/** Field separator used in `git log` pretty formats (ASCII unit separator). */
const FS = "\x1f"

/** Soft cap for the full patch text (~1.5 MB) before it is marked truncated. */
const MAX_PATCH_BYTES = 1_500_000

/** A configured simple-git client bound to a repo working directory. */
export function git(repoPath: string): SimpleGit {
  return simpleGit({ baseDir: repoPath, maxConcurrentProcesses: 6 })
}

/** True when `repoPath` is inside a git working tree. */
export async function isGitRepo(repoPath: string): Promise<boolean> {
  try {
    return await git(repoPath).checkIsRepo()
  } catch {
    return false
  }
}

/** Count helper that tolerates simple-git returning a non-array field. */
function len(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

/**
 * Guard against option injection: a ref/committish beginning with '-' is parsed
 * by git as an option, and git commands honor write-capable options such as
 * `--output=<file>` — an arbitrary-file-overwrite primitive. Callers pass user
 * refs as positional args, so reject any leading-'-' (or empty) value before it
 * reaches a git command. The WORKING/STAGED sentinels never reach here (callers
 * branch on them first), so they don't need to be whitelisted.
 */
function isSafeRef(ref: string): boolean {
  return ref.length > 0 && !ref.startsWith("-")
}

/** Cap on how many changed files we fs.stat for the last-activity mtime. */
const MAX_STAT_FILES = 100

/**
 * Best-effort "most recent activity" timestamp for a repo: the later of the
 * HEAD committer date and the newest mtime among changed working-tree files
 * (so uncommitted WIP counts). Bounded + fully guarded — returns null when
 * nothing is known (e.g. a repo with no commits and a clean tree). Never throws.
 */
async function getLastActivity(
  repoPath: string,
  status: StatusResult,
  clean: boolean,
): Promise<string | null> {
  let newestMs = 0

  // HEAD committer date (ISO). Fails on an empty repo → leaves newestMs at 0.
  try {
    const out = await git(repoPath).raw(["log", "-1", "--format=%cI"])
    const iso = out.trim()
    if (iso) {
      const t = Date.parse(iso)
      if (Number.isFinite(t)) newestMs = Math.max(newestMs, t)
    }
  } catch {
    /* no commits yet */
  }

  // Newest mtime among changed files (captures work-in-progress). Skipped when
  // clean. Capped + each stat guarded so the poll stays cheap on big repos.
  if (!clean) {
    const changed = new Set<string>()
    for (const arr of [
      status.staged,
      status.modified,
      status.not_added,
      status.conflicted,
    ]) {
      if (Array.isArray(arr)) {
        for (const p of arr) if (typeof p === "string" && p) changed.add(p)
      }
    }
    const paths = Array.from(changed).slice(0, MAX_STAT_FILES)
    const mtimes = await Promise.all(
      paths.map(async (rel) => {
        try {
          const st = await stat(path.join(repoPath, rel))
          return st.mtimeMs
        } catch {
          return 0
        }
      }),
    )
    for (const ms of mtimes) if (ms > newestMs) newestMs = ms
  }

  return newestMs > 0 ? new Date(newestMs).toISOString() : null
}

/** Working-tree status summary for the sidebar. */
export async function getRepoStatus(repoPath: string): Promise<RepoStatus> {
  const empty: RepoStatus = {
    current: null,
    tracking: null,
    ahead: 0,
    behind: 0,
    staged: 0,
    unstaged: 0,
    untracked: 0,
    conflicted: 0,
    clean: true,
    lastActivity: null,
  }

  try {
    const s = await git(repoPath).status()
    const clean =
      typeof s.isClean === "function" ? s.isClean() : len(s.files) === 0
    return {
      current: s.current ?? null,
      tracking: s.tracking ?? null,
      ahead: typeof s.ahead === "number" ? s.ahead : 0,
      behind: typeof s.behind === "number" ? s.behind : 0,
      staged: len(s.staged),
      unstaged: len(s.modified),
      untracked: len(s.not_added),
      conflicted: len(s.conflicted),
      clean,
      lastActivity: await getLastActivity(repoPath, s, clean),
    }
  } catch {
    return empty
  }
}

/** The `git log` pretty format string shared by commit-log readers. */
const COMMIT_LOG_FORMAT = ["%H", "%h", "%s", "%an", "%ae", "%aI", "%cr", "%D"].join(
  "%x1f",
)

/** Parse `git log --pretty=format:COMMIT_LOG_FORMAT` output into CommitInfo[]. */
function parseCommitLog(out: string): CommitInfo[] {
  if (!out) return []
  return out
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const f = line.split(FS)
      const refs = f[7]?.trim()
      return {
        hash: f[0] ?? "",
        shortHash: f[1] ?? "",
        subject: f[2] ?? "",
        author: f[3] ?? "",
        email: f[4] ?? "",
        date: f[5] ?? "",
        relativeDate: f[6] ?? "",
        refs: refs ? refs : undefined,
      } satisfies CommitInfo
    })
    .filter((c) => c.hash.length > 0)
}

/** Recent commits reachable from `ref` (default HEAD), most recent first. */
export async function getCommits(
  repoPath: string,
  ref?: string,
  limit = 60,
): Promise<CommitInfo[]> {
  const startRef = ref && ref.trim() ? ref : "HEAD"
  if (!isSafeRef(startRef)) return []

  try {
    const out = await git(repoPath).raw([
      "log",
      startRef,
      `--pretty=format:${COMMIT_LOG_FORMAT}`,
      "-n",
      String(limit),
      "--",
    ])
    return parseCommitLog(out)
  } catch {
    return []
  }
}

/**
 * Commits in `base..compare` (reachable from compare but not base), newest
 * first — the commit list a PR/comparison shows. Fully guarded: sentinels like
 * WORKING/STAGED are not valid log args and will throw → [].
 */
export async function getCommitRange(
  repoPath: string,
  base: string,
  compare: string,
  limit = 100,
): Promise<CommitInfo[]> {
  if (!isSafeRef(base) || !isSafeRef(compare)) return []
  try {
    const out = await git(repoPath).raw([
      "log",
      `${base}..${compare}`,
      `--pretty=format:${COMMIT_LOG_FORMAT}`,
      "-n",
      String(limit),
      "--",
    ])
    return parseCommitLog(out)
  } catch {
    return []
  }
}

/** Parse the raw `for-each-ref` output into branches / remotes / tags. */
function parseRefs(
  raw: string,
  currentBranch: string | null,
): { branches: BranchInfo[]; remotes: BranchInfo[]; tags: TagInfo[] } {
  const branches: BranchInfo[] = []
  const remotes: BranchInfo[] = []
  const tags: TagInfo[] = []

  for (const line of raw.split("\n")) {
    if (!line) continue
    // %(refname)\t%(refname:short)\t%(objectname:short)\t%(upstream:short)\t%(contents:subject)
    const parts = line.split("\t")
    if (parts.length < 3) continue

    const fullRef = parts[0]
    const short = parts[1]
    const commit = parts[2]
    const upstream = parts[3] ?? ""
    const subjectRaw = parts.slice(4).join("\t")
    const subject = subjectRaw ? subjectRaw : undefined

    if (fullRef.startsWith("refs/heads/")) {
      branches.push({
        name: short,
        current: currentBranch !== null && short === currentBranch,
        isRemote: false,
        commit,
        subject,
        tracking: upstream ? upstream : undefined,
      })
    } else if (fullRef.startsWith("refs/remotes/")) {
      // Skip the symbolic "<remote>/HEAD" pointer rows.
      if (short.endsWith("/HEAD") || fullRef.endsWith("/HEAD")) continue
      remotes.push({
        name: short,
        current: false,
        isRemote: true,
        commit,
        subject,
      })
    } else if (fullRef.startsWith("refs/tags/")) {
      tags.push({ name: short, commit, subject })
    }
  }

  return { branches, remotes, tags }
}

interface WorktreeRecord {
  path: string
  head: string
  branch?: string
  detached: boolean
  bare: boolean
  locked: boolean
}

/** Parse `git worktree list --porcelain` output into WorktreeInfo records. */
function parseWorktrees(raw: string, repoPath: string): WorktreeInfo[] {
  const records: WorktreeRecord[] = []
  let cur: WorktreeRecord | null = null

  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (cur) records.push(cur)
      cur = {
        path: line.slice("worktree ".length),
        head: "",
        branch: undefined,
        detached: false,
        bare: false,
        locked: false,
      }
    } else if (cur) {
      if (line.startsWith("HEAD ")) cur.head = line.slice("HEAD ".length)
      else if (line.startsWith("branch ")) cur.branch = line.slice("branch ".length)
      else if (line === "detached") cur.detached = true
      else if (line === "bare") cur.bare = true
      else if (line.startsWith("locked")) cur.locked = true
    }
  }
  if (cur) records.push(cur)

  let repoReal = repoPath
  try {
    repoReal = realpathSync(repoPath)
  } catch {
    /* keep the raw path */
  }

  return records.map((rec, idx) => {
    let wtReal = rec.path
    try {
      wtReal = realpathSync(rec.path)
    } catch {
      /* keep the raw path */
    }
    return {
      path: rec.path,
      branch: rec.branch,
      branchLabel: rec.branch ? path.basename(rec.branch) : "detached",
      head: rec.head ? rec.head.slice(0, 12) : "",
      isMain: idx === 0,
      isCurrent: wtReal === repoReal,
      locked: rec.locked,
    } satisfies WorktreeInfo
  })
}

/**
 * Parse `git rev-list --left-right --count A...B` output ("X\tY" or "X Y").
 * Returns null when it isn't two finite integers.
 */
function parseAheadBehind(
  raw: string,
): { ahead: number; behind: number } | null {
  const parts = raw.trim().split(/\s+/)
  if (parts.length !== 2) return null
  const left = Number.parseInt(parts[0], 10)
  const right = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null
  // left = commits in default not in branch → branch is BEHIND by `left`.
  // right = commits in branch not in default → branch is AHEAD by `right`.
  return { ahead: right, behind: left }
}

/** Max local branches to enrich with ahead/behind (they are -creatordate sorted). */
const BRANCH_ENRICH_CAP = 25

/**
 * Best-effort ahead/behind vs the default branch + merged flags for local
 * branches. Mutates `branches` in place; each git call is individually guarded
 * so partial data still returns. One shared `--merged` call; ahead/behind is
 * capped to the most recently active branches.
 */
async function enrichBranchStats(
  g: SimpleGit,
  branches: BranchInfo[],
  currentBranch: string | null,
): Promise<void> {
  if (branches.length === 0) return
  const defaultBranch =
    ["main", "master", "develop"].find((n) =>
      branches.some((b) => b.name === n),
    ) ??
    currentBranch ??
    null
  if (!defaultBranch) return

  // Merged set — one shot, covers every branch.
  let mergedSet: Set<string>
  try {
    const out = await g.raw([
      "branch",
      "--merged",
      defaultBranch,
      "--format=%(refname:short)",
    ])
    mergedSet = new Set(
      out
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    )
  } catch {
    mergedSet = new Set()
  }
  for (const b of branches) b.merged = mergedSet.has(b.name)

  // Ahead/behind — capped to the most recently active branches.
  await Promise.all(
    branches.slice(0, BRANCH_ENRICH_CAP).map(async (b) => {
      if (b.name === defaultBranch) {
        b.aheadBehind = { ahead: 0, behind: 0 }
        b.merged = true
        return
      }
      try {
        const out = await g.raw([
          "rev-list",
          "--left-right",
          "--count",
          `${defaultBranch}...${b.name}`,
        ])
        const ab = parseAheadBehind(out)
        if (ab) b.aheadBehind = ab
      } catch {
        /* leave aheadBehind undefined for this branch */
      }
    }),
  )
}

/** Everything needed to populate the two ref pickers. */
export async function getRepoRefs(
  repoPath: string,
  commitLimit = 60,
): Promise<RepoRefs> {
  const g = git(repoPath)

  // Note: we prepend %(refname) (full ref) so categories can be parsed by
  // prefix unambiguously, then use %(refname:short) for display.
  const forEachRefFormat =
    "%(refname)%09%(refname:short)%09%(objectname:short)%09%(upstream:short)%09%(contents:subject)"

  // Gather everything in parallel; guard each so partial data still returns.
  const [currentBranch, refsOut, worktreeOut, commits, headOut] =
    await Promise.all([
      g
        .status()
        .then((s) => s.current ?? null)
        .catch(() => null),
      g
        .raw([
          "for-each-ref",
          // Most-recently-updated refs first (creatordate = commit date for
          // branches/remotes, tag/commit date for tags). Order is preserved
          // through parseRefs into each category.
          "--sort=-creatordate",
          `--format=${forEachRefFormat}`,
          "refs/heads",
          "refs/remotes",
          "refs/tags",
        ])
        .catch(() => ""),
      g.raw(["worktree", "list", "--porcelain"]).catch(() => ""),
      getCommits(repoPath, undefined, commitLimit),
      g
        .revparse(["--short", "HEAD"])
        .then((x) => x.trim())
        .catch(() => ""),
    ])

  const { branches, remotes, tags } = parseRefs(refsOut, currentBranch)
  const worktrees = parseWorktrees(worktreeOut, repoPath)

  // Additive, guarded enrichment: ahead/behind + merged for local branches.
  await enrichBranchStats(g, branches, currentBranch)

  return {
    branches,
    remotes,
    tags,
    worktrees,
    commits,
    currentBranch,
    head: headOut,
  }
}

/** Map a `git diff --name-status` code (A/D/M/R###/C###/T…) to our status. */
function mapStatus(code: string): DiffFileStatus {
  switch ((code || "")[0]) {
    case "A":
      return "added"
    case "D":
      return "deleted"
    case "R":
      return "renamed"
    case "C":
      // A copy produces a new file; we have no "copied" status in the contract.
      return "added"
    case "M":
    case "T":
    default:
      return "modified"
  }
}

interface NameStatusEntry {
  status: string
  path: string
  oldPath?: string
}

/** Parse NUL-delimited `git diff --name-status -z` output. */
function parseNameStatus(raw: string): NameStatusEntry[] {
  const entries: NameStatusEntry[] = []
  const tokens = raw.split("\0")
  let i = 0
  while (i < tokens.length) {
    const status = tokens[i++]
    if (!status) continue
    const head = status[0]
    if (head === "R" || head === "C") {
      const oldPath = tokens[i++] ?? ""
      const newPath = tokens[i++] ?? ""
      entries.push({
        status,
        path: newPath,
        // oldPath is only meaningful (per the contract) for renames.
        oldPath: head === "R" ? oldPath : undefined,
      })
    } else {
      const p = tokens[i++] ?? ""
      entries.push({ status, path: p })
    }
  }
  return entries
}

interface NumStat {
  additions: number
  deletions: number
  binary: boolean
}

/** Parse `git diff --numstat` output into per-file add/del counts (in order). */
function parseNumstat(raw: string): NumStat[] {
  return raw
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const f = line.split("\t")
      const aStr = f[0] ?? ""
      const dStr = f[1] ?? ""
      const binary = aStr === "-" && dStr === "-"
      return {
        additions: binary ? 0 : parseInt(aStr, 10) || 0,
        deletions: binary ? 0 : parseInt(dStr, 10) || 0,
        binary,
      } satisfies NumStat
    })
}

/**
 * Best-effort `.gitattributes linguist-generated` lookup for a set of paths.
 *
 * Runs `git check-attr linguist-generated -z -- <paths>`, which emits
 * `path\0attr\0info\0` triples; `info` is `set` / `true` when the path is marked
 * generated. Returns a set of those paths. Guarded: any failure (older git, bare
 * worktree, no paths) yields an empty set so the caller leaves `generated`
 * undefined and the client falls back to its glob list.
 */
export async function getGeneratedPaths(
  repoPath: string,
  paths: string[],
): Promise<Set<string>> {
  const generated = new Set<string>()
  if (paths.length === 0) return generated
  try {
    const out = await git(repoPath).raw([
      "check-attr",
      "linguist-generated",
      "-z",
      "--",
      ...paths,
    ])
    if (!out) return generated
    const tokens = out.split("\0")
    // Triples: path, attr, info.
    for (let i = 0; i + 2 < tokens.length; i += 3) {
      const p = tokens[i]
      const info = tokens[i + 2]
      if (p && (info === "set" || info === "true")) generated.add(p)
    }
  } catch {
    /* leave generated empty → client glob fallback */
  }
  return generated
}

/**
 * The review scope of a comparison: the branch a note filed against `compare`
 * belongs to. Review notes are stored per scope so they never leak between
 * branches.
 *
 * The working tree and the index are branch-relative — "WORKING" means
 * something different on every branch — so those sentinels (and HEAD) resolve
 * to the repo's current branch. Every other ref is its own scope. The `base`
 * side is deliberately excluded, so re-pointing the base of a comparison keeps
 * its notes.
 *
 * Never throws: an unreadable repo falls back to the raw compare string, which
 * still groups notes consistently even if it can't name the branch.
 */
export async function reviewScope(
  repoPath: string,
  compare: string,
): Promise<string> {
  if (compare !== "WORKING" && compare !== "STAGED" && compare !== "HEAD") {
    return compare
  }
  const g = git(repoPath)
  const current = await g
    .status()
    .then((s) => s.current ?? null)
    .catch(() => null)
  // simple-git reports a detached HEAD as null or the literal "HEAD".
  if (current && current !== "HEAD") return current
  const sha = await g
    .revparse(["--short", "HEAD"])
    .then((x) => x.trim())
    .catch(() => "")
  return sha ? `detached@${sha}` : compare
}

/**
 * Diff two refs. Sentinels on the `compare` side:
 *   "WORKING" → working tree vs base
 *   "STAGED"  → index vs base
 * Otherwise two committishes, compared per `mode`
 * (merge-base: `base...compare`, direct: `base compare`).
 *
 * Never throws: a failing sub-command or an empty diff yields partial/empty
 * results rather than an exception.
 */
export async function getDiff(
  repoPath: string,
  base: string,
  compare: string,
  mode: DiffMode,
  ignoreWhitespace = false,
): Promise<DiffResult> {
  const result: DiffResult = {
    base,
    compare,
    mode,
    files: [],
    patch: "",
    stats: { files: 0, additions: 0, deletions: 0 },
    truncated: false,
  }

  // Reject option-injecting refs before they reach `git diff` (WORKING/STAGED
  // are our sentinels, handled below). Graceful empty result, like a bad ref.
  if (!isSafeRef(base)) return result
  if (compare !== "WORKING" && compare !== "STAGED" && !isSafeRef(compare)) {
    return result
  }

  try {
    const g = git(repoPath)

    // Selector tokens that follow `git diff` and precede `-M`.
    let selector: string[]
    if (compare === "WORKING") selector = [base]
    else if (compare === "STAGED") selector = ["--cached", base]
    else selector = mode === "merge-base" ? [`${base}...${compare}`] : [base, compare]

    // `-w` goes right after the subcommand so it applies to patch, numstat, and
    // name-status consistently.
    const w = ignoreWhitespace ? ["-w"] : []
    const patchArgs = ["diff", ...w, ...selector, "-M"]
    const numstatArgs = ["diff", ...w, "--numstat", ...selector, "-M"]
    const nameStatusArgs = ["diff", ...w, "--name-status", "-z", ...selector, "-M"]

    const [patchOut, numstatOut, nameStatusOut] = await Promise.all([
      g.raw(patchArgs).catch(() => ""),
      g.raw(numstatArgs).catch(() => ""),
      g.raw(nameStatusArgs).catch(() => ""),
    ])

    // Full patch (capped).
    const patch = patchOut || ""
    if (patch.length > MAX_PATCH_BYTES) {
      result.patch = patch.slice(0, MAX_PATCH_BYTES)
      result.truncated = true
    } else {
      result.patch = patch
    }

    // name-status is authoritative for path/status/oldPath; numstat gives the
    // add/del counts. Both list files in the same order → zip by index.
    const entries = parseNameStatus(nameStatusOut)
    const nums = parseNumstat(numstatOut)

    const files: DiffFileSummary[] = entries.map((e, idx) => {
      const n = nums[idx] ?? { additions: 0, deletions: 0, binary: false }
      return {
        path: e.path,
        oldPath: e.oldPath,
        additions: n.additions,
        deletions: n.deletions,
        status: mapStatus(e.status),
        binary: n.binary,
      } satisfies DiffFileSummary
    })

    // Additive, best-effort: mark `.gitattributes linguist-generated` paths.
    // Never throws — undefined `generated` just means "client glob fallback".
    const generatedPaths = await getGeneratedPaths(
      repoPath,
      files.map((f) => f.path),
    )
    if (generatedPaths.size > 0) {
      for (const f of files) if (generatedPaths.has(f.path)) f.generated = true
    }

    result.files = files
    result.stats = {
      files: files.length,
      additions: files.reduce((acc, f) => acc + f.additions, 0),
      deletions: files.reduce((acc, f) => acc + f.deletions, 0),
    }

    return result
  } catch {
    // Defensive: odd/empty repos still get a valid (empty) DiffResult.
    return result
  }
}

// ── File content at a ref (blob viewer / image diff) ──────────────────────────

/** Soft cap for a single blob's bytes before it is marked truncated. */
const MAX_BLOB_BYTES = 2_000_000

/**
 * Resolve `filePath` against `repoPath`, rejecting any path that escapes the
 * repo root. Uses path.resolve (not join) so `../` traversals are caught.
 * Returns the absolute path when safe, else null.
 */
function resolveInRepo(repoPath: string, filePath: string): string | null {
  const abs = path.resolve(repoPath, filePath)
  if (abs === repoPath || abs.startsWith(repoPath + path.sep)) return abs
  return null
}

/**
 * File content at a ref, honoring getDiff's sentinels: WORKING → on-disk file,
 * STAGED → `git show :path`, else → `git show <ref>:path`. Returns null on any
 * failure / missing file. Text is truncated (utf8) at MAX_BLOB_BYTES.
 */
export async function getFileAtRef(
  repoPath: string,
  ref: string,
  filePath: string,
): Promise<{ content: string; truncated: boolean } | null> {
  let content: string
  try {
    if (ref === "WORKING") {
      const guard = resolveInRepo(repoPath, filePath)
      if (!guard) return null
      content = await readFile(guard, "utf8")
    } else if (ref === "STAGED") {
      content = await git(repoPath).raw(["show", `:${filePath}`])
    } else {
      if (!isSafeRef(ref)) return null
      content = await git(repoPath).raw(["show", `${ref}:${filePath}`])
    }
  } catch {
    return null
  }

  if (content.length > MAX_BLOB_BYTES) {
    return { content: content.slice(0, MAX_BLOB_BYTES), truncated: true }
  }
  return { content, truncated: false }
}

/**
 * Raw file bytes at a ref (for binary/image blobs). simple-git's `.raw` returns
 * a utf8 string and corrupts binary, so this spawns `git` and captures a Buffer.
 * Honors the same sentinels as getFileAtRef. Never throws → null on any failure.
 * Bytes are capped at MAX_BLOB_BYTES (the child is killed once exceeded).
 */
export async function getFileBytesAtRef(
  repoPath: string,
  ref: string,
  filePath: string,
): Promise<Buffer | null> {
  if (ref === "WORKING") {
    const guard = resolveInRepo(repoPath, filePath)
    if (!guard) return null
    try {
      return await readFile(guard)
    } catch {
      return null
    }
  }

  if (ref !== "STAGED" && !isSafeRef(ref)) return null
  const spec = ref === "STAGED" ? `:${filePath}` : `${ref}:${filePath}`
  return await new Promise<Buffer | null>((resolve) => {
    let settled = false
    const done = (value: Buffer | null) => {
      if (settled) return
      settled = true
      resolve(value)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn("git", ["show", spec], { cwd: repoPath })
    } catch {
      done(null)
      return
    }

    const chunks: Buffer[] = []
    let total = 0
    child.stdout?.on("data", (chunk: Buffer) => {
      chunks.push(chunk)
      total += chunk.length
      if (total > MAX_BLOB_BYTES) {
        // Cap reached: kill the child and return the truncated buffer.
        child.kill()
        done(Buffer.concat(chunks).subarray(0, MAX_BLOB_BYTES))
      }
    })
    child.on("error", () => done(null))
    child.on("close", (code) => {
      done(code === 0 ? Buffer.concat(chunks) : null)
    })
  })
}

// ── Blame (porcelain, per source line) ────────────────────────────────────────

/** Porcelain blame header: `<40-sha> <origLine> <finalLine>[ <count>]`. */
const BLAME_HEADER = /^([0-9a-f]{40}) \d+ (\d+)( \d+)?$/

/**
 * Per-line blame for a file at a ref. WORKING/STAGED both blame the on-disk
 * working file; else blames at `<ref>`. Index i corresponds to source line i+1.
 * Never throws → returns [] on any failure (graceful, like getSymbols).
 */
export async function getBlame(
  repoPath: string,
  ref: string,
  filePath: string,
): Promise<BlameLine[]> {
  if (ref === "WORKING" || ref === "STAGED") {
    // Both sentinels blame the on-disk file — guard the path first.
    if (!resolveInRepo(repoPath, filePath)) return []
  } else if (!isSafeRef(ref)) {
    // Non-sentinel ref is passed positionally before '--' → reject option-like
    // values (defense in depth; blame lacks a write-capable option).
    return []
  }

  let out: string
  try {
    const args =
      ref === "WORKING" || ref === "STAGED"
        ? ["blame", "--porcelain", "--", filePath]
        : ["blame", "--porcelain", ref, "--", filePath]
    out = await git(repoPath).raw(args)
  } catch {
    return []
  }

  // Porcelain emits full metadata only the first time a sha appears; later
  // occurrences repeat just the header. Cache metadata keyed by sha.
  const meta = new Map<string, Partial<BlameLine>>()
  const result: BlameLine[] = []

  const lines = out.split("\n")
  let curSha: string | null = null
  let curFinal = 0

  for (const line of lines) {
    const header = BLAME_HEADER.exec(line)
    if (header) {
      curSha = header[1]
      curFinal = Number.parseInt(header[2], 10)
      if (!meta.has(curSha)) meta.set(curSha, { sha: curSha })
      continue
    }
    if (!curSha) continue
    const m = meta.get(curSha)!
    if (line.startsWith("author ")) {
      m.author = line.slice("author ".length)
    } else if (line.startsWith("author-time ")) {
      const sec = Number.parseInt(line.slice("author-time ".length), 10)
      if (Number.isFinite(sec)) m.dateIso = new Date(sec * 1000).toISOString()
    } else if (line.startsWith("summary ")) {
      m.summary = line.slice("summary ".length)
    } else if (line.startsWith("\t")) {
      // Content line: emit the blame entry for this final line number.
      if (Number.isFinite(curFinal) && curFinal > 0) {
        result[curFinal - 1] = {
          sha: curSha,
          shortSha: curSha.slice(0, 7),
          author: m.author ?? "",
          dateIso: m.dateIso ?? "",
          summary: m.summary ?? "",
        }
      }
    }
  }

  return result
}
