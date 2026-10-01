import "server-only"

import { git } from "@/lib/git"
import { classifyPositions, type HitPos } from "@/lib/symbols"

/**
 * Server-only "blast radius" reference search — `git grep` at an arbitrary ref,
 * tree-sitter-filtered.
 *
 * Why `git grep` (not a language server): GitScope diffs ARBITRARY refs, but a
 * language server only knows files on disk. `git grep` searches the exact tree /
 * index / working set with NO checkout and NO mutation, so the hit list is
 * correct for exactly the ref being compared — on every ref, every language.
 *
 * Textual matching over-reports (a name inside a comment or a string literal is
 * not a real reference), so we re-parse each file's compare-side blob with the
 * shared tree-sitter layer and drop hits that land in a comment/string. Files in
 * an unsupported language keep every hit — that's correct, not a regression.
 *
 * Everything here is best-effort: a bad identifier, "no matches" (which makes
 * `git grep` exit non-zero), or any sub-command failure yields an empty result
 * and NEVER throws. The diff must render byte-identically when references are
 * unavailable (graceful like Shiki, not like preflight).
 */

/** One textual reference to a symbol: a new-side path + line + the matched line. */
export interface RefHit {
  /** Repo-relative path (git grep `--full-name`). */
  path: string
  /** 1-based line number (git grep `-n`). */
  line: number
  /** 0-based column of the name within `text` (best-effort, clamped ≥ 0). */
  column: number
  /** The full matched source line, verbatim (trimmed of the trailing newline). */
  text: string
}

/** The blast-radius result: filtered hits, the count, and a soft-cap flag. */
export interface RefResult {
  references: RefHit[]
  /** Hit count after the comment/string filter (before the display cap). */
  total: number
  /** True when the list was sliced to `MAX_HITS`. */
  capped: boolean
}

/** A plausible identifier — also the injection guard for the grep pattern. */
const IDENT = /^[A-Za-z_$][\w$]*$/

/** Soft cap on returned hits — keeps a pathological symbol from flooding the UI. */
const MAX_HITS = 400

const EMPTY: RefResult = { references: [], total: 0, capped: false }

/** Escape a string for safe interpolation into a `RegExp` (the column search). */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/**
 * The grep arguments for a search of `name`, honoring the same compare-side
 * sentinels as `getDiff`/`symbols`:
 *   WORKING → the working tree (no rev)
 *   STAGED  → the index (`--cached`)
 *   else    → the committish appended as a tree-ish (last arg)
 *
 * Flags: `-n` line numbers, `-I` skip binary, `-w` word boundary, `-F` fixed
 * string (name is validated, but `-F` is belt-and-suspenders), `--full-name`
 * repo-relative paths, `--no-color` clean output. WORKING also passes
 * `--untracked` so references in brand-new, not-yet-`git add`ed files still
 * count — silently missing them would defeat the "did you forget them?" point.
 * (`--untracked` still honors `.gitignore`, so `node_modules`/`.next` stay out.)
 */
function grepArgs(ref: string, name: string): string[] {
  const base = ["grep", "-n", "-I", "-w", "-F", "--no-color", "--full-name"]
  if (ref === "WORKING") return [...base, "--untracked", "-e", name]
  if (ref === "STAGED") return [...base, "--cached", "-e", name]
  return [...base, "-e", name, ref]
}

/** A single parsed grep line, or null when it doesn't match `path:line:text`. */
function parseLine(
  raw: string,
  committish: boolean,
  ref: string,
  name: string,
  escaped: RegExp,
): RefHit | null {
  let rest = raw
  // The committish form prefixes every line with `<ref>:`. Strip exactly that
  // prefix (only in committish mode) before parsing the `path:line:text` body.
  if (committish) {
    const prefix = `${ref}:`
    if (!rest.startsWith(prefix)) return null
    rest = rest.slice(prefix.length)
  }
  // path may contain colons; line is digits; text is everything after.
  const m = /^(.+?):(\d+):(.*)$/.exec(rest)
  if (!m) return null
  const path = m[1]
  const line = parseInt(m[2], 10)
  const text = m[3]
  if (!path || !Number.isFinite(line)) return null
  // Column = the word-boundary occurrence of the name, falling back to a plain
  // index; clamp ≥ 0 so tree-sitter always gets a valid point.
  let column = text.search(escaped)
  if (column < 0) column = text.indexOf(name)
  if (column < 0) column = 0
  return { path, line, column, text }
}

/**
 * Find every textual reference to `name` across the whole repo at `ref`, then
 * drop the ones tree-sitter says are inside comments or string literals.
 *
 * @param repoPath absolute repo working directory
 * @param ref      compare-side ref / sentinel (WORKING | STAGED | committish)
 * @param name     the symbol identifier the user clicked
 */
export async function findReferences(
  repoPath: string,
  ref: string,
  name: string,
): Promise<RefResult> {
  // Reject anything that isn't a bare identifier — this both keeps the result
  // meaningful and prevents any injection into the grep pattern.
  if (!ref || !IDENT.test(name)) return EMPTY

  // ── 1. Raw grep over the correct tree / index / working set ────────────────
  let out: string
  try {
    out = await git(repoPath).raw(grepArgs(ref, name))
  } catch {
    // `git grep` exits 1 (→ simple-git throws) when there are NO matches; that
    // is the common, fine case. A real error (bad ref, etc.) is indistinguishable
    // here and equally non-fatal — either way, return empty rather than throw.
    return EMPTY
  }
  if (!out) return EMPTY

  // ── 2. Parse every line into a hit ─────────────────────────────────────────
  const committish = ref !== "WORKING" && ref !== "STAGED"
  const escaped = new RegExp(`\\b${escapeRegExp(name)}\\b`)
  const hits: RefHit[] = []
  for (const line of out.split("\n")) {
    if (!line) continue
    const hit = parseLine(line, committish, ref, name, escaped)
    if (hit) hits.push(hit)
  }
  if (hits.length === 0) return EMPTY

  // ── 3. tree-sitter filter: drop comment/string false positives ─────────────
  // Group by path so each blob is parsed exactly once; a file in an unsupported
  // language (or any parse failure) classifies every position "code" → kept.
  const byPath = new Map<string, RefHit[]>()
  for (const hit of hits) {
    const arr = byPath.get(hit.path) ?? []
    arr.push(hit)
    byPath.set(hit.path, arr)
  }

  const kept: RefHit[] = []
  await Promise.all(
    [...byPath.entries()].map(async ([path, group]) => {
      const positions: HitPos[] = group.map((h) => ({
        line: h.line,
        column: h.column,
      }))
      const classes = await classifyPositions(repoPath, ref, path, positions)
      for (let i = 0; i < group.length; i++) {
        if (classes[i] === "code") kept.push(group[i])
      }
    }),
  )

  // ── 4. Order, count, soft-cap ──────────────────────────────────────────────
  kept.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
  const total = kept.length
  const capped = total > MAX_HITS
  return {
    references: capped ? kept.slice(0, MAX_HITS) : kept,
    total,
    capped,
  }
}
