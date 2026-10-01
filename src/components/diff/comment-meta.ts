import type { Comment, CommentState } from "@/lib/types"

import { filePath, type ParsedFile } from "./file-meta"

// ── Lifecycle helpers (pure) ──────────────────────────────────────────────────

/** Effective lifecycle state; a note with no state is "open" (back-compat). */
export function commentState(c: Comment | ResolvedComment): CommentState {
  return c.state ?? "open"
}

/** True when the note was filed by an AI pre-review/agent rather than the user. */
export function isAi(c: Comment | ResolvedComment): boolean {
  return c.source === "ai"
}

// ── Content hashing (pure, client + resolver share this exact function) ───────

/**
 * Minimal, dependency-free SHA-1 over a UTF-8 string. Deterministic on both the
 * client (where comments are created) and the resolver (where stored hashes are
 * matched against the current diff), so an anchor that matched at creation time
 * keeps matching as long as the underlying line text is unchanged.
 */
export function sha1(str: string): string {
  const bytes = new TextEncoder().encode(str)
  const ml = bytes.length * 8
  const total = Math.ceil((bytes.length + 1 + 8) / 64) * 64
  const buf = new Uint8Array(total)
  buf.set(bytes)
  buf[bytes.length] = 0x80
  const dv = new DataView(buf.buffer)
  dv.setUint32(total - 8, Math.floor(ml / 0x100000000))
  dv.setUint32(total - 4, ml >>> 0)

  let h0 = 0x67452301
  let h1 = 0xefcdab89
  let h2 = 0x98badcfe
  let h3 = 0x10325476
  let h4 = 0xc3d2e1f0

  const w = new Uint32Array(80)
  for (let i = 0; i < total; i += 64) {
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(i + j * 4)
    for (let j = 16; j < 80; j++) {
      const n = w[j - 3] ^ w[j - 8] ^ w[j - 14] ^ w[j - 16]
      w[j] = (n << 1) | (n >>> 31)
    }
    let a = h0
    let b = h1
    let c = h2
    let d = h3
    let e = h4
    for (let j = 0; j < 80; j++) {
      let f: number
      let k: number
      if (j < 20) {
        f = (b & c) | (~b & d)
        k = 0x5a827999
      } else if (j < 40) {
        f = b ^ c ^ d
        k = 0x6ed9eba1
      } else if (j < 60) {
        f = (b & c) | (b & d) | (c & d)
        k = 0x8f1bbcdc
      } else {
        f = b ^ c ^ d
        k = 0xca62c1d6
      }
      const tmp = (((a << 5) | (a >>> 27)) + f + e + k + w[j]) | 0
      e = d
      d = c
      c = (b << 30) | (b >>> 2)
      b = a
      a = tmp
    }
    h0 = (h0 + a) | 0
    h1 = (h1 + b) | 0
    h2 = (h2 + c) | 0
    h3 = (h3 + d) | 0
    h4 = (h4 + e) | 0
  }
  const hex = (n: number) => (n >>> 0).toString(16).padStart(8, "0")
  return hex(h0) + hex(h1) + hex(h2) + hex(h3) + hex(h4)
}

/** Strip a leading +/-/space diff marker and trailing whitespace from one line. */
export function normalizeLine(content: string): string {
  const first = content.charAt(0)
  const body =
    first === "+" || first === "-" || first === " " ? content.slice(1) : content
  return body.replace(/\s+$/, "")
}

/**
 * The content anchor for a comment: sha1 of `path + " " + normalized text`,
 * where `lines` are the RAW diff-change contents (markers included) of the
 * commented new-side line(s). Pass an empty array for a whole-file note.
 */
export function anchorHashFor(path: string, lines: string[]): string {
  const normalized = lines.map(normalizeLine).join("\n")
  return sha1(`${path} ${normalized}`)
}

/** Short, collision-resistant-enough id for a freshly created comment. */
export function commentId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === "function") return c.randomUUID().slice(0, 8)
  return Math.random().toString(36).slice(2, 10)
}

/** True for a whole-file note (no line anchor). */
export function isFileLevel(c: Pick<Comment, "startLine">): boolean {
  return c.startLine <= 0
}

// ── Resolving stored comments against the current parsed diff ─────────────────

/** A stored comment re-anchored to the CURRENT diff. */
export interface ResolvedComment extends Comment {
  /** True when the anchor no longer matches any run in the current diff. */
  orphaned: boolean
  /** Current commented code (markers stripped); empty when orphaned/file-level. */
  code: string[]
}

type NewLine = { line: number; content: string }

/** Ordered new-side lines (add + context) of a file, with raw contents. */
function newSideLines(file: ParsedFile): NewLine[] {
  const out: NewLine[] = []
  for (const chunk of file.chunks) {
    for (const ch of chunk.changes) {
      if (ch.type === "add") out.push({ line: ch.ln, content: ch.content })
      else if (ch.type === "normal")
        out.push({ line: ch.ln2, content: ch.content })
    }
  }
  return out
}

export interface CommentResolver {
  /** Re-anchor one stored comment against the current diff. */
  resolve: (comment: Comment) => ResolvedComment
}

/**
 * Build a resolver over the current parsed diff. For each comment we slide a
 * window of its original length over the file's new-side lines and match by
 * content hash; the first match wins. Per-(path,length) hash maps are memoised
 * so repeated comments on one file stay cheap. Best-effort by design — a moved
 * or rewritten block simply orphans.
 */
export function buildResolver(files: ParsedFile[]): CommentResolver {
  const linesByPath = new Map<string, NewLine[]>()
  const paths = new Set<string>()
  for (const f of files) {
    const p = filePath(f)
    paths.add(p)
    linesByPath.set(p, newSideLines(f))
  }

  type Hit = { startLine: number; endLine: number; code: string[] }
  const cache = new Map<string, Map<string, Hit>>()

  function mapFor(path: string, len: number): Map<string, Hit> {
    const key = `${path}\u0000${len}`
    const cached = cache.get(key)
    if (cached) return cached
    const map = new Map<string, Hit>()
    const lines = linesByPath.get(path) ?? []
    for (let i = 0; i + len <= lines.length; i++) {
      const window = lines.slice(i, i + len)
      const hash = anchorHashFor(
        path,
        window.map((w) => w.content),
      )
      if (!map.has(hash)) {
        map.set(hash, {
          startLine: window[0].line,
          endLine: window[len - 1].line,
          code: window.map((w) => normalizeLine(w.content)),
        })
      }
    }
    cache.set(key, map)
    return map
  }

  function resolve(comment: Comment): ResolvedComment {
    const exists = paths.has(comment.path)
    if (isFileLevel(comment)) {
      return { ...comment, orphaned: !exists, code: [] }
    }
    if (!exists) return { ...comment, orphaned: true, code: [] }
    const len = Math.max(1, comment.endLine - comment.startLine + 1)
    const hit = mapFor(comment.path, len).get(comment.anchorHash)
    if (!hit) return { ...comment, orphaned: true, code: [] }
    return {
      ...comment,
      startLine: hit.startLine,
      endLine: hit.endLine,
      orphaned: false,
      code: hit.code,
    }
  }

  return { resolve }
}

// ── "Copy for AI" Markdown worklist ───────────────────────────────────────────

const LANG_BY_EXT: Record<string, string> = {
  ts: "ts",
  tsx: "tsx",
  mts: "ts",
  cts: "ts",
  js: "js",
  jsx: "jsx",
  mjs: "js",
  cjs: "js",
  py: "py",
  go: "go",
  rs: "rs",
  json: "json",
  jsonc: "json",
  md: "md",
  mdx: "md",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  svelte: "svelte",
  vue: "vue",
  java: "java",
  kt: "kotlin",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  hpp: "cpp",
  cs: "csharp",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  yml: "yaml",
  yaml: "yaml",
  toml: "toml",
  sql: "sql",
  prisma: "prisma",
  graphql: "graphql",
  gql: "graphql",
}

/** Fenced-code language token from a file extension, or "" when unknown. */
export function langForPath(path: string): string {
  const dot = path.lastIndexOf(".")
  if (dot === -1) return ""
  return LANG_BY_EXT[path.slice(dot + 1).toLowerCase()] ?? ""
}

/** Plain "File" / "L12" / "L12–15" location label (for the UI). */
export function lineLabel(c: Pick<Comment, "startLine" | "endLine">): string {
  if (c.startLine <= 0) return "File"
  if (c.endLine > c.startLine) return `L${c.startLine}–${c.endLine}`
  return `L${c.startLine}`
}

/** The Markdown-bold "**L12**" / "**L12**–15" / "**File**" label. */
function rangeLabel(c: ResolvedComment): string {
  if (isFileLevel(c)) return "**File**"
  if (c.endLine > c.startLine) return `**L${c.startLine}**–${c.endLine}`
  return `**L${c.startLine}**`
}

/**
 * Build the Markdown worklist handed to the AI agent. Files are alphabetical,
 * comments within a file ordered by start line. Resolved comments carry a fenced
 * code block of the current line(s); orphaned ones carry a "may have moved" note.
 */
export function buildWorklist(
  comments: ResolvedComment[],
  meta: { repoPath: string | null; base: string; compare: string },
): string {
  // Only open notes are actionable — addressed/resolved ones are already done.
  const open = comments.filter((c) => commentState(c) === "open")
  const lines: string[] = []
  lines.push(`Review notes — ${meta.repoPath ?? "(unknown repo)"}`)
  lines.push(`Comparing ${meta.base} → ${meta.compare}`)
  lines.push(`${open.length} open note${open.length === 1 ? "" : "s"}`)
  lines.push("")

  const byPath = new Map<string, ResolvedComment[]>()
  for (const c of open) {
    const arr = byPath.get(c.path) ?? []
    arr.push(c)
    byPath.set(c.path, arr)
  }

  const paths = [...byPath.keys()].sort((a, b) => a.localeCompare(b))
  for (const path of paths) {
    lines.push(`## ${path}`)
    const lang = langForPath(path)
    const group = byPath
      .get(path)!
      .slice()
      .sort((a, b) => a.startLine - b.startLine || a.createdAt.localeCompare(b.createdAt))
    for (const c of group) {
      const body = c.body.trim().replace(/\n/g, "\n  ")
      lines.push(`- ${rangeLabel(c)} — ${body}`)
      if (c.orphaned) {
        lines.push("  (location may have moved)")
      } else if (c.code.length > 0) {
        lines.push(`  \`\`\`${lang}`)
        for (const codeLine of c.code) lines.push(`  ${codeLine}`)
        lines.push("  ```")
      }
    }
    lines.push("")
  }

  return `${lines.join("\n").trimEnd()}\n`
}
