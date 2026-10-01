"use client"

import {
  Circle,
  CircleCheckBig,
  FileMinus2,
  FilePenLine,
  FilePlus2,
  FileSymlink,
} from "lucide-react"
import parseDiff from "parse-diff"

import type { DiffFileStatus } from "@/lib/types"
import type { ViewedController } from "@/hooks/use-viewed"
import { cn } from "@/lib/utils"

export type ParsedFile = ReturnType<typeof parseDiff>[number]
export type ParsedChunk = ParsedFile["chunks"][number]
export type ParsedChange = ParsedChunk["changes"][number]

/** Re-exported here so callers can keep importing file helpers from one module. */
export { isWhitespaceOnlyFile as isWhitespaceOnly } from "./noise"

/** The display/identity path for a parsed file (its "to" side, or "from" when deleted). */
export function filePath(file: ParsedFile): string {
  const to = file.to && file.to !== "/dev/null" ? file.to : undefined
  const from = file.from && file.from !== "/dev/null" ? file.from : undefined
  return to ?? from ?? "unknown"
}

/** First new-side line a chunk changes (added line first, else its first context line). */
export function chunkAnchorLine(chunk: ParsedChunk): number | null {
  for (const ch of chunk.changes) if (ch.type === "add") return ch.ln
  for (const ch of chunk.changes) if (ch.type === "normal") return ch.ln2
  return null
}

export function fileStatus(file: ParsedFile): DiffFileStatus {
  if (file.new || file.from === "/dev/null") return "added"
  if (file.deleted || file.to === "/dev/null") return "deleted"
  if (file.from && file.to && file.from !== file.to) return "renamed"
  return "modified"
}

export function FileStatusIcon({
  status,
  className,
}: {
  status: DiffFileStatus
  className?: string
}) {
  const base = cn("size-3.5 shrink-0", className)
  // Labelled: row buttons only carry the path, so without a name here the
  // status is glyph shape + green/red alone and never reaches a screen reader.
  if (status === "added")
    return (
      <FilePlus2
        role="img"
        aria-label="Added"
        className={cn(base, "text-[var(--diff-add-marker)]")}
      />
    )
  if (status === "deleted")
    return (
      <FileMinus2
        role="img"
        aria-label="Deleted"
        className={cn(base, "text-[var(--diff-del-marker)]")}
      />
    )
  if (status === "renamed")
    return (
      <FileSymlink
        role="img"
        aria-label="Renamed"
        className={cn(base, "text-muted-foreground")}
      />
    )
  return (
    <FilePenLine
      role="img"
      aria-label="Modified"
      className={cn(base, "text-muted-foreground")}
    />
  )
}

/**
 * Per-row viewed toggle. A span (not a button) because every file row is itself
 * a <button> and nesting buttons is invalid; `v` and the toolbar button provide
 * the keyboard path. Descendants of a button are presentational, so checkbox
 * ARIA here would be dropped — the state rides along as sr-only text that the
 * row button's accessible name picks up instead.
 */
export function ViewedCheck({
  viewed,
  path,
}: {
  viewed?: ViewedController
  path: string
}) {
  if (!viewed) return null
  const isViewed = viewed.isViewed(path)
  return (
    <span
      title={isViewed ? "Viewed — click to unmark" : "Mark viewed"}
      onClick={(e) => {
        e.stopPropagation()
        viewed.toggle(path)
      }}
      className={cn(
        // Tinted off --foreground, not bg-muted: --muted === --accent, so a muted
        // hover would vanish against the row's own hover/selected surface.
        "flex shrink-0 items-center justify-center rounded-sm p-0.5 transition-colors hover:bg-foreground/10 pointer-coarse:size-9 pointer-coarse:p-0",
        isViewed
          ? "text-[var(--diff-add-marker)]"
          : "text-muted-foreground/40 hover:text-foreground",
      )}
    >
      {isViewed ? (
        <CircleCheckBig className="size-3.5 pointer-coarse:size-4" />
      ) : (
        <Circle className="size-3.5 pointer-coarse:size-4" />
      )}
      <span className="sr-only">{isViewed ? "viewed" : "not viewed"}</span>
    </span>
  )
}

/** Muted pill marking a de-emphasized generated / whitespace-only file. */
export function NoiseBadge({
  kind,
  className,
}: {
  kind: "generated" | "whitespace"
  className?: string
}) {
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm border px-1 py-px text-[10px] font-medium tracking-wide text-muted-foreground/80 uppercase pointer-coarse:text-[11px]",
        className,
      )}
    >
      {kind === "generated" ? "Generated" : "Whitespace"}
    </span>
  )
}
