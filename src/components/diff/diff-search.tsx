"use client"

import { useEffect, useRef } from "react"
import { Search } from "lucide-react"

import { cn } from "@/lib/utils"

import { basename, dirname } from "./references-meta"
import type { SearchMatch, SearchResults } from "./search-meta"

/**
 * In-toolbar diff search. Renders nothing until `open`, so the toolbar layout is
 * unaffected while closed. The visible match list is already capped at
 * MAX_MATCHES upstream; a "+N more" footer shows when the total overflows.
 *
 * The control is a plain <input>, so the viewer's global j/k/v and '/' handlers
 * skip it (they bail on INPUT/TEXTAREA/contentEditable).
 */
export function DiffSearch({
  open,
  query,
  onQueryChange,
  onClose,
  results,
  onJump,
  fill,
}: {
  /** Stretch to the container width (compact layout gives search its own row). */
  fill?: boolean
  open: boolean
  query: string
  onQueryChange: (q: string) => void
  onClose: () => void
  results: SearchResults
  onJump: (m: SearchMatch) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  if (!open) return null

  const trimmed = query.trim()
  const hasQuery = trimmed.length >= 2
  const remaining = results.total - results.matches.length

  let count: string
  if (!hasQuery) count = "Type to search"
  else if (results.total === 0) count = "No matches"
  else
    count = `${results.total} result${results.total === 1 ? "" : "s"} in ${
      results.fileCount
    } file${results.fileCount === 1 ? "" : "s"}`

  return (
    <div className={cn("relative flex items-center", fill && "w-full")}>
      <div
        className={cn(
          "flex h-8 items-center gap-1.5 rounded-md border bg-background px-2 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 pointer-coarse:h-9",
          fill && "min-w-0 flex-1",
        )}
      >
        <Search className="size-3.5 shrink-0 text-muted-foreground" />
        <input
          ref={inputRef}
          autoFocus
          aria-label="Search in diff"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault()
              onClose()
            } else if (e.key === "Enter") {
              e.preventDefault()
              const first = results.matches[0]
              if (first) onJump(first)
            }
          }}
          placeholder="Search diff…"
          spellCheck={false}
          autoComplete="off"
          className={cn(
            "min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground",
            // 16px on touch: anything smaller makes iOS Safari zoom on focus.
            fill ? "flex-1 pointer-coarse:text-base" : "w-40 sm:w-56",
          )}
        />
        {/* Live region: the count is the only feedback a screen reader gets
            back after typing a query. */}
        <span
          role="status"
          aria-live="polite"
          className="shrink-0 whitespace-nowrap text-[11px] tabular-nums text-muted-foreground"
        >
          {count}
        </span>
      </div>

      {hasQuery && results.matches.length > 0 && (
        <div
          className={cn(
            "absolute top-full left-0 z-50 mt-1 max-h-80 w-[22rem] max-w-[calc(100vw-1.5rem)] origin-top animate-in overflow-y-auto rounded-lg bg-popover p-1 text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 fade-in-0 zoom-in-95",
            fill && "max-h-[55dvh] w-full",
          )}
        >
          {results.matches.map((m, i) => {
            const dir = dirname(m.path)
            const base = basename(m.path)
            const jumpable = m.line != null
            return (
              <button
                key={`${m.path}:${m.line}:${i}`}
                type="button"
                onClick={() => onJump(m)}
                title={jumpable ? `Jump to ${m.path}:${m.line}` : m.path}
                className={cn(
                  "flex w-full flex-col gap-1 rounded-md px-2 py-1.5 text-left transition-colors",
                  "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                  "pointer-coarse:py-2.5",
                )}
              >
                <div className="flex min-w-0 items-baseline font-mono text-xs">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {dir}
                  </span>
                  <span className="shrink-0 font-medium text-foreground">
                    {base}
                  </span>
                  {jumpable && (
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      :{m.line}
                    </span>
                  )}
                </div>
                <div
                  className={cn(
                    "truncate rounded bg-muted/60 px-1.5 py-1 font-mono text-[11px] leading-snug pointer-coarse:text-xs",
                    jumpable ? "text-muted-foreground" : "text-muted-foreground/60",
                  )}
                >
                  {m.text.trim() || " "}
                </div>
              </button>
            )
          })}
          {results.capped && (
            <div className="px-2 py-1.5 text-center text-[11px] text-muted-foreground">
              +{remaining} more
            </div>
          )}
        </div>
      )}
    </div>
  )
}
