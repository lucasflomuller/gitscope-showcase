/**
 * GitScope shared types — the single source of truth for the data contract
 * between the git backend (lib), the API routes, and the UI components.
 *
 * This file is pure types: it has NO runtime imports and is safe to import
 * from both server and client code.
 */

// ────────────────────────────────────────────────────────────────────────────
// Repo configuration & status
// ────────────────────────────────────────────────────────────────────────────

/** A repository the user has registered, as persisted in the config file. */
export interface RepoConfig {
  /** Stable id derived from the absolute path (see lib/config.ts:repoId). */
  id: string;
  /** Absolute path to the repository working directory (contains .git). */
  path: string;
  /** Display name (defaults to the directory basename, user-overridable). */
  name: string;
  /** ISO timestamp of when it was added. */
  addedAt: string;
}

/** Working-tree status summary for the sidebar. */
export interface RepoStatus {
  /** Current branch name, or short sha when detached. */
  current: string | null;
  /** Upstream tracking ref, e.g. "origin/main", or null. */
  tracking: string | null;
  ahead: number;
  behind: number;
  staged: number;
  unstaged: number;
  untracked: number;
  conflicted: number;
  /** True when there are no staged/unstaged/untracked changes. */
  clean: boolean;
  /**
   * ISO 8601 timestamp of the most recent activity: the later of the HEAD
   * committer date and the newest mtime among changed working-tree files.
   * Null when unknown (e.g. a repo with no commits). Powers the dashboard's
   * "most-recently-touched" sort. Additive — never required by older clients.
   */
  lastActivity: string | null;
}

/** A repo enriched with validity + live status, returned by GET /api/repos. */
export interface RepoSummary extends RepoConfig {
  /** True when the path exists and is a git repository. */
  ok: boolean;
  /** Human-readable error when ok === false. */
  error?: string;
  /** Present only when ok === true. */
  status?: RepoStatus;
}

// ────────────────────────────────────────────────────────────────────────────
// Refs (branches, tags, worktrees, commits)
// ────────────────────────────────────────────────────────────────────────────

export type RefKind =
  | "branch" // local branch
  | "remote" // remote-tracking branch
  | "tag"
  | "commit" // an explicit commit sha
  | "worktree" // a linked worktree's HEAD
  | "working" // the working tree (uncommitted changes) — sentinel ref "WORKING"
  | "staged" // the index — sentinel ref "STAGED"
  | "head"; // HEAD — sentinel ref "HEAD"

/**
 * A selectable ref. `ref` is the exact token passed to the diff API
 * (a branch name, tag, sha, or a sentinel: "WORKING" | "STAGED" | "HEAD").
 */
export interface RefInfo {
  kind: RefKind;
  ref: string;
  label: string;
  /** Optional secondary line: short sha, commit subject, worktree path, etc. */
  subtitle?: string;
}

export interface BranchInfo {
  name: string;
  current: boolean;
  isRemote: boolean;
  /** Short sha of the branch tip. */
  commit: string;
  /** Subject line of the tip commit, when available. */
  subject?: string;
  /** Upstream tracking ref for local branches, when set. */
  tracking?: string;
  /**
   * Ahead/behind the repo's default branch (main|master|develop). Computed for
   * up to 25 local branches, individually guarded; absent when unknown.
   */
  aheadBehind?: { ahead: number; behind: number };
  /** True when this branch is fully merged into the default branch. */
  merged?: boolean;
}

export interface TagInfo {
  name: string;
  /** Short sha the tag points at. */
  commit: string;
  subject?: string;
}

export interface WorktreeInfo {
  /** Absolute path of the worktree. */
  path: string;
  /** Branch ref (e.g. "refs/heads/feature") or undefined when detached. */
  branch?: string;
  /** Short, human label for the branch ("feature" or "detached"). */
  branchLabel: string;
  /** Short sha of the worktree HEAD. */
  head: string;
  /** True for the primary working tree. */
  isMain: boolean;
  /** True when this worktree path equals the registered repo path. */
  isCurrent: boolean;
  locked: boolean;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  subject: string;
  author: string;
  email: string;
  /** ISO timestamp. */
  date: string;
  /** Relative date, e.g. "3 days ago". */
  relativeDate: string;
  /** Ref decorations, e.g. "HEAD -> main, origin/main". */
  refs?: string;
}

/** Everything needed to populate the two ref pickers, from GET …/refs. */
export interface RepoRefs {
  branches: BranchInfo[];
  remotes: BranchInfo[];
  tags: TagInfo[];
  worktrees: WorktreeInfo[];
  /** Recent commits for the "commit" picker (most recent first). */
  commits: CommitInfo[];
  currentBranch: string | null;
  /** Short sha of current HEAD. */
  head: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Diff
// ────────────────────────────────────────────────────────────────────────────

/** How two refs are compared. */
export type DiffMode = "merge-base" | "direct";
// merge-base  → `git diff base...compare` (what a PR shows)
// direct      → `git diff base compare`  (raw tree-to-tree)

export type DiffFileStatus = "added" | "deleted" | "modified" | "renamed";

export interface DiffFileSummary {
  /** Target path (or original path when deleted). */
  path: string;
  /** Original path, present only on renames. */
  oldPath?: string;
  additions: number;
  deletions: number;
  status: DiffFileStatus;
  binary: boolean;
  /**
   * Optional, additive: true when `.gitattributes` marks the path
   * `linguist-generated` (via `git check-attr`). Absent/undefined means the
   * signal didn't run or wasn't set; the client then falls back to its built-in
   * generated/lockfile glob list. Backward-compatible — never required.
   */
  generated?: boolean;
}

export interface DiffResult {
  /** Echoed, resolved labels for what was compared. */
  base: string;
  compare: string;
  mode: DiffMode;
  files: DiffFileSummary[];
  /** Full unified diff text; parse client-side with `parse-diff`. */
  patch: string;
  stats: { files: number; additions: number; deletions: number };
  /** True when the patch was capped for size. */
  truncated: boolean;
  /**
   * Optional, additive: the pre-flight safety scan of the diff's ADDED lines.
   * Absent when the scan didn't run; the UI renders the diff unchanged in that
   * case. Computed server-side inside the diff route (see lib/preflight.ts).
   */
  preflight?: PreflightReport;
}

// ────────────────────────────────────────────────────────────────────────────
// Pre-flight safety check (local static secret + leftover scan of added lines)
// ────────────────────────────────────────────────────────────────────────────

/** Two-tier severity: secrets block (red), leftovers warn (amber). */
export type PreflightSeverity = "blocker" | "warning";

/** What kind of thing a finding is. Drives the summary counts + grouping. */
export type PreflightCategory = "secret" | "leftover";

/**
 * Stable identifiers for every rule in the curated rule table
 * (see lib/preflight.ts). Used for per-rule allowlisting + display titles.
 */
export type PreflightRuleId =
  // ── secrets ──────────────────────────────────────────────────────────────
  | "private-key"
  | "aws-access-key-id"
  | "aws-secret-access-key"
  | "github-token"
  | "slack-token"
  | "slack-webhook"
  | "google-api-key"
  | "google-oauth-client-id"
  | "stripe-secret-key"
  | "stripe-test-key"
  | "openai-api-key"
  | "anthropic-api-key"
  | "jwt"
  | "sendgrid-api-key"
  | "twilio-account-sid"
  | "npm-token"
  | "gitlab-pat"
  | "generic-secret"
  | "env-secret"
  | "high-entropy-base64"
  | "high-entropy-hex"
  // ── leftovers ────────────────────────────────────────────────────────────
  | "console-log"
  | "debugger"
  | "debug-print"
  | "python-debugger"
  | "todo-comment"
  | "test-focus"
  | "test-skip"
  | "merge-conflict";

/** A single thing the scan flagged on one added line. */
export interface PreflightFinding {
  /**
   * Stable hash of `ruleId|path|line|maskedSnippet`. Used both as the React key
   * and as the allowlist target for per-finding "Ignore". Because it folds in
   * the line + snippet, a stale ignore simply stops matching once the line moves.
   */
  id: string;
  ruleId: PreflightRuleId;
  category: PreflightCategory;
  severity: PreflightSeverity;
  /** Short human title, e.g. "AWS secret access key". */
  title: string;
  /** One-line plain-language explanation. */
  detail: string;
  /** New-side file path the added line belongs to. */
  path: string;
  /** New-side (post-image) line number of the added line. */
  line: number;
  /**
   * The added line, trimmed/windowed for display. Secret values are MASKED here
   * (server-side, before transport); leftover snippets are shown verbatim.
   */
  snippet: string;
  /** Character range within `snippet` to highlight (the matched/masked token). */
  match?: { start: number; end: number };
}

/** Roll-up counts + flags for the scan, surfaced in the summary chip/panel. */
export interface PreflightSummary {
  /** Count of category === "secret" findings (active + ignored). */
  secrets: number;
  /** Count of category === "leftover" findings (active + ignored). */
  leftovers: number;
  /** secrets + leftovers. */
  total: number;
  /** True when the underlying diff was truncated (findings may be missing). */
  truncated: boolean;
  /** True when findings were capped (very large/pathological diff). */
  capped?: boolean;
}

/** Per-repo suppression lists, persisted at ~/.config/gitscope/preflight.json. */
export interface PreflightAllowlist {
  /** Suppressed individual findings, by stable finding id. */
  ignoredIds: string[];
  /** Suppressed whole rules, by rule id ("Ignore this rule in this repo"). */
  ignoredRuleIds: string[];
}

/**
 * The pre-flight scan result that rides along inside DiffResult. Findings are
 * returned UNFILTERED (active + ignored) alongside the allowlist snapshot, so
 * the client can toggle ignore state instantly without re-fetching the diff.
 */
export interface PreflightReport {
  findings: PreflightFinding[];
  summary: PreflightSummary;
  allowlist: PreflightAllowlist;
}

// ────────────────────────────────────────────────────────────────────────────
// Review comments (line / block / whole-file notes → "Copy for AI" worklist)
// ────────────────────────────────────────────────────────────────────────────

/**
 * A review note the user attached while reading a diff. Persisted per-repo at
 * ~/.config/gitscope/comments.json and re-anchored to the CURRENT diff by
 * content hash, so it survives line shifts. Additive — never required by the
 * diff contract; the comments feature layers entirely on top of it.
 */
export interface Comment {
  /** Short random id (client-generated). */
  id: string;
  /** New-side file path (the diff's display path). */
  path: string;
  /** New-side start line, 1-based. 0 for a whole-file note. */
  startLine: number;
  /** New-side end line (== startLine for a single line; 0 for whole-file). */
  endLine: number;
  /**
   * sha1 over `path + " " + <normalized commented line text(s)>`, where the
   * normalized text strips each line's leading +/-/space diff marker and
   * trailing whitespace and joins with "\n". Empty text for whole-file notes.
   */
  anchorHash: string;
  /** The note body (Markdown-ish free text). */
  body: string;
  /** ISO timestamp of creation. */
  createdAt: string;
  /** ISO timestamp of the last edit, when edited. */
  updatedAt?: string;
  /**
   * Lifecycle state. Absent = "open" (back-compat with pre-lifecycle notes).
   * "addressed" is set by an agent that believes it acted on the note (via MCP
   * or the worklist); "resolved" is the human sign-off.
   */
  state?: CommentState;
  /** Who filed the note. Absent = "user". AI pre-review files as "ai". */
  source?: CommentSource;
  /**
   * Review scope: the branch this note was filed against. Resolved server-side
   * from the compare side by `reviewScope` — WORKING/STAGED/HEAD become the
   * repo's current branch, any other ref is its own scope — so a note follows a
   * branch from uncommitted work through to its committed diff, but never
   * crosses to a different branch. The base ref is deliberately not part of the
   * scope, so re-basing a comparison keeps its notes. Absent only on notes
   * written before scoping existed; those are hidden from every scoped read.
   */
  ref?: string;
  /** Optional note attached on the last state change (e.g. what the agent did). */
  stateNote?: string;
}

/** Comment lifecycle: open → addressed (agent) → resolved (human). */
export type CommentState = "open" | "addressed" | "resolved";

/** Origin of a note: the reviewing human, or an AI pre-review/agent. */
export type CommentSource = "user" | "ai";

// ────────────────────────────────────────────────────────────────────────────
// Review guide — an AI-authored reading order for a comparison (via MCP/CLI)
// ────────────────────────────────────────────────────────────────────────────

/**
 * One semantic chunk of a review guide: a titled, explained group of files
 * meant to be read together (Linear-style "Guide" sections).
 */
export interface GuideSection {
  /** Stable id (server-generated when absent on submit). */
  id: string;
  /** Short section heading, e.g. "Forecast boundary and CI gate". */
  title: string;
  /** Prose explanation of what this chunk does and what to scrutinise. */
  explanation: string;
  /** Ordered diff file paths belonging to this section. */
  paths: string[];
}

/**
 * An AI-generated review guide for one comparison, persisted per repo at
 * ~/.config/gitscope/guides.json and keyed by the same compareKey format the
 * viewed/checkpoint stores use (`${mode}:${base}...${compare}`). Additive —
 * the diff renders identically when no guide exists.
 */
export interface ReviewGuide {
  id: string;
  compareKey: string;
  /** One-line guide title (defaults to the comparison label). */
  title: string;
  /** Optional overall summary of the change set. */
  summary?: string;
  /** Reading order: sections are reviewed top to bottom. */
  sections: GuideSection[];
  /** How the guide was produced: an MCP agent or the local claude CLI. */
  generatedBy: "mcp" | "cli";
  createdAt: string;
}

/** Response of GET /api/repos/[id]/guide. */
export interface GuideResponse {
  guide: ReviewGuide | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Symbol outline (tree-sitter, ref-correct — parsed from the COMPARE-side blob)
// ────────────────────────────────────────────────────────────────────────────

/**
 * The kinds of declaration the tree-sitter walker surfaces. Phase 1 covers the
 * JS/TS family only; everything else is a graceful no-op (empty symbol list).
 */
export type SymbolKind =
  | "function"
  | "method"
  | "class"
  | "interface"
  | "type"
  | "enum"
  | "component";

/**
 * One declaration found in the compare-side file content. Line numbers are
 * 1-based and inclusive, in the NEW-side (compare-ref) coordinate space — the
 * same space as a parsed diff's added/context line numbers, so they line up
 * exactly with the diff being shown. `depth` is the nesting level (0 =
 * top-level) used to render the outline as an indented tree.
 */
export interface SymbolNode {
  name: string;
  kind: SymbolKind;
  startLine: number;
  endLine: number;
  depth: number;
}

/** Response of POST /api/repos/[id]/symbols. `lang` is null for unsupported files. */
export interface SymbolsResponse {
  symbols: SymbolNode[];
  lang: string | null;
}

// ────────────────────────────────────────────────────────────────────────────
// Blast radius (references) — `git grep` at the compare ref, tree-sitter-filtered
// ────────────────────────────────────────────────────────────────────────────

/**
 * One textual reference to a symbol, found by `git grep` at the compare ref and
 * kept only when tree-sitter says it's real code (not a comment/string). Line is
 * 1-based new-side; `column` is the 0-based index of the name within `text`.
 */
export interface RefHit {
  path: string;
  line: number;
  column: number;
  /** The full matched source line, verbatim. */
  text: string;
}

/** Response of POST /api/repos/[id]/references. */
export interface ReferencesResponse {
  references: RefHit[];
  /** Hit count after the comment/string filter (before the display cap). */
  total: number;
  /** True when the list was capped (showing the first MAX_HITS). */
  capped: boolean;
  /** The identifier that was searched (echoed for the panel header). */
  name: string;
}

// ────────────────────────────────────────────────────────────────────────────
// GitHub Pull Request status (per-branch, best-effort via `gh pr list`)
// ────────────────────────────────────────────────────────────────────────────

/**
 * A PR's effective state — `draft` folds out of OPEN + isDraft. The UI switches
 * on this (state, never `status`). Derived server-side from gh's
 * state ("OPEN" | "CLOSED" | "MERGED") + isDraft in lib/pulls.ts.
 */
export type PrState = "open" | "draft" | "merged" | "closed";

/**
 * GitHub's review decision, verbatim (GitHub-native UPPERCASE). `gh` emits the
 * empty string "" when there is no decision; the server normalizes "" → null
 * before transport, so this is never the empty string on the wire.
 */
export type PrReviewDecision =
  | "APPROVED"
  | "CHANGES_REQUESTED"
  | "REVIEW_REQUIRED";

/**
 * The single primary PR chosen for a branch (selection rule in lib/pulls.ts:
 * open > draft > merged > closed, tie-break updatedAt desc then number desc).
 */
export interface PrInfo {
  /** PR number, e.g. 4 → label "#4". */
  number: number;
  /** Normalized state (open | draft | merged | closed). */
  state: PrState;
  /** PR title (tooltip / aria-label only). */
  title: string;
  /** Full https URL to the PR (opened in a new tab). */
  url: string;
  /** Review decision, or null when GitHub reports none (gh's ""). */
  reviewDecision: PrReviewDecision | null;
  /** The PR's base branch, e.g. "main" (tooltip enrichment). */
  baseRefName: string;
  /** ISO timestamp of last update (recency tiebreak in selection). */
  updatedAt: string;
  /** Additional PRs for this same head branch beyond the primary (≥ 0). */
  extra: number;
}

/**
 * Response of GET /api/repos/[id]/prs, keyed by headRefName for O(1) lookup.
 * `available` is false for EVERY non-GitHub / no-gh / failure case (it is never
 * an error); `available:true` with `prs:{}` means "GitHub repo, no matching PRs".
 */
export interface PullsResponse {
  available: boolean;
  /** "owner/name" of the resolved GitHub repo, when available. */
  repo?: string;
  /** headRefName → its primary PR. */
  prs: Record<string, PrInfo>;
}

// ────────────────────────────────────────────────────────────────────────────
// Blame layer (porcelain `git blame`, per source line)
// ────────────────────────────────────────────────────────────────────────────

/** Blame metadata for a single source line. */
export interface BlameLine {
  sha: string;
  shortSha: string;
  author: string;
  dateIso: string;
  summary: string;
}

/** Response of GET /api/repos/[id]/blame. Index i = source line i+1. */
export interface BlameResponse {
  lines: BlameLine[];
}

// ────────────────────────────────────────────────────────────────────────────
// API helpers
// ────────────────────────────────────────────────────────────────────────────

/** File content at a ref (text mode of GET /api/repos/[id]/blob). */
export interface BlobResponse {
  content: string;
  truncated?: boolean;
}

/** Standard JSON error envelope returned by API routes on failure. */
export interface ApiError {
  error: string;
}
