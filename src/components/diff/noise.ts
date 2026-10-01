"use client"

/**
 * Noise classification: which changed files are "meaningful" vs generated /
 * lockfiles / whitespace-only. Drives the file-tree grouping, the "N of M files
 * meaningful" summary, default selection, j/k scope, and the collapsed pane
 * placeholder. Pure client logic; no git/server imports.
 */

import type { ParsedFile } from "./file-meta"

export type FileClass = "meaningful" | "generated" | "whitespace"

/**
 * Default generated/lockfile globs. Patterns ending in `/**` match a directory
 * segment anywhere in the path; patterns with no slash match the basename.
 */
const GENERATED_GLOBS = [
  // lockfiles
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lockb",
  "bun.lock",
  "*.lock",
  "go.sum",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "Pipfile.lock",
  // build / generated artifacts
  "*.min.*",
  "*.map",
  "*.snap",
  "*_pb.*",
  "*.generated.*",
  // generated directories
  "dist/**",
  "build/**",
  "out/**",
  "vendor/**",
  ".next/**",
  "node_modules/**",
  "coverage/**",
]

/** Convert a (slash-bearing or basename) glob to an anchored RegExp. */
function globToRegExp(glob: string): RegExp {
  let re = ""
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*"
        i++
      } else {
        re += "[^/]*"
      }
    } else if (".+^${}()|[]\\/".includes(c)) {
      re += "\\" + c
    } else {
      re += c
    }
  }
  return new RegExp("^" + re + "$")
}

const compiled = GENERATED_GLOBS.map((g) => {
  if (g.endsWith("/**")) return { kind: "dir" as const, value: g.slice(0, -3) }
  if (g.includes("/")) return { kind: "path" as const, value: globToRegExp(g) }
  return { kind: "base" as const, value: globToRegExp(g) }
})

/** Whether a path matches the built-in generated/lockfile glob list. */
export function isGeneratedPath(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1)
  for (const m of compiled) {
    if (m.kind === "dir") {
      if (("/" + path).includes("/" + m.value + "/")) return true
    } else if (m.kind === "path") {
      if (m.value.test(path)) return true
    } else if (m.value.test(base)) {
      return true
    }
  }
  return false
}

function normWS(s: string): string {
  return s.replace(/\s+/g, "")
}

/**
 * True when every changed line in the file is a whitespace-only modification
 * (re-indentation, blank-line churn, EOL/tab changes). The non-whitespace
 * content removed must exactly equal the non-whitespace content added.
 */
export function isWhitespaceOnlyFile(file: ParsedFile): boolean {
  if (file.chunks.length === 0) return false
  const dels: string[] = []
  const adds: string[] = []
  let changed = false
  for (const chunk of file.chunks) {
    for (const c of chunk.changes) {
      if (c.type === "del") {
        changed = true
        dels.push(normWS(c.content.slice(1)))
      } else if (c.type === "add") {
        changed = true
        adds.push(normWS(c.content.slice(1)))
      }
    }
  }
  if (!changed) return false

  // Ignore lines that are pure-whitespace (blank-line add/del), then the
  // remaining non-whitespace content must match as a multiset.
  const d = dels.filter(Boolean).sort()
  const a = adds.filter(Boolean).sort()
  if (d.length !== a.length) return false
  for (let i = 0; i < d.length; i++) if (d[i] !== a[i]) return false
  return true
}

/**
 * Classify a parsed file. `generatedFromServer` is the optional
 * `.gitattributes linguist-generated` signal (undefined = unknown → glob
 * fallback; explicit false = authoritative, skip globs).
 */
export function classifyFile(
  path: string,
  file: ParsedFile,
  opts: { generatedFromServer?: boolean } = {},
): FileClass {
  const server = opts.generatedFromServer
  if (server === true) return "generated"
  if (server !== false && isGeneratedPath(path)) return "generated"
  if (isWhitespaceOnlyFile(file)) return "whitespace"
  return "meaningful"
}
