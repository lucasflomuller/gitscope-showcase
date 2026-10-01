import { filePath, type ParsedFile } from "./file-meta"

/**
 * Pure, client-safe search over parsed diff files. No React, no server imports.
 * Scans the change *body* (parse-diff's `content` includes the leading +/-/space
 * marker, stripped here) case-insensitively and records the first hit per line so
 * the result list stays scannable.
 */

export interface SearchMatch {
  path: string
  /** NEW-side line (add → ch.ln, normal → ch.ln2); null for pure deletions. */
  line: number | null
  column: number
  text: string
  kind: "add" | "del" | "normal"
}

export interface SearchResults {
  matches: SearchMatch[]
  total: number
  fileCount: number
  capped: boolean
}

/** Hard cap on rendered matches; total keeps counting past it (→ capped). */
export const MAX_MATCHES = 200

export function searchFiles(
  files: ParsedFile[],
  query: string,
): SearchResults {
  const q = query.trim()
  // Single characters match everything — noise, not a search.
  if (q.length < 2) return { matches: [], total: 0, fileCount: 0, capped: false }

  const needle = q.toLowerCase()
  const matches: SearchMatch[] = []
  const paths = new Set<string>()
  let total = 0

  for (const file of files) {
    const path = filePath(file)
    for (const chunk of file.chunks) {
      for (const ch of chunk.changes) {
        // Strip the leading diff marker (+/-/space) before matching + display.
        const body = ch.content.slice(1)
        if (!body) continue
        const column = body.toLowerCase().indexOf(needle)
        if (column === -1) continue

        total++
        paths.add(path)
        if (matches.length < MAX_MATCHES) {
          const line =
            ch.type === "add"
              ? ch.ln
              : ch.type === "normal"
                ? ch.ln2
                : null
          matches.push({ path, line, column, text: body, kind: ch.type })
        }
      }
    }
  }

  return {
    matches,
    total,
    fileCount: paths.size,
    capped: total > MAX_MATCHES,
  }
}
