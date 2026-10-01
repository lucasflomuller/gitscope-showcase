"use client"

import {
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  GitPullRequestDraft,
  type LucideIcon,
} from "lucide-react"

import type { PrInfo, PrState } from "@/lib/types"
import { cn } from "@/lib/utils"

/**
 * A quiet, GitHub-canon-colored Pull Request indicator.
 *
 * Two variants:
 *  - `bare` (default, ref-picker rows): no background — a colored glyph + muted
 *    `#N`. Adds zero row height; the shape + color carry the state.
 *  - `soft` (dashboard card): a tinted `rounded-full` pill, one per card.
 *
 * The shape carries the state, so we never add a second glyph: `reviewDecision`
 * and the `+N more` count live in the tooltip only (the user values an
 * uncluttered UI). State → color is GitHub's own convention: open = green,
 * draft = gray, merged = purple, closed = red. All four lucide icons are present
 * in the installed `lucide-react`.
 */
const PR_META: Record<
  PrState,
  { Icon: LucideIcon; label: string; bare: string; soft: string }
> = {
  open: {
    Icon: GitPullRequest,
    label: "Open",
    bare: "text-emerald-600 dark:text-emerald-500",
    soft: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20",
  },
  draft: {
    Icon: GitPullRequestDraft,
    label: "Draft",
    bare: "text-muted-foreground",
    soft: "bg-muted text-muted-foreground hover:bg-muted/70",
  },
  merged: {
    Icon: GitMerge,
    label: "Merged",
    bare: "text-violet-600 dark:text-violet-400",
    soft: "bg-violet-500/10 text-violet-700 dark:text-violet-400 hover:bg-violet-500/20",
  },
  closed: {
    Icon: GitPullRequestClosed,
    label: "Closed",
    bare: "text-destructive",
    soft: "bg-destructive/10 text-destructive hover:bg-destructive/20",
  },
}

export function PrBadge({
  pr,
  variant = "bare",
  interactive = true,
  className,
}: {
  pr: PrInfo
  /** "bare" = picker row (no fill); "soft" = dashboard pill (tinted). */
  variant?: "bare" | "soft"
  /**
   * `true` (default) renders a real `<a target="_blank">` so a click opens the
   * PR in a new tab. `false` renders an inert `<span>` — REQUIRED inside the
   * dashboard card `<button>`, where a nested `<a>` would be invalid HTML.
   */
  interactive?: boolean
  className?: string
}) {
  const m = PR_META[pr.state]
  // Everything beyond the glyph + #N goes here, never into a second visible mark.
  const title =
    `#${pr.number} · ${m.label}` +
    (pr.reviewDecision === "APPROVED" ? " · approved" : "") +
    (pr.extra > 0 ? ` · +${pr.extra} more` : "") +
    ` — ${pr.title}`

  const cls = cn(
    "inline-flex shrink-0 items-center gap-1 rounded-full text-[10px] font-medium whitespace-nowrap transition-colors",
    variant === "bare"
      ? "px-0.5 text-muted-foreground"
      : cn("h-4 px-1.5 py-0.5", m.soft),
    interactive &&
      "cursor-pointer hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50",
    className,
  )

  const inner = (
    <>
      <m.Icon className={cn("size-3 shrink-0", variant === "bare" && m.bare)} />
      <span className="tabular-nums">#{pr.number}</span>
    </>
  )

  if (!interactive) {
    return (
      <span className={cls} title={title}>
        {inner}
      </span>
    )
  }

  return (
    <a
      href={pr.url}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      aria-label={title}
      className={cls}
      // Keep the click/keypress from reaching the enclosing CommandItem's
      // onSelect (which would change the compare ref). The list keeps owning
      // ↑/↓/↵ navigation; only a direct click on the badge opens the PR.
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.stopPropagation()
      }}
    >
      {inner}
    </a>
  )
}
