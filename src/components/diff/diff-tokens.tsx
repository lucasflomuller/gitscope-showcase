"use client"

import type { CSSProperties } from "react"

import { cn } from "@/lib/utils"

import type { ParsedChange } from "./file-meta"
import type { ThemedToken } from "./highlighter"
import type { CharRange } from "./word-diff"

function markerClass(type: ParsedChange["type"]): string {
  if (type === "add") return "diff-marker-add"
  if (type === "del") return "diff-marker-del"
  return "text-muted-foreground/40"
}

type Segment = { text: string; light?: string; dark?: string; word: boolean }

function offsetInRanges(offset: number, ranges: CharRange[]): boolean {
  for (const r of ranges) if (offset >= r.start && offset < r.end) return true
  return false
}

/**
 * Merge Shiki tokens with word-diff ranges into render segments. Any token that
 * straddles a changed-range boundary is split so a `<span>` can carry the word
 * background on exactly the changed sub-range. When `tokens` is absent the whole
 * line is one uncolored token (plain fallback) that is still split by ranges.
 */
function buildSegments(
  text: string,
  tokens: ThemedToken[] | null,
  ranges: CharRange[] | null,
): Segment[] {
  const base: ThemedToken[] =
    tokens && tokens.length ? tokens : [{ content: text, light: "", dark: "" }]

  const segs: Segment[] = []
  let pos = 0
  for (const tk of base) {
    const content = tk.content
    if (!content) continue
    const light = tk.light || undefined
    const dark = tk.dark || undefined

    if (!ranges || ranges.length === 0) {
      segs.push({ text: content, light, dark, word: false })
      pos += content.length
      continue
    }

    // Split this token wherever a word range starts/ends inside it.
    let local = 0
    while (local < content.length) {
      const abs = pos + local
      const word = offsetInRanges(abs, ranges)
      let end = content.length
      for (const r of ranges) {
        const s = r.start - pos
        const e = r.end - pos
        if (s > local && s < end) end = s
        if (e > local && e < end) end = e
      }
      segs.push({ text: content.slice(local, end), light, dark, word })
      local = end
    }
    pos += content.length
  }

  if (segs.length === 0) segs.push({ text, word: false })
  return segs
}

/**
 * A diff line's content: the leading +/-/space marker (kept colored as before)
 * plus Shiki-colored, word-diff-aware text. Falls back to plain text when no
 * tokens are available, so the line is always legible.
 */
export function LineTokens({
  change,
  tokens,
  wordRanges,
}: {
  change: ParsedChange
  tokens?: ThemedToken[] | null
  wordRanges?: CharRange[] | null
}) {
  const marker = change.content.slice(0, 1) || " "
  const text = change.content.slice(1)
  const wordCls =
    change.type === "add"
      ? "diff-word-add"
      : change.type === "del"
        ? "diff-word-del"
        : null

  const segments = buildSegments(
    text,
    tokens ?? null,
    wordCls ? (wordRanges ?? null) : null,
  )

  return (
    <>
      <span className={cn("select-none", markerClass(change.type))}>{marker}</span>
      {segments.map((s, i) => (
        <span
          key={i}
          className={cn(s.light != null && "diff-tok", s.word && wordCls)}
          style={
            s.light != null
              ? ({ "--shiki-light": s.light, "--shiki-dark": s.dark } as CSSProperties)
              : undefined
          }
        >
          {s.text}
        </span>
      ))}
    </>
  )
}
