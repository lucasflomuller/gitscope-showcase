# GitScope — Build Contract (read this fully before writing code)

GitScope is a **local, single-user** Next.js tool that points at multiple local
git repositories and lets you eyeball diffs between any two refs (branches, tags,
worktrees, commits, the working tree, the index) — to "situate yourself" on a
change before opening a PR.

You are ONE of several agents building this in parallel. Stay strictly inside the
files assigned to you. Do not edit shared/owned-by-others files. The pieces are
wired together by the integrator afterwards.

## Stack (already installed — do NOT install anything)
- Next.js **16.2.9** (App Router, `src/` dir, import alias `@/*` → `src/*`)
- React 19, TypeScript, Tailwind **v4**, shadcn/ui (style "base-nova", neutral)
- `simple-git`, `parse-diff`, `swr`, `next-themes`, `server-only` — all present
- Icons: `lucide-react`. shadcn components live in `src/components/ui/*`
  (available: button, card, dialog, select, input, label, scroll-area,
  separator, badge, tabs, dropdown-menu, sonner, tooltip, skeleton, command,
  popover, switch, alert, resizable, textarea, input-group).

## NEXT.JS 16 RULES (this is NOT the Next you remember)
- Route handler dynamic params are a **Promise**:
  ```ts
  export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
    const { id } = await ctx.params
  }
  ```
- Read query params from `req.nextUrl.searchParams` (NextRequest) — import
  `NextRequest`, `NextResponse` from `next/server`. Return `NextResponse.json(...)`.
- Route handlers are **NOT cached by default** (good — git state changes). Do not
  add `force-static`. You may add `export const dynamic = "force-dynamic"` for clarity.
- Server-only modules (`src/lib/git.ts`, `src/lib/config.ts`) must `import "server-only"`
  on the first line so they can never be bundled into client code.

## SHARED TYPES — the single source of truth
`src/lib/types.ts` already exists and is authoritative. Import all data shapes
from `@/lib/types`. Do NOT redefine these types. Read that file before coding.
Key types: `RepoConfig, RepoStatus, RepoSummary, RefKind, RefInfo, BranchInfo,
TagInfo, WorktreeInfo, CommitInfo, RepoRefs, DiffMode, DiffFileStatus,
DiffFileSummary, DiffResult, ApiError`.

Sentinel refs (the `ref` string on a `RefInfo`): `"WORKING"` (working tree),
`"STAGED"` (index), `"HEAD"`. Everything else is a literal branch/tag/sha.

---

## FILE OWNERSHIP MAP

| Agent | Owns (create/edit ONLY these) |
|-------|-------------------------------|
| **git-core** | `src/lib/git.ts`, `src/lib/config.ts` |
| **api**      | `src/app/api/repos/route.ts`, `src/app/api/repos/[id]/route.ts`, `src/app/api/repos/[id]/refs/route.ts`, `src/app/api/repos/[id]/diff/route.ts`, `src/app/api/repos/[id]/commits/route.ts` |
| **diff-ui**  | everything under `src/components/diff/` |
| **repo-ui**  | `src/components/repo-sidebar.tsx`, `src/components/add-repo-dialog.tsx`, `src/components/ref-picker.tsx`, `src/components/compare-bar.tsx` |

The integrator owns: `types.ts`, `globals.css`, `layout.tsx`, `page.tsx`,
`providers.tsx`, `theme-toggle.tsx`, `src/hooks/*`. Do not touch those.

Do NOT run `bun build`, `next dev`, or `tsc` — integration happens later and a
partial typecheck will fail on not-yet-written modules. Just write correct,
well-typed code against this contract.

---

## CONTRACT: `git-core`  (`src/lib/git.ts` + `src/lib/config.ts`)

### `src/lib/config.ts`
Persists the repo list as JSON at `~/.config/gitscope/repos.json`.
```ts
import "server-only"
export const CONFIG_DIR: string          // path.join(os.homedir(), ".config", "gitscope")
export const CONFIG_PATH: string         // path.join(CONFIG_DIR, "repos.json")
export function repoId(absPath: string): string                // sha1(absPath).hex slice(0,12)
export async function readConfig(): Promise<RepoConfig[]>       // [] if file missing/corrupt
export async function writeConfig(repos: RepoConfig[]): Promise<void>   // mkdir -p, pretty JSON
export async function getRepo(id: string): Promise<RepoConfig | undefined>
export async function addRepo(input: { path: string; name?: string }): Promise<RepoConfig>
export async function removeRepo(id: string): Promise<void>
```
`addRepo`: expand a leading `~`, `path.resolve` to absolute, verify it exists and
is a directory and contains a `.git` entry (a worktree's `.git` is a FILE, the
main repo's is a DIR — accept both via `fs.existsSync(path.join(abs, ".git"))`).
Throw `new Error("...")` with a clear message otherwise. Dedup by `repoId`
(return the existing entry if already present). `name` defaults to `path.basename(abs)`.

### `src/lib/git.ts`
```ts
import "server-only"
import simpleGit, { type SimpleGit } from "simple-git"
export function git(repoPath: string): SimpleGit   // simpleGit({ baseDir: repoPath, maxConcurrentProcesses: 6 })
export async function isGitRepo(repoPath: string): Promise<boolean>
export async function getRepoStatus(repoPath: string): Promise<RepoStatus>
export async function getRepoRefs(repoPath: string, commitLimit?: number): Promise<RepoRefs>  // default 60
export async function getCommits(repoPath: string, ref?: string, limit?: number): Promise<CommitInfo[]>  // default 60
export async function getDiff(repoPath: string, base: string, compare: string, mode: DiffMode): Promise<DiffResult>
```
Implementation guidance:
- `getRepoStatus`: use `git(p).status()`. Map: `current`, `tracking`, `ahead`,
  `behind`, `staged = files staged count`, `unstaged = modified not staged`,
  `untracked = not_added.length`, `conflicted = conflicted.length`,
  `clean = isClean()`. Be defensive about simple-git's StatusResult fields.
- `getRepoRefs`: gather in parallel:
  - branches/remotes/tags via `git(p).raw(["for-each-ref", "--format=%(refname:short)%09%(objectname:short)%09%(upstream:short)%09%(contents:subject)", "refs/heads", "refs/remotes", "refs/tags"])` then parse by prefix; mark `current` using the status' current branch. Skip `*/HEAD` remote pointer rows.
  - worktrees via `git(p).raw(["worktree", "list", "--porcelain"])`, parse records
    (`worktree <path>`, `HEAD <sha>`, `branch refs/heads/<b>` or `detached`,
    `bare`, `locked`). `isMain` = first record. `isCurrent` = realpath equals repoPath.
    `branchLabel` = branch basename or `"detached"`.
  - commits via `getCommits(p, undefined, commitLimit)`.
  - `currentBranch`, `head` (short sha via `revparse(["--short","HEAD"])`).
  - Any sub-call may fail on an empty/odd repo — guard each so partial data still returns.
- `getCommits`: `git(p).raw(["log", ref ?? "HEAD", `--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%cr%x1f%D`, "-n", String(limit), "--"])`. Split lines, split fields on `\x1f`. Map to `CommitInfo` (`date`=%aI, `relativeDate`=%cr, `refs`=%D trimmed or undefined). Return `[]` if log fails (e.g. no commits yet).
- `getDiff`: build the diff args from the sentinels:
  - `compare === "WORKING"` → working tree vs `base`: args `["diff", base, "-M"]`
  - `compare === "STAGED"`  → index vs `base`:        args `["diff", "--cached", base, "-M"]`
  - else (two committishes): `mode === "merge-base"` → `["diff", `${base}...${compare}`, "-M"]`, `mode === "direct"` → `["diff", base, compare, "-M"]`
  Run `git(p).raw([...args])` for the full patch (cap at ~1.5 MB → set `truncated`).
  Run the same args plus `--numstat` and `--name-status` (or `--numstat` alone +
  `--name-status -M`) to build `DiffFileSummary[]`: numstat gives additions/deletions
  (`-` `-` ⇒ binary), name-status gives `A/D/M/R###` ⇒ status (+ oldPath on `R`).
  Aggregate `stats`. Echo resolved `base`/`compare`/`mode`. Never throw on an empty
  diff — return empty `files`, `patch:""`, zeroed stats.

---

## CONTRACT: `api`  (`src/app/api/...`)
Thin handlers over `git-core`. Always `try/catch` → `NextResponse.json({ error }, { status })`.
Resolve the repo with `getRepo(id)`; if undefined → 404 `{ error: "Repo not found" }`.

- `repos/route.ts`
  - `GET`  → `RepoSummary[]`: `readConfig()`, then for each repo: `ok = await isGitRepo(path)`; if ok attach `status = await getRepoStatus(path)`, else `error`. Guard each repo in its own try/catch so one bad repo doesn't 500 the list.
  - `POST` → body `{ path: string; name?: string }`: `addRepo(...)`, then return the new `RepoSummary` (compute ok+status). 400 `{ error }` on failure.
- `repos/[id]/route.ts`
  - `DELETE` → `removeRepo(id)` → `NextResponse.json({ ok: true })`.
- `repos/[id]/refs/route.ts`
  - `GET` → `getRepoRefs(repo.path)` → `RepoRefs`. `BranchInfo` now carries two
    optional, individually-guarded fields on **local** branches: `aheadBehind
    { ahead, behind }` (vs the repo's default branch — `main`/`master`/`develop`
    if present, else the current branch — computed for the 25 most-recent local
    branches) and `merged: boolean` (from a single `git branch --merged` call).
    `ahead` = commits on the branch not in the default branch; `behind` = the
    reverse. The default branch itself reports `{ ahead: 0, behind: 0 }` + `merged`.
- `repos/[id]/diff/route.ts`
  - `GET` → query: `base` (required), `compare` (required), `mode` (`"merge-base"|"direct"`, default `"merge-base"`), `whitespace?` (`"ignore"` applies a git-level `-w` consistently to the patch, numstat, and name-status). Missing base/compare → 400. → `getDiff(...)` → `DiffResult`.
- `repos/[id]/commits/route.ts`
  - `GET` → query: `ref?`, `limit?` (default 60) → `getCommits(...)` → `CommitInfo[]`.
  - Range mode: when **both** `base` and `compare` are present, returns the commits
    in `base..compare` newest-first as a bare `CommitInfo[]` (`limit` capped at 100).
    Without both params, the existing `ref`/`limit` behavior is unchanged.
- `repos/[id]/blob/route.ts`
  - `GET` → query: `ref` (required), `path` (required), `raw?`. Text mode →
    `BlobResponse { content: string; truncated?: boolean }` (utf-8, capped at a 2 MB
    soft limit → `truncated: true`). `raw=1` → the raw bytes with an
    extension-mapped image `Content-Type` (png/jpg/jpeg/gif/webp/svg/ico/bmp/avif,
    else `application/octet-stream`) and `Cache-Control: no-store`. Missing
    ref/path → 400; not found or a path that escapes the repo root (traversal
    guarded via `path.resolve`) → 404.
- `repos/[id]/blame/route.ts`
  - `GET` → query: `ref` (required), `path` (required) → `BlameResponse
    { lines: BlameLine[] }` where `BlameLine = { sha, shortSha, author, dateIso,
    summary }` and index `i` = source line `i+1`. Blames the on-disk file for
    `WORKING`/`STAGED`. Returns `{ lines: [] }` on any failure (untracked/deleted/
    parse error); callers must guard by index (the array may have gaps).

---

## CLIENT CONTRACT — URL scheme & persisted prefs (stages 1–4)

### Shareable URL scheme
The selection state round-trips through the query string with a fixed param order:

```
?repo=<id>&base=<kind>:<ref>&compare=<kind>:<ref>&mode=merge-base|direct&file=<path>
```

`<kind>` is a `RefKind` (`branch|remote|tag|commit|worktree|working|staged|head`);
`<ref>` is the sentinel or literal ref (first `:` splits kind from ref). On load the
URL **wins over localStorage**. Repo changes `pushState`; every other change
`replaceState` (so back/forward walk repos, not every keystroke). Codec lives in
`src/lib/url-state.ts` (pure) and is read via `src/hooks/use-url-search.ts`
(`useSyncExternalStore` over `location.search`, not `useSearchParams`).

### Notable localStorage keys
Beyond the existing view/sort prefs, stages 1–4 added:

- `gitscope.ignoreWhitespace` — the git-level `-w` toggle (default `false`).
- `gitscope.checkpoints.<repoId>` — per-comparison review checkpoints (snapshots of
  added-line hashes, keyed `"<mode>:<base>...<compare>"`).
- `gitscope.onlyNew` — the "Only new" (since-checkpoint) review filter.
- `gitscope.hideViewed` — the "Hide viewed files" file-tree group toggle.

---

## CONTRACT: `diff-ui`  (`src/components/diff/*`)  — all `"use client"`
Parse `result.patch` with `parse-diff` (`import parseDiff from "parse-diff"`). Its shapes:
```ts
File  = { chunks: Chunk[]; additions: number; deletions: number; from?: string; to?: string; deleted?: true; new?: true; index?: string[] }
Chunk = { content: string; changes: Change[]; oldStart; oldLines; newStart; newLines }
Change = { type: "normal"; ln1; ln2; content } | { type: "add"; ln; content } | { type: "del"; ln; content }
```
(`content` includes the leading ` `/`+`/`-` marker char.)

Build these components:
- `diff-viewer.tsx` — `export function DiffViewer({ result }: { result: DiffResult })`.
  Top toolbar: overall stats (files changed, `+additions` green, `−deletions` red)
  and a unified/split toggle (use `Tabs` or two `Button`s; local `useState`).
  Below: a left **file list** panel (resizable or fixed ~280px, `ScrollArea`) +
  a right scrollable panel showing either the selected file or all files stacked.
  Recommended: show the selected file's full diff on the right; clicking a file in
  the list selects it. Default-select the first file. Handle empty patch with a
  friendly "No changes between these refs." empty state. Show "Binary file" when a
  file has no chunks. Respect `result.truncated` with a small notice.
- `diff-file-list.tsx` — `export function DiffFileList({ files, selectedPath, onSelect }: { files: ParsedFile[]; selectedPath: string | null; onSelect: (path: string) => void })` where `ParsedFile = ReturnType<typeof parseDiff>[number]`. Row = status icon + path (truncate middle/left, title attr) + `DiffStatBar` + `+n −m`. Highlight selected (`bg-accent`).
- `diff-file.tsx` — `export function DiffFile({ file, view }: { file: ParsedFile; view: "unified" | "split" })`. Sticky file header (path, +/-). For each chunk render a `diff-hunk-header` row with the `@@` content, then lines. **unified**: a grid/table with 2 gutter columns (old ln, new ln) + content; apply `diff-line-add`/`diff-line-del` to changed rows and `diff-marker-add`/`diff-marker-del` to the `+`/`-`. **split**: two side-by-side columns (old | new) pairing del/add. Monospace via `font-mono`, ~12–13px, `whitespace-pre`, tab-size 2, horizontal scroll. Use `diff-gutter-add`/`diff-gutter-del` on gutter cells.
- `diff-stat-bar.tsx` — `export function DiffStatBar({ additions, deletions }: { additions: number; deletions: number })`: 5 small squares, green for adds / red for dels proportionally (GitHub style), using the diff marker colors or `bg-[var(--diff-add-marker)]` etc.

CSS utility classes already defined in globals.css you should use:
`diff-line-add`, `diff-line-del`, `diff-gutter-add`, `diff-gutter-del`,
`diff-marker-add`, `diff-marker-del`, `diff-hunk-header`.
Add colors: prefer `text-[var(--diff-add-marker)]` / `text-[var(--diff-del-marker)]`
for the +/− counts. Keep it clean, dense, and readable in light and dark.

---

## CONTRACT: `repo-ui`  (4 files)  — all `"use client"`
Presentational; all data + mutations arrive via props/callbacks. Use shadcn `ui`.
Do NOT use native `confirm()`/`alert()` or any browser modal dialog.

- `src/components/ref-picker.tsx` —
  `export function RefPicker({ refs, value, onChange, placeholder, align, disabled }: { refs?: RepoRefs; value: RefInfo | null; onChange: (r: RefInfo) => void; placeholder?: string; align?: "start" | "end"; disabled?: boolean })`.
  A `Popover` trigger `Button` (outline, justified) showing `value?.label ?? placeholder` with a small kind icon (lucide: GitBranch/Tag/GitCommitHorizontal/FileClock). Inside: `Command` with `CommandInput` search and grouped `CommandGroup`s in this order:
  **Compare with** → Working tree (`{kind:"working",ref:"WORKING",label:"Working tree"}`), Staged (`{kind:"staged",ref:"STAGED",label:"Staged"}`), HEAD (`{kind:"head",ref:"HEAD",label:"HEAD"}`);
  **Branches** (refs.branches, subtitle = short sha + subject; mark current);
  **Worktrees** (refs.worktrees → `{kind:"worktree",ref: branch?branchLabel:head, label: branchLabel, subtitle: path}`);
  **Tags** (refs.tags); **Remotes** (refs.remotes); **Recent commits** (refs.commits → `{kind:"commit",ref:hash,label:shortHash,subtitle:subject}`).
  Selecting closes the popover and calls `onChange`. Show a skeleton/disabled state when `!refs`.
- `src/components/add-repo-dialog.tsx` —
  `export function AddRepoDialog({ onAdd }: { onAdd: (input: { path: string; name?: string }) => Promise<void> })`.
  Renders its own trigger (a `Button` with a Plus icon, e.g. "Add repo"). `Dialog`
  with a path `Input` (placeholder `~/projects/my-repo`) + optional name `Input`.
  Submit → `await onAdd(...)`; on success close + reset; on throw show the error
  inline (`Alert` destructive) and keep open. Disable submit while pending.
- `src/components/repo-sidebar.tsx` —
  `export function RepoSidebar({ repos, selectedId, onSelect, onAdd, onRemove, loading }: { repos: RepoSummary[]; selectedId: string | null; onSelect: (id: string) => void; onAdd: (input: { path: string; name?: string }) => Promise<void>; onRemove: (id: string) => Promise<void>; loading?: boolean })`.
  Header: app wordmark "GitScope" (with a lucide `GitCompareArrows` icon) + `<AddRepoDialog onAdd={onAdd} />`. Then a `ScrollArea` list of repos: each row shows `name`, the current branch (GitBranch icon + `status.current`), and a dirtiness hint (e.g. badge `+staged ~unstaged ?untracked` or a green "clean" dot; show ahead/behind like `↑2 ↓1`). Selected row highlighted. A `DropdownMenu` (kebab) per row with "Remove" → `onRemove(id)`. Render `error` repos muted with a warning icon + tooltip. Empty state when `repos.length === 0`: a hint to add a repo. Skeletons when `loading`.
- `src/components/compare-bar.tsx` —
  `export function CompareBar({ refs, base, compare, onBaseChange, onCompareChange, mode, onModeChange, onSwap, stats, loading }: { refs?: RepoRefs; base: RefInfo | null; compare: RefInfo | null; onBaseChange: (r: RefInfo) => void; onCompareChange: (r: RefInfo) => void; mode: DiffMode; onModeChange: (m: DiffMode) => void; onSwap: () => void; stats?: { files: number; additions: number; deletions: number }; loading?: boolean })`.
  One clean horizontal bar: `RefPicker` (base) — a swap `Button` (ArrowLeftRight) — `RefPicker` (compare) — a small segmented mode toggle (merge-base `...` vs direct `..`, e.g. two `Button`s or a `Tabs`) — and, pushed right, the `stats` summary (`N files`, `+adds`, `−dels`) when present. Wrap nicely on small widths.

---

## STYLE BAR
Clean, dense, calm. Neutral shadcn palette; green/red only for diff add/remove.
Generous but not huge spacing, `rounded-lg`, subtle borders, `text-muted-foreground`
for secondary text. Truncate long paths. Everything must look right in dark mode.
Prefer composition of existing `@/components/ui/*`. Keep each file focused.

---

## CONTRACT: `mcp` + AI loop (`src/app/api/mcp/route.ts`, guides, lifecycle)

GitScope exposes a **stateless MCP server** (Streamable HTTP, plain JSON
responses, no sessions) at `POST /api/mcp`. Connect an agent with:

```bash
claude mcp add --transport http gitscope http://127.0.0.1:3000/api/mcp
```

Tools (all args JSON-schema'd in `tools/list`): `list_repos`,
`get_diff { repoId, base?, compare?, mode? }` (defaults `HEAD` → `WORKING`,
patch capped ~160 KB with `patchTruncated`),
`get_comments { repoId, state?, base?, compare?, mode? }` (scoped to the
compared branch — see **Comment scoping**),
`add_comment { repoId, path, startLine, endLine?, body, base?, compare?, mode? }`
(anchors server-side via `src/lib/comment-anchor.ts`; rejects lines not visible
in the diff; files as `source:"ai"`), `set_comment_state { repoId, id, state, note? }`,
`get_review_guide` and `submit_review_guide { repoId, title?, summary?, sections[] }`
(section paths are validated against the diff; unknown paths are dropped and
reported back as `droppedPaths`).

**Review guides** (`ReviewGuide`/`GuideSection` in `src/lib/types.ts`) persist
at `~/.config/gitscope/guides.json` keyed `repoId → compareKey`
(`${mode}:${base}...${compare}`, same key format as viewed/checkpoints), via
`src/lib/guides.ts`. Routes: `GET/DELETE /api/repos/[id]/guide?base&compare&mode`
and `POST /api/repos/[id]/guide/generate { base, compare, mode }` (local
`claude` CLI via `src/lib/ai-cli.ts`). UI: the diff's left pane has
Files/Guide tabs; the Guide tab renders sections with explanations, file
chips, and per-section reviewed state (localStorage
`gitscope.guideReviewed.<repoId>`); a guide submitted over MCP pops in live
(SWR poll, 5 s) and auto-switches the tab.

**Comment lifecycle**: `Comment` gained optional `state` ("open" | "addressed"
| "resolved", absent = open), `source` ("user" | "ai"), `stateNote`. PATCH
`/api/repos/[id]/comments` accepts `{ id, state, stateNote? }`;
`updateCommentState` in `src/lib/comments-config.ts`. "Copy for AI" exports
open notes only.

**Comment scoping**: `Comment.ref` is the branch a note was filed against, so
notes never leak between branches. It is resolved **server-side only** by
`reviewScope(repoPath, compare)` in `src/lib/git.ts` — `WORKING`/`STAGED`/`HEAD`
→ the repo's current branch, any other ref → itself, detached HEAD →
`detached@<sha>`. `base` is deliberately excluded, so re-pointing the base of a
comparison keeps its notes, and a note follows a branch from uncommitted work
through to its committed diff. Clients pass `compare` and never a scope: they
cannot resolve the sentinels, and a client-supplied scope could file a note onto
a branch it wasn't written against. Every read and write is scoped —
`GET/POST/DELETE /api/repos/[id]/comments?compare=…` (DELETE with no `id`
clears only the compared branch's notes), plus MCP `get_comments`/`add_comment`
and `src/lib/prereview.ts`. `readComments`/`clearComments` take an optional
`ref`; omitting it means the whole repo. Notes stored before scoping existed
have no `ref` and are invisible to every scoped read. **AI pre-review**: `POST /api/repos/[id]/prereview
{ base, compare, mode }` runs the local `claude` CLI over the diff and files
validated findings as `source:"ai"` comments. **Live diff**:
`GET /api/repos/[id]/watch` is an SSE stream (fs-watch, debounced, `.git`
internals except `.git/index` ignored); `useLiveDiff` revalidates the diff
while a `WORKING`/`STAGED` comparison is shown — note this keeps a connection
open permanently (never wait on `networkidle` in tests).
