"use client"

/**
 * In-house token-level (word) diff — no extra dependency.
 *
 * For a paired modified line (a `del` with a counterpart `add`), this finds the
 * exact changed substrings so the renderer can darken only those tokens (the
 * GitHub / Neon intra-line pattern), instead of bathing the whole line. A
 * similarity gate returns null for dissimilar pairs so a wholesale replacement
 * stays a plain add+del with no noisy char-by-char highlighting.
 */

/** A changed substring, as half-open char offsets into the (marker-stripped) line. */
export interface CharRange {
  start: number
  end: number
}

/** Longest single line we run the (O(n·m)) word diff on; longer pairs stay whole-line. */
const MAX_LINE = 400

/**
 * Minimum shared-TOKEN ratio for a pair to count as a modification. Token-based
 * (not char-based) so renaming one long identifier — `fooBarBaz` → `quxBarBaz`,
 * where the shared `await`/punctuation is a small fraction of the characters but
 * most of the *tokens* — still word-diffs instead of being treated as a rewrite.
 */
const SIMILARITY_FLOOR = 0.4

// Group runs of word chars and whitespace; punctuation falls out as single chars.
const TOKEN_RE = /[A-Za-z0-9_$]+|\s+|[^A-Za-z0-9_$\s]/g

function tokenize(text: string): string[] {
  return text.match(TOKEN_RE) ?? []
}

/**
 * Walk an LCS of the two token arrays, marking which tokens are part of the
 * common subsequence. Returns the unmatched-token flags per side plus the total
 * matched character length (for the similarity gate).
 */
function lcsMatch(
  a: string[],
  b: string[],
): { aMatched: boolean[]; bMatched: boolean[]; matchedTokens: number } {
  const n = a.length
  const m = b.length
  // dp[i][j] = LCS length of a[i:], b[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  )
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const aMatched = new Array<boolean>(n).fill(false)
  const bMatched = new Array<boolean>(m).fill(false)
  let i = 0
  let j = 0
  let matchedTokens = 0
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      aMatched[i] = true
      bMatched[j] = true
      matchedTokens++
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++
    } else {
      j++
    }
  }
  return { aMatched, bMatched, matchedTokens }
}

/** Merge consecutive unmatched tokens into char ranges. */
function rangesFrom(tokens: string[], matched: boolean[]): CharRange[] {
  const ranges: CharRange[] = []
  let offset = 0
  let runStart = -1
  for (let i = 0; i < tokens.length; i++) {
    const changed = !matched[i]
    if (changed && runStart === -1) runStart = offset
    if (!changed && runStart !== -1) {
      ranges.push({ start: runStart, end: offset })
      runStart = -1
    }
    offset += tokens[i].length
  }
  if (runStart !== -1) ranges.push({ start: runStart, end: offset })
  return ranges
}

/**
 * Word-diff a del/add line pair. `delText` / `addText` are the line contents
 * WITHOUT the leading diff marker. Returns null (→ treat as whole-line) when the
 * lines are identical, too long, or too dissimilar to be a meaningful edit.
 */
export function wordDiff(
  delText: string,
  addText: string,
): { delRanges: CharRange[]; addRanges: CharRange[] } | null {
  if (delText === addText) return null
  if (delText.length > MAX_LINE || addText.length > MAX_LINE) return null

  const a = tokenize(delText)
  const b = tokenize(addText)
  if (a.length === 0 || b.length === 0) return null

  const { aMatched, bMatched, matchedTokens } = lcsMatch(a, b)

  // Shared-token ratio (Sørensen–Dice over the token multisets via LCS).
  const ratio = (2 * matchedTokens) / (a.length + b.length)
  if (ratio < SIMILARITY_FLOOR) return null

  const delRanges = rangesFrom(a, aMatched)
  const addRanges = rangesFrom(b, bMatched)
  if (delRanges.length === 0 && addRanges.length === 0) return null

  return { delRanges, addRanges }
}

/** True when two lines differ only in whitespace (matches `git diff -w` semantics). */
export function isWhitespaceOnlyChange(del: string, add: string): boolean {
  if (del === add) return false
  return del.replace(/\s+/g, "") === add.replace(/\s+/g, "")
}
