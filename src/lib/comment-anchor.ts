import "server-only"

import { createHash, randomUUID } from "node:crypto"
import parseDiff from "parse-diff"

import { getDiff } from "@/lib/git"
import type { DiffMode } from "@/lib/types"

/**
 * Server-side twin of comment-meta.ts's anchoring: identical normalization
 * (strip one leading +/-/space diff marker, trim trailing whitespace) and
 * identical digest input `${path} ${lines.join("\n")}` so server-filed notes
 * (MCP add_comment, AI pre-review) re-anchor exactly like client-filed ones.
 * comment-meta is a client module — do not import it here.
 */
function normalizeLine(content: string): string {
  const first = content.charAt(0)
  const body =
    first === "+" || first === "-" || first === " " ? content.slice(1) : content
  return body.replace(/\s+$/, "")
}

export function anchorHashFor(path: string, lines: string[]): string {
  const normalized = lines.map(normalizeLine).join("\n")
  return createHash("sha1").update(`${path} ${normalized}`).digest("hex")
}

/** Short client-compatible comment id (same shape as comment-meta.commentId). */
export function serverCommentId(): string {
  return randomUUID().slice(0, 8)
}

/**
 * Anchor a NEW-side line range of one file within a comparison: runs the diff,
 * collects the raw diff lines (markers included, as the client does), and
 * hashes them. Returns null when the file/lines aren't in the diff — callers
 * should reject the note rather than store an unanchorable one.
 * startLine/endLine of 0 anchors a whole-file note (empty code, like the UI).
 */
export async function resolveAnchor(
  repoPath: string,
  cmp: { base: string; compare: string; mode: DiffMode },
  filePath: string,
  startLine: number,
  endLine: number,
): Promise<{ anchorHash: string; code: string[] } | null> {
  if (startLine === 0 && endLine === 0) {
    return { anchorHash: anchorHashFor(filePath, []), code: [] }
  }
  if (startLine < 1 || endLine < startLine) return null
  const result = await getDiff(repoPath, cmp.base, cmp.compare, cmp.mode)
  const files = parseDiff(result.patch ?? "")
  const file = files.find((f) => {
    const to = f.to && f.to !== "/dev/null" ? f.to : undefined
    const from = f.from && f.from !== "/dev/null" ? f.from : undefined
    return (to ?? from) === filePath
  })
  if (!file) return null
  const byLine = new Map<number, string>()
  for (const chunk of file.chunks) {
    for (const ch of chunk.changes) {
      if (ch.type === "add") byLine.set(ch.ln, ch.content)
      else if (ch.type === "normal") byLine.set(ch.ln2, ch.content)
    }
  }
  const code: string[] = []
  for (let n = startLine; n <= endLine; n++) {
    const content = byLine.get(n)
    if (content === undefined) return null
    code.push(content)
  }
  return { anchorHash: anchorHashFor(filePath, code), code }
}
