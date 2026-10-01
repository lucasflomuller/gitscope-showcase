import type { SymbolKind, SymbolNode } from "@/lib/types"

/**
 * Pure helpers turning a file's symbols + the diff's changed (added) new-side
 * lines into "touched symbols" and a hunk → enclosing-symbol breadcrumb. All
 * line numbers are 1-based new-side (compare-ref) coordinates — the same space
 * the symbols and the parsed diff already use.
 */

/** How a touched symbol changed. */
export type TouchKind = "added" | "modified"

/** Per-symbol touch result (indexed parallel to the input `symbols` array). */
export interface SymbolTouch {
  /** Symbol index → touch kind. Absent index = untouched. */
  state: Map<number, TouchKind>
  /** Symbol index → the first changed (added) line inside its range (jump target). */
  firstChangedLine: Map<number, number>
  /** Number of symbols intersected by an added line. */
  touchedCount: number
}

const EMPTY: SymbolTouch = {
  state: new Map(),
  firstChangedLine: new Map(),
  touchedCount: 0,
}

/**
 * Classify each symbol against the set of added new-side line numbers. A symbol
 * is "touched" when its [startLine, endLine] intersects any added line; it is
 * `added` when EVERY line in its range is an added line, otherwise `modified`.
 */
export function computeTouched(
  symbols: SymbolNode[],
  added: Set<number>,
): SymbolTouch {
  if (symbols.length === 0 || added.size === 0) return EMPTY

  const state = new Map<number, TouchKind>()
  const firstChangedLine = new Map<number, number>()
  let touchedCount = 0

  for (let i = 0; i < symbols.length; i++) {
    const s = symbols[i]
    let first = -1
    let all = true
    for (let ln = s.startLine; ln <= s.endLine; ln++) {
      if (added.has(ln)) {
        if (first === -1) first = ln
      } else {
        all = false
      }
    }
    if (first !== -1) {
      state.set(i, all ? "added" : "modified")
      firstChangedLine.set(i, first)
      touchedCount++
    }
  }

  return { state, firstChangedLine, touchedCount }
}

/**
 * The root → leaf names of the deepest symbol whose range contains `line`.
 * Because sibling symbols never overlap, every symbol containing a point forms
 * a single ancestor chain, so e.g. a line inside `copyPatch` inside `DiffViewer`
 * yields `["DiffViewer", "copyPatch"]`. Empty when no symbol contains the line.
 */
export function enclosingPath(symbols: SymbolNode[], line: number): string[] {
  const containing = symbols.filter(
    (s) => line >= s.startLine && line <= s.endLine,
  )
  if (containing.length === 0) return []
  containing.sort((a, b) => a.depth - b.depth || a.startLine - b.startLine)
  return containing.map((s) => s.name)
}

/** Short, human label for a symbol kind (tooltips / a11y). */
export const KIND_LABEL: Record<SymbolKind, string> = {
  function: "function",
  method: "method",
  class: "class",
  interface: "interface",
  type: "type",
  enum: "enum",
  component: "component",
}
