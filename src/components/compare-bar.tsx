"use client"

import * as React from "react"
import {
  ArrowLeftRight,
  ArrowRight,
  ArrowUpDown,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GitCommitHorizontal,
  X,
} from "lucide-react"

import type { CommitInfo, DiffMode, PrInfo, RefInfo, RepoRefs } from "@/lib/types"
import { formatAbsolute, formatRelativeTime } from "@/lib/format-time"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { RefCommandList, RefKindIcon, RefPicker } from "@/components/ref-picker"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type CompareBarProps = {
  refs?: RepoRefs
  /** headRefName → primary PR, threaded into the ref list as per-branch badges. */
  prByBranch?: Record<string, PrInfo>
  base: RefInfo | null
  compare: RefInfo | null
  onBaseChange: (r: RefInfo) => void
  onCompareChange: (r: RefInfo) => void
  mode: DiffMode
  onModeChange: (m: DiffMode) => void
  onSwap: () => void
  stats?: { files: number; additions: number; deletions: number }
  loading?: boolean
  /** True while the SSE working-tree watcher is connected (live diff refresh). */
  live?: boolean
  /** Review-by-commit: commits in base..compare (newest-first, as returned). */
  commits?: CommitInfo[]
  /** True when both refs are commit-ish (not working/staged) so stepping applies. */
  commitReviewEnabled?: boolean
  /** The commit currently being viewed in isolation, or null for the range diff. */
  commitSha?: string | null
  onPickCommit?: (sha: string) => void
  onExitCommit?: () => void
}

/**
 * Review-by-commit affordance: when both refs are commit-ish, either a popover
 * listing the commits in base..compare (drill into one) or, while a single
 * commit is being viewed, a ‹ › stepper + exit. Commits arrive newest-first;
 * stepping walks oldest→newest so ‹ is older and › is newer.
 */
function CommitReview({
  commits,
  commitSha,
  onPickCommit,
  onExitCommit,
}: {
  commits: CommitInfo[]
  commitSha: string | null
  onPickCommit: (sha: string) => void
  onExitCommit: () => void
}) {
  const [open, setOpen] = React.useState(false)

  if (commitSha != null) {
    const ordered = [...commits].reverse()
    const idx = ordered.findIndex((c) => c.hash === commitSha)
    const n = ordered.length
    const current = idx >= 0 ? ordered[idx] : null
    return (
      <div className="inline-flex min-w-0 shrink items-center gap-1 rounded-lg border bg-muted/40 px-1 py-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Exit commit view"
                onClick={onExitCommit}
                className="size-7 shrink-0 text-muted-foreground pointer-coarse:size-8"
              />
            }
          >
            <X />
          </TooltipTrigger>
          <TooltipContent>Back to the range diff</TooltipContent>
        </Tooltip>
        <GitCommitHorizontal className="size-3.5 shrink-0 text-muted-foreground" />
        {current ? (
          /* The subject is the first thing to truncate in this crowded row, so
             title the hash+subject pair — hovering either half reads the whole. */
          <span
            className="flex min-w-0 items-center gap-1.5"
            title={`${current.shortHash} ${current.subject}`}
          >
            <span className="shrink-0 font-mono text-xs text-muted-foreground">
              {current.shortHash}
            </span>
            <span className="truncate text-xs">{current.subject}</span>
          </span>
        ) : null}
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Older commit"
          disabled={idx <= 0}
          onClick={() => onPickCommit(ordered[idx - 1].hash)}
          className="size-7 shrink-0 text-muted-foreground pointer-coarse:size-8"
        >
          <ChevronLeft />
        </Button>
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
          {idx >= 0 ? idx + 1 : "—"} of {n}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Newer commit"
          disabled={idx < 0 || idx >= n - 1}
          onClick={() => onPickCommit(ordered[idx + 1].hash)}
          className="size-7 shrink-0 text-muted-foreground pointer-coarse:size-8"
        >
          <ChevronRight />
        </Button>
      </div>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="xs"
            className="h-8 shrink-0 gap-1.5 pointer-coarse:h-9"
          />
        }
      >
        <GitCommitHorizontal className="size-3.5" />
        <span>Commits ({commits.length})</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-1.5rem)] p-0">
        <div className="border-b px-3 py-2 text-xs font-medium text-muted-foreground">
          Review by commit
        </div>
        <div className="max-h-[min(60vh,360px)] overflow-y-auto py-1">
          {commits.length === 0 ? (
            <div className="px-3 py-6 text-center text-xs text-muted-foreground">
              No commits in this range
            </div>
          ) : (
            commits.map((c) => (
              <button
                key={c.hash}
                type="button"
                onClick={() => {
                  onPickCommit(c.hash)
                  setOpen(false)
                }}
                title={`${c.shortHash} ${c.subject}`}
                className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left hover:bg-accent pointer-coarse:py-2.5"
              >
                <span className="shrink-0 font-mono text-xs text-muted-foreground">
                  {c.shortHash}
                </span>
                <span className="min-w-0 flex-1 truncate text-xs">{c.subject}</span>
                {/* Not c.relativeDate (git's own "%cr" wording) — every other
                    timestamp in the app speaks the compact "3h ago" dialect. */}
                <span
                  className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                  title={formatAbsolute(c.date)}
                >
                  {formatRelativeTime(c.date)}
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ModeButton({
  active,
  onClick,
  label,
  tip,
}: {
  active: boolean
  onClick: () => void
  label: string
  tip: string
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={active ? "secondary" : "ghost"}
            size="xs"
            aria-pressed={active}
            onClick={onClick}
            className={cn(
              "h-6 font-mono pointer-coarse:h-8",
              active ? "shadow-sm" : "text-muted-foreground"
            )}
          />
        }
      >
        {label}
      </TooltipTrigger>
      <TooltipContent>{tip}</TooltipContent>
    </Tooltip>
  )
}

function ModeToggle({
  mode,
  onModeChange,
}: {
  mode: DiffMode
  onModeChange: (m: DiffMode) => void
}) {
  return (
    <div className="inline-flex shrink-0 items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5">
      <ModeButton
        active={mode === "merge-base"}
        onClick={() => onModeChange("merge-base")}
        label="merge-base"
        tip="Merge base — git diff base...compare (what a PR shows)"
      />
      <ModeButton
        active={mode === "direct"}
        onClick={() => onModeChange("direct")}
        label="direct"
        tip="Direct — git diff base..compare (raw tree-to-tree)"
      />
    </div>
  )
}

function Stats({
  stats,
  loading,
}: {
  stats?: CompareBarProps["stats"]
  loading?: boolean
}) {
  if (loading) return <Skeleton className="h-4 w-20 shrink-0" />
  if (!stats) return null
  return (
    <div className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted-foreground">
      <span>
        {stats.files} {stats.files === 1 ? "file" : "files"}
      </span>
      <span className="text-[var(--diff-add-marker)]">+{stats.additions}</span>
      <span className="text-[var(--diff-del-marker)]">−{stats.deletions}</span>
    </div>
  )
}

/** One side of the comparison in the mobile sheet: a tappable slot that makes
 *  the ref list below edit this side. */
function SideSlot({
  label,
  value,
  fallback,
  active,
  onActivate,
}: {
  label: string
  value: RefInfo | null
  fallback: string
  active: boolean
  onActivate: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onActivate}
      className={cn(
        "flex min-w-0 flex-1 flex-col gap-0.5 rounded-lg border px-3 py-2 text-left transition-colors",
        active
          ? "border-foreground/30 bg-muted ring-2 ring-ring/40"
          : "bg-background hover:bg-muted/50",
      )}
    >
      <span
        className={cn(
          "text-[10px] font-medium tracking-wide uppercase",
          active ? "text-foreground" : "text-muted-foreground",
        )}
      >
        {label}
      </span>
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        <RefKindIcon
          kind={value?.kind ?? "branch"}
          className="size-4 shrink-0 text-muted-foreground"
        />
        <span
          className={cn("truncate font-medium", !value && "font-normal text-muted-foreground")}
        >
          {value?.label ?? fallback}
        </span>
      </span>
    </button>
  )
}

/**
 * Compact / touch comparison control. The trigger sits in the top bar as a
 * two-line summary (repo · mode over base → compare) so the whole comparison
 * is legible without opening anything; tapping it opens a bottom sheet with
 * explicit Base / Compare slots, a swap, the diff mode and the searchable ref
 * list — thumb-reachable and full height instead of a cramped popover.
 */
export function CompareTrigger({
  refs,
  prByBranch,
  base,
  compare,
  onBaseChange,
  onCompareChange,
  mode,
  onModeChange,
  onSwap,
  className,
  title,
  live,
  commits = [],
  commitReviewEnabled,
  commitSha,
  onPickCommit,
  onExitCommit,
}: CompareBarProps & { className?: string; title?: string }) {
  const [open, setOpen] = React.useState(false)
  const [side, setSide] = React.useState<"base" | "compare">("compare")

  const activeValue = side === "base" ? base : compare

  const showCommitReview =
    commitReviewEnabled && (commits.length > 0 || commitSha != null)
  const ordered = commitSha != null ? [...commits].reverse() : []
  const commitIdx = ordered.findIndex((c) => c.hash === commitSha)

  return (
    <Sheet
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        // Every visit starts on the side you most often change.
        if (o) setSide("compare")
      }}
    >
      <SheetTrigger
        disabled={!refs}
        render={
          <button
            type="button"
            className={cn(
              "flex h-10 min-w-0 flex-col justify-center rounded-lg px-2 text-left transition-colors hover:bg-muted active:bg-muted disabled:opacity-60",
              className,
            )}
          />
        }
      >
        <span className="flex min-w-0 items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
          <span className="truncate font-medium text-foreground">{title}</span>
          {live ? (
            <span
              className="relative flex size-1.5 shrink-0"
              title="Watching the working tree"
            >
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/50" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500/80" />
            </span>
          ) : null}
          <span className="shrink-0">· {mode}</span>
          {commitSha != null && commitIdx >= 0 ? (
            <span className="shrink-0 tabular-nums">
              · commit {commitIdx + 1}/{ordered.length}
            </span>
          ) : null}
        </span>
        <span className="flex min-w-0 items-center gap-1 text-[13px] leading-5">
          <span
            className={cn(
              "min-w-0 max-w-[45%] shrink truncate text-muted-foreground",
            )}
          >
            {base?.label ?? "base"}
          </span>
          <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
          <span className={cn("min-w-0 truncate font-medium", !compare && "text-muted-foreground")}>
            {compare?.label ?? "compare"}
          </span>
          <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
        </span>
      </SheetTrigger>

      <SheetContent
        side="bottom"
        showCloseButton={false}
        className="mx-auto max-w-xl data-[side=bottom]:h-[88dvh] gap-0 rounded-t-2xl p-0 pb-[env(safe-area-inset-bottom)] sm:border-x"
      >
        {/* Grab handle — purely visual; the backdrop and Done both dismiss. */}
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-muted-foreground/30" />

        <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-2 pb-1">
          <SheetTitle className="text-sm font-semibold">Comparison</SheetTitle>
          <SheetClose
            render={<Button variant="ghost" size="sm" className="h-9 px-3" />}
          >
            Done
          </SheetClose>
        </div>

        <div className="flex shrink-0 flex-col gap-3 border-b px-4 pt-1 pb-3">
          <div className="flex items-stretch gap-2">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <SideSlot
                label="Base"
                value={base}
                fallback="Pick a base"
                active={side === "base"}
                onActivate={() => setSide("base")}
              />
              <SideSlot
                label="Compare"
                value={compare}
                fallback="Pick a compare"
                active={side === "compare"}
                onActivate={() => setSide("compare")}
              />
            </div>
            <Button
              variant="outline"
              aria-label="Swap base and compare"
              disabled={!base && !compare}
              onClick={onSwap}
              className="h-auto w-11 shrink-0 text-muted-foreground"
            >
              <ArrowUpDown />
            </Button>
          </div>

          {/* Full-width segmented control; the hint says what the mode means
              since there is no hover tooltip on touch. */}
          <div className="flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-0.5 rounded-lg border bg-muted/40 p-0.5">
              {(["merge-base", "direct"] as const).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={mode === m ? "secondary" : "ghost"}
                  aria-pressed={mode === m}
                  onClick={() => onModeChange(m)}
                  className={cn(
                    "h-9 font-mono",
                    mode === m ? "shadow-sm" : "text-muted-foreground",
                  )}
                >
                  {m}
                </Button>
              ))}
            </div>
            <p className="px-0.5 text-[11px] text-muted-foreground">
              {mode === "merge-base"
                ? <>What a PR shows: changes since the branches diverged <code className="font-mono">base...compare</code></>
                : <>Raw tree-to-tree difference between the two refs <code className="font-mono">base..compare</code></>}
            </p>
          </div>

          {showCommitReview ? (
            commitSha != null ? (
              <div className="flex items-center gap-1 rounded-lg border bg-muted/40 p-1">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Exit commit view"
                  onClick={() => onExitCommit?.()}
                  className="size-9 shrink-0 text-muted-foreground"
                >
                  <X />
                </Button>
                <span
                  className="min-w-0 flex-1 truncate text-xs"
                  title={
                    commitIdx >= 0
                      ? `${ordered[commitIdx].shortHash} ${ordered[commitIdx].subject}`
                      : undefined
                  }
                >
                  <span className="font-mono text-muted-foreground">
                    {commitIdx >= 0 ? ordered[commitIdx].shortHash : "—"}
                  </span>{" "}
                  {commitIdx >= 0 ? ordered[commitIdx].subject : null}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Older commit"
                  disabled={commitIdx <= 0}
                  onClick={() => onPickCommit?.(ordered[commitIdx - 1].hash)}
                  className="size-9 shrink-0 text-muted-foreground"
                >
                  <ChevronLeft />
                </Button>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {commitIdx >= 0 ? commitIdx + 1 : "—"}/{ordered.length}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Newer commit"
                  disabled={commitIdx < 0 || commitIdx >= ordered.length - 1}
                  onClick={() => onPickCommit?.(ordered[commitIdx + 1].hash)}
                  className="size-9 shrink-0 text-muted-foreground"
                >
                  <ChevronRight />
                </Button>
              </div>
            ) : (
              <details className="group rounded-lg border">
                <summary className="flex h-10 list-none items-center gap-2 px-3 text-sm [&::-webkit-details-marker]:hidden">
                  <GitCommitHorizontal className="size-4 text-muted-foreground" />
                  Review by commit
                  <span className="text-muted-foreground tabular-nums">({commits.length})</span>
                  <ChevronDown className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="max-h-[30dvh] overflow-y-auto border-t py-1">
                  {commits.map((c) => (
                    <button
                      key={c.hash}
                      type="button"
                      onClick={() => {
                        onPickCommit?.(c.hash)
                        setOpen(false)
                      }}
                      title={`${c.shortHash} ${c.subject}`}
                      className="flex w-full items-baseline gap-2 px-3 py-2.5 text-left hover:bg-accent"
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">
                        {c.shortHash}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-xs">{c.subject}</span>
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {formatRelativeTime(c.date)}
                      </span>
                    </button>
                  ))}
                </div>
              </details>
            )
          ) : null}
        </div>

        <div className="px-4 pt-2 text-[11px] font-medium text-muted-foreground">
          Choose {side === "base" ? "base" : "compare"} ref
        </div>
        <RefCommandList
          refs={refs}
          prByBranch={prByBranch}
          value={activeValue}
          className="min-h-0 flex-1 rounded-none! bg-transparent px-3"
          listClassName="max-h-none flex-1"
          onSelect={(r) => {
            if (side === "base") {
              onBaseChange(r)
              // Base is usually the first of two picks — hand off to compare.
              setSide("compare")
            } else {
              onCompareChange(r)
              setOpen(false)
            }
          }}
        />
      </SheetContent>
    </Sheet>
  )
}

/** Inline bar: base ⇄ compare pickers shown directly (mouse / wide screens). */
export function CompareBar({
  refs,
  prByBranch,
  base,
  compare,
  onBaseChange,
  onCompareChange,
  mode,
  onModeChange,
  onSwap,
  stats,
  loading,
  live,
  commits = [],
  commitReviewEnabled,
  commitSha,
  onPickCommit,
  onExitCommit,
}: CompareBarProps) {
  const showCommitReview =
    commitReviewEnabled && (commits.length > 0 || commitSha != null)
  return (
    <div className="flex flex-wrap items-center gap-2.5 border-b px-4 py-3">
      <div className="min-w-[170px] flex-1">
        <RefPicker
          refs={refs}
          prByBranch={prByBranch}
          value={base}
          onChange={onBaseChange}
          placeholder="Base ref"
        />
      </div>

      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Swap base and compare"
              disabled={!base && !compare}
              onClick={onSwap}
              className="shrink-0 text-muted-foreground"
            />
          }
        >
          <ArrowLeftRight />
        </TooltipTrigger>
        <TooltipContent>Swap base and compare</TooltipContent>
      </Tooltip>

      <div className="min-w-[170px] flex-1">
        <RefPicker
          refs={refs}
          prByBranch={prByBranch}
          value={compare}
          onChange={onCompareChange}
          placeholder="Compare ref"
        />
      </div>

      <ModeToggle mode={mode} onModeChange={onModeChange} />

      <div className="ml-auto flex shrink items-center gap-2">
        {showCommitReview ? (
          <CommitReview
            commits={commits}
            commitSha={commitSha ?? null}
            onPickCommit={(sha) => onPickCommit?.(sha)}
            onExitCommit={() => onExitCommit?.()}
          />
        ) : null}
        {live && (
          <span
            className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"
            title="Watching the working tree — the diff refreshes itself as files change"
          >
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500/50" />
              <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500/80" />
            </span>
            live
          </span>
        )}
        <Stats stats={stats} loading={loading} />
      </div>
    </div>
  )
}
