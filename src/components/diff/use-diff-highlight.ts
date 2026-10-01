"use client"

import { useEffect, useMemo, useReducer } from "react"

import { detectLang, tokenizeDualTheme, type ThemedToken } from "./highlighter"
import { filePath, type ParsedChange, type ParsedFile } from "./file-meta"
import { wordDiff, type CharRange } from "./word-diff"

// Per-side caps. Past these, syntax highlighting is skipped (with a note) so a
// huge/minified file never blocks the main thread.
const MAX_SIDE_LINES = 3000
const MAX_SIDE_BYTES = 200_000

export interface DiffHighlight {
  /** True once readability work for this file has been attempted (or skipped). */
  ready: boolean
  /** True when syntax was skipped because the file is too large. */
  skippedLargeFile: boolean
  /** Shiki tokens for a change, or null (→ plain text fallback). */
  tokensFor(change: ParsedChange): ThemedToken[] | null
  /** Intra-line changed ranges for a paired modified line, or null. */
  wordRangesFor(change: ParsedChange): CharRange[] | null
}

/** Reconstruct one side's source by walking chunks in order. */
function reconstruct(
  file: ParsedFile,
  side: "old" | "new",
): { code: string; changes: ParsedChange[] } {
  const lines: string[] = []
  const changes: ParsedChange[] = []
  for (const chunk of file.chunks) {
    for (const c of chunk.changes) {
      const include =
        c.type === "normal" ||
        (side === "old" ? c.type === "del" : c.type === "add")
      if (!include) continue
      lines.push(c.content.slice(1))
      changes.push(c)
    }
  }
  return { code: lines.join("\n"), changes }
}

function assign(
  changes: ParsedChange[],
  tokenLines: ThemedToken[][],
  map: WeakMap<ParsedChange, ThemedToken[]>,
): void {
  const n = Math.min(changes.length, tokenLines.length)
  for (let i = 0; i < n; i++) map.set(changes[i], tokenLines[i])
}

/** Word-diff every paired (del,add) modification run; store ranges per change. */
function computeWordRanges(
  file: ParsedFile,
  map: WeakMap<ParsedChange, CharRange[]>,
): void {
  for (const chunk of file.chunks) {
    const changes = chunk.changes
    let i = 0
    while (i < changes.length) {
      if (changes[i].type !== "del" && changes[i].type !== "add") {
        i++
        continue
      }
      const dels: ParsedChange[] = []
      const adds: ParsedChange[] = []
      while (i < changes.length && changes[i].type === "del") dels.push(changes[i++])
      while (i < changes.length && changes[i].type === "add") adds.push(changes[i++])
      const n = Math.min(dels.length, adds.length)
      for (let k = 0; k < n; k++) {
        const del = dels[k]
        const add = adds[k]
        const res = wordDiff(del.content.slice(1), add.content.slice(1))
        if (!res) continue
        if (res.delRanges.length) map.set(del, res.delRanges)
        if (res.addRanges.length) map.set(add, res.addRanges)
      }
    }
  }
}

/**
 * Shiki tokens for the compare-side blob, indexed by 1-based NEW-side line
 * number.
 *
 * Expanded-context rows are synthesized from the blob rather than taken from the
 * patch, so they are absent from the per-change WeakMap `useDiffHighlight`
 * builds — without this they'd render as plain text sandwiched between
 * highlighted patch lines. The blob is only fetched once the reader actually
 * expands context, so this costs nothing until then, and it reuses the same
 * caps and dual-theme tokenizer as the patch path.
 */
export function useBlobHighlight(
  path: string,
  lines: string[],
  enabled: boolean,
): (line: number) => ThemedToken[] | null {
  // Bumped after the async tokens land to repaint (the store isn't state).
  const [, forceRender] = useReducer((x: number) => x + 1, 0)

  // The token store lives on the memo, so it is discarded automatically when the
  // file, its content, or the toggle changes — stale tokens can't leak across.
  const plan = useMemo(() => {
    const store: { tokens: ThemedToken[][] | null } = { tokens: null }
    if (!enabled || lines.length === 0) return { store, code: "", lang: null }
    const code = lines.join("\n")
    if (lines.length > MAX_SIDE_LINES || code.length > MAX_SIDE_BYTES)
      return { store, code: "", lang: null }
    return { store, code, lang: detectLang(path) }
  }, [path, lines, enabled])

  useEffect(() => {
    const { store, code, lang } = plan
    if (!lang) return

    let cancelled = false
    tokenizeDualTheme(code, lang)
      .then((tokens) => {
        if (cancelled || !tokens) return
        store.tokens = tokens
        forceRender()
      })
      .catch(() => {
        // Swallow: the plain fallback is already rendered.
      })

    return () => {
      cancelled = true
    }
  }, [plan])

  return (line) => plan.store.tokens?.[line - 1] ?? null
}

/**
 * Compute Shiki tokens + word-diff ranges for one parsed file, attached to the
 * exact parse-diff change objects via WeakMaps so the render path is an O(1)
 * lookup. Word-diff is synchronous (and runs whenever `enabled`); Shiki is async
 * and gated by `syntax`. Dual-theme tokens mean theme toggles need no re-run.
 */
export function useDiffHighlight(
  file: ParsedFile,
  enabled: boolean,
  syntax: boolean,
): DiffHighlight {
  // Bumped after the async tokens land to repaint (WeakMap writes aren't state).
  const [, forceRender] = useReducer((x: number) => x + 1, 0)

  const path = filePath(file)

  // Synchronous, deterministic plan for this file/mode: fresh WeakMaps, the
  // word-diff ranges (cheap), and the reconstructed sides + resolved language
  // for the async Shiki pass. Memoized so it's stable across token repaints and
  // recomputes only when the file or a toggle changes.
  const plan = useMemo(() => {
    const tokenMap = new WeakMap<ParsedChange, ThemedToken[]>()
    const wordMap = new WeakMap<ParsedChange, CharRange[]>()

    if (!enabled) {
      return { tokenMap, wordMap, oldSide: null, newSide: null, lang: null, tooBig: false }
    }

    computeWordRanges(file, wordMap)

    if (!syntax) {
      return { tokenMap, wordMap, oldSide: null, newSide: null, lang: null, tooBig: false }
    }

    const oldSide = reconstruct(file, "old")
    const newSide = reconstruct(file, "new")
    const tooBig =
      oldSide.changes.length + newSide.changes.length > MAX_SIDE_LINES ||
      oldSide.code.length > MAX_SIDE_BYTES ||
      newSide.code.length > MAX_SIDE_BYTES
    const lang = tooBig ? null : detectLang(path)

    return { tokenMap, wordMap, oldSide, newSide, lang, tooBig }
  }, [file, path, enabled, syntax])

  // Async Shiki tokenization. setState happens only inside the resolved
  // callback (not synchronously in the effect body).
  useEffect(() => {
    const { tokenMap, oldSide, newSide, lang } = plan
    if (!lang || !oldSide || !newSide) return

    let cancelled = false
    Promise.all([
      tokenizeDualTheme(oldSide.code, lang),
      tokenizeDualTheme(newSide.code, lang),
    ])
      .then(([oldTokens, newTokens]) => {
        if (cancelled) return
        if (oldTokens) assign(oldSide.changes, oldTokens, tokenMap)
        if (newTokens) assign(newSide.changes, newTokens, tokenMap)
        forceRender()
      })
      .catch(() => {
        // Swallow: the plain fallback is already rendered.
      })

    return () => {
      cancelled = true
    }
  }, [plan])

  return {
    ready: enabled,
    skippedLargeFile: plan.tooBig,
    tokensFor: (c) => plan.tokenMap.get(c) ?? null,
    wordRangesFor: (c) => plan.wordMap.get(c) ?? null,
  }
}
