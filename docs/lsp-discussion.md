# LSP Support in GitScope — Synthesized Design Verdict

> Produced by a 5-agent design workflow (capability mapping, runtime architecture, UX
> integration, hard problems & alternatives → synthesis), grounded in the real code.
> This is a discussion/decision doc, not a commitment to build.

*Verified seams: the `compare` selector fork in `getDiff()` (`src/lib/git.ts`), the
additive `preflight?`/`generated?` pattern on `DiffResult` (`src/lib/types.ts`), and the
route's "run an analysis pass and attach it" shape (`src/app/api/repos/[id]/diff/route.ts`).*

---

## 1. TL;DR verdict

**Yes, "smarter diff review" is worth building — but mostly *not* with LSP, and LSP is
not the first thing to build.** The analyses converge on one architectural fact that
overrides everything: GitScope's superpower is diffing **arbitrary refs**, but a language
server can only truthfully answer about **files on disk** (the working tree, or a fully
materialized ref). That mismatch means real LSP is *silently wrong* — not just degraded —
in the majority of GitScope's comparison modes (`base...compare` from a third branch, two
historical commits, a tag-to-tag). Silent wrongness is worse than no feature.

The resolution:

- **Lead with a ref-correct structural + textual layer** — tree-sitter for
  symbols/outline/hunk-enclosing-symbol, and `git grep <ref>` for "blast radius / who
  references this." These are *content-addressed, not workspace-addressed*, so they are
  correct on **every** ref exactly the way the diff is, cost ~10% of LSP, need zero
  installs, and capture ~70–80% of the perceived "LSP" value. They also build the exact
  secondary-surface UI plumbing that any later LSP work reuses.
- **Treat real LSP as a narrow, late, hard-gated add-on:** TypeScript-first (drive the
  repo's own `node_modules/typescript`), working-tree-only, with an explicit visible guard
  ("this reflects your working tree, not the compared ref"), in feature order
  diagnostics → hover → reference-upgrade. Build it only after you've lived with the cheap
  layer and *still* hit the type-accuracy wall.

**The single best first step:** the **hunk → enclosing-symbol breadcrumb + a "touched
symbols" outline**, computed with **tree-sitter** (not LSP). It converts "+40 −12 across 3
hunks" into "this change modifies `getDiff`, adds `getGeneratedPaths`, deletes `parseFoo`"
— the mental model reviewers actually use — and it stands up the outline/breadcrumb/
file-tree-decoration UI that diagnostics and references later slot into.

If your real reviews are *predominantly* historical commit-to-commit comparisons, you can
stop after the cheap layer and never build LSP at all.

---

## 2. Feature set worth supporting, prioritized

| # | Feature | Review question | Best mechanism | Ref-correct? | Priority |
|---|---|---|---|---|---|
| 1 | **Touched-symbols outline + hunk→enclosing-symbol breadcrumb** | "*What* did this change touch, semantically?" | **tree-sitter** | **All refs** | **First** |
| 2 | **Blast radius: "who references this changed symbol — and which callers are NOT in this diff?"** | "Did I forget a call site outside the changeset?" | **`git grep <ref>`** (tree-sitter-filtered) | **All refs** | **Second** |
| 3 | **Diagnostics on changed lines** | "Does what I'm about to PR typecheck cleanly?" | **LSP** `publishDiagnostics`, scoped to changed hunks | Working-tree only | Third (1st LSP) |
| 4 | **Hover type/signature** | "What's the type/signature of this changed call?" | **LSP** `hover` (+ `signatureHelp`) | Working-tree only | Fourth |
| 5 | **Reference/definition *upgrade*** — type-accurate, overload/shadow-aware | "Is this the *real* caller, not a same-name collision?" | **LSP** `references` / `callHierarchy` | Working-tree only | Fifth, gated |
| 6 | **Open-in-editor** on every location surface | "Take me to the real thing" | `$EDITOR`/`code --goto` child process | Always | Ship alongside |

**References.** The marquee is the *question* ("blast radius, partitioned by in-diff vs
not-in-diff"), not the mechanism. Deliver it first with `git grep` (correct on all refs,
zero cost); reserve LSP `references` as a later precision upgrade for the working-tree case
when grep's textual false positives (overloads, shadowing, same-name-different-symbol)
actually bite. Killer framing: **"12 references, 3 of them outside this changeset — did you
forget them?"** No generic IDE surfaces this, because no IDE knows what "the changeset" is.

**Diagnostics.** Scope to **diagnostics introduced by the change on changed hunks** (diff
the base-ref diagnostic set against the compare-ref set), working-tree only — defuses the
"floods the diff with pre-existing errors" objection. Cheapest genuinely-LSP-only feature
to wire and reuses the preflight inline-card/file-tree-dot/side-panel UI; the right *first*
LSP feature to prove the server lifecycle. But it's not the *reason* to adopt LSP (#5 is).

**Skip outright:** `semanticTokens` (cosmetic delta over the existing dual-theme Shiki
pipeline), standalone `signatureHelp` (subsumed by hover), `rename` (a mutation; GitScope
is read-only), `typeDefinition`/`implementation` (niche), `outgoingCalls` (already visible
in the diff). Forward `definition` deprioritized vs references — the target usually lives
in an unchanged file the diff never renders.

---

## 3. Recommended runtime architecture

### The cheap layer (Phases 1–2) — additive, ref-correct, mirrors preflight

Attach like preflight, but **as lazy endpoints, not folded into `DiffResult`** (symbols/grep
are extra work that must not bloat the diff payload or block first paint):

- `tree-sitter` (via `web-tree-sitter` + bundled WASM grammars): parses each changed file's
  **new-side text** — or a blob from `git show <ref>:<path>` — in milliseconds.
  Content-addressed, so it sidesteps the ref problem entirely.
- `git grep -n -w <symbol> <compareRef> -- <pathspec>`: one `simple-git` call, searches the
  **exact ref's tree** with no checkout. The only blast-radius approach that respects an
  arbitrary ref the way the diff does.
- New endpoints `POST /api/repos/[id]/symbols` and `…/references`, consumed by SWR hooks.

### The LSP layer (Phase 3) — the genuinely hard part

The diff backend is stateless/fire-and-forget; a language server is the opposite —
long-lived, stateful, memory-hungry, slow to start.

- **`globalThis`-pinned singleton `LspManager`**, *not* spawn-per-request. The pin survives
  Next.js HMR (a naive module-scope singleton leaks orphaned servers on every save). Clean
  interface so it can later be lifted into a sidecar daemon.
- **Pool keyed by `(resolved workspace root, languageId)`** — per-language root (nearest
  `tsconfig.json`/`Cargo.toml`), so a monorepo hosts several servers. Lazy start, idle
  evict, global LRU cap, crash supervision with backoff + circuit breaker.
- **Thin client on `vscode-jsonrpc` + `vscode-languageserver-protocol`** (~few hundred
  lines). *Not* `vscode-languageclient` (needs the VS Code extension host) or
  `monaco-languageclient` (only for an in-browser Monaco editor). Requests carry a
  cancellation token wired to the HTTP request's `AbortSignal`; dispose servers on
  `exit|SIGINT|SIGTERM` so `next dev` Ctrl-C doesn't orphan them.
- **TS-first install reality:** on this machine the only LSP server installed is `clangd`;
  the `tsserver` on PATH is the compiler's (does not speak LSP). So prefer
  `typescript-language-server`/`vtsls` if resolvable, **otherwise drive the repo-local
  `node_modules/typescript/lib/tsserver.js` via its native protocol behind the same
  adapter** — the zero-extra-install path, almost always available, and dodges TS-version
  drift by using the project's own version. Discovery is a first-class subsystem
  (`languageId → LaunchSpec` table + `~/.config/gitscope/lsp.json` override), absent-tolerant.

### The working-tree/ref caveat — made explicit (the spine of the whole design)

The `getDiff()` selector fork *is* the regime fork:

```
compare === "WORKING" → [base]               // new side IS the live working tree → ON DISK
compare === "STAGED"  → ["--cached", base]   // new side IS the index → near-disk
else (committish)     → base...compare | base..compare  // new side is a tree object → NOT on disk
```

Document-targeting strategy, gated by regime, **always disclosing which version a result
describes**:

- **(A) Working-tree, real file URI — the default and honest 80% case.** Imports,
  `node_modules`, config all resolve; new-side line N = on-disk line N. Covers `…WORKING`
  and reviewing the currently-checked-out feature branch — the common pre-PR flow. *Latent
  asset:* `git.ts` already enumerates worktrees with `isCurrent`/`isMain`/`head`; if
  `compare` resolves to an existing clean worktree path, point the server there for free.
- **(B) In-memory `git show` overlay** — `didOpen.text = git show <ref>:<path>`. Good for
  STAGED/HEAD and changed-side intra-file hover/symbols; ceiling is cross-file.
- **(C) Temp `git worktree add --detach <ref>` — opt-in "deep mode," expensive.** Faithful
  cross-file semantics at a ref, but pays a full cold index per ref and hits the
  node_modules/target trap (worktrees don't materialize untracked/ignored files). Reserve
  for an explicit toggle.

**Rule:** features turn fully on only in regime (A); STAGED/HEAD use (B); arbitrary refs
default to **off with a one-click CTA**, never a silent degraded guess. LSP never sits on
the diff route's critical path — separate, lazy, cancellable, result-cached.

---

## 4. UX shape

GitScope fits these features unusually well because **it renders one file at a time** (the
file tree is a selector), so a server only ever focuses the selected file (`didOpen` on
select, `didClose` on deselect), bounding cost. Build by **re-instancing existing
patterns**:

- **A regime-aware status chip is the spine** (mirror `PreflightSummary`): *Live*
  (working-tree, calm), *Indexing…*, *Snapshot @ abc123* (opt-in materialized ref),
  *Limited* (non-working ref → explainer + "compare against working tree" CTA), *No server
  for `.xyz`* (muted; never nag), *Off/Error*. Teaches the working-tree tension once.
- **Structure (P1):** breadcrumb in the sticky `DiffFile` header ("`MyClass › render`"); a
  "touched symbols" summary as a semantic complement to `+N −M`; outline behind a popover
  (Sheet on compact). Don't spend permanent left-panel width.
- **Blast radius (P2):** a second `PreflightPanel`-shaped Sheet, leading with the amber
  **"Not updated in this diff (N)"** section then muted "In this diff"; an end-of-line
  "N refs" chip on changed declarations (not a token decoration — don't fight Shiki).
  Reuse the existing `focusLine`/`focusNonce` scroll-and-pulse primitive.
- **Diagnostics (P3):** wavy underline (a `text-decoration` channel orthogonal to Shiki fg
  and word-diff bg) + a **right**-gutter icon (keep the **left** gutter for preflight).
- **Hover/peek:** resolve token via `caretPositionFromPoint`; definition targets usually
  live in unrendered regions → a **peek** row (an `InlineFindings`-shaped `<tr colSpan>`
  rendering ~12 on-disk lines via the existing `highlighter.ts`), with **"Open in editor"
  as a first-class escape hatch on every surface** (always correct — the editor operates on
  the real tree).
- **Touch/iPad:** every hover feature needs a tap path — an iOS-style selection-callout bar
  above a tapped token ("Definition · References · Type · Open in editor").

**Throughline:** LSP failure is always invisible-or-muted, never obstructive — model it on
**Shiki** (loads later, falls back to plain), *not* preflight (present at first paint). The
diff that exists today must render identically with zero servers installed.

---

## 5. Hard problems & mitigations

1. **Ref mismatch = wrongness, not just difficulty.** Regime-gate hard, default to
   working-tree, disclose the version, off-with-CTA for arbitrary refs. The cheap layer
   sidesteps it by being content-addressed.
2. **The `reconstruct()` trap.** `use-diff-highlight.ts` concatenates only hunk lines with
   gaps collapsed — line N there is **not** line N in the file. Correct for Shiki,
   catastrophic as an LSP coordinate source. LSP must read the real on-disk file and use
   `change.ln`/`ln2` directly.
3. **Position mapping off-by-ones.** JS string indices and LSP default position encoding are
   both UTF-16; `lspLine = (add ? ln : ln2) − 1`. Test per-feature — bugs erode trust fast.
4. **Monorepo root detection.** `RepoConfig.path` ≠ LSP project root; ancestor-walk to the
   nearest marker; multiple concurrent servers per repo.
5. **Process lifecycle under Next.js HMR.** globalThis-pinned singleton + dispose-on-exit.
6. **Cold start & RAM.** tsserver: seconds + hundreds of MB; rust-analyzer: tens of
   seconds–minutes + GBs. Lazy start, idle evict, optional pre-warm, `$/progress` state.
7. **Security — meaningfully larger attack surface.** LSP servers execute project config
   (rust-analyzer build scripts/proc-macros, tsserver plugins). A review tool that
   auto-runs the reviewed repo's toolchain deserves a hard think (cf. the Truco
   supply-chain RCE). **Never auto-start servers for repos not explicitly trusted.**
   (`git diff`, tree-sitter, and `git grep` are read-only and don't cross this boundary.)

---

## 6. LSP vs. lighter alternatives — the call

**Lead with the lighter tools; they are the right primary design** for the arbitrary-ref
regime, not a fallback.

- **tree-sitter — build first.** Per-file incremental parse, WASM, zero install,
  milliseconds, **content-addressed**. Adopt for **structure** (not highlighting — Shiki is
  already good).
- **`git grep <ref>` — build second.** Ref-exact "what references this," no checkout,
  instant, all languages. Filter textual false positives with the tree-sitter tree.
- **universal-ctags** — optional heuristic "probable definition by name."
- **LSP — narrow, late, conditional.** The only thing delivering type-accurate cross-file
  semantics, overload/shadow resolution, true hover types, real diagnostics — but only on
  the working tree, at the highest cost, with silent-wrongness risk.

**Decisive property:** tree-sitter and `git grep` are *content/ref-addressed*; LSP is
*workspace-on-disk-addressed*. GitScope lives in the former regime.

---

## 7. Phased roadmap with effort & go/no-go gates

**Phase 0 — foundation (S, ~1–2 days).** Establish the lazy-endpoint pattern
(`POST …/symbols`, `…/references`) so semantic features never bloat the diff payload. No
user-visible feature.

**Phase 1 — tree-sitter structure (M, ~3–5 days). The single best first step.** New-side
text → document symbols → hunk→enclosing-symbol breadcrumb + "touched symbols" summary +
outline popover. Ref-correct, zero install, no process management.
→ **Go/no-go:** you actually *use* the breadcrumb/outline in real reviews. If it gathers
dust, **stop here.**

**Phase 2 — `git grep`-at-ref blast radius (M, ~4–6 days). The marquee.** Click a changed
declaration → ref-exact, tree-sitter-filtered, jumpable hit list, **partitioned "not updated
in this diff (N)."** + Open-in-editor everywhere.
→ **Go/no-go to P3 (all must hold):** (a) you still repeatedly need type-accuracy the
textual heuristic gets wrong; (b) your real diffs are predominantly working-tree /
current-feature-branch (ref ≈ disk) — *if you mostly review historical commit-to-commit,
LSP is stale by construction; do not build it*; (c) you'll own per-language install UX and
the trusted-repo security posture.

**Phase 3 — real LSP, hard-gated, TS-only (L, ~2–3 weeks).** Infra first (globalThis-pinned
`LspManager`, `vscode-jsonrpc` client, discovery, per-tsconfig-root pool, lifecycle, regime
gating, trusted-repos-only), then features in stakes order: **diagnostics-on-changed-lines**
→ **hover** → **reference precision upgrade** over P2's grep results. The repo-local
`tsserver.js` adapter removes the install barrier for TS.
→ **Go/no-go to P4:** the TS LSP earns its RAM/cold-start tax daily *and* you keep wanting a
second language.

**Phase 4 — second language (M per language, on proven demand only).** Likely Rust/Go;
`clangd` is the one server already installed, so C/C++ is the cheapest technical second
language if demand exists.

**Net:** ship Phases 0–2 (the ref-correct cheap layer) with confidence — they're the right
permanent design and a likely permanent stopping point. Phases 3–4 are a conditional, gated
bet justified only by the type-accuracy wall actually hurting you in working-tree-shaped
reviews.
