"use client"

import {
  Clock,
  EllipsisVertical,
  FolderGit2,
  GitBranch,
  ListChecks,
  Trash2,
  TriangleAlert,
} from "lucide-react"

import type { PrInfo, RepoStatus, RepoSummary } from "@/lib/types"
import { dirtBits } from "@/lib/repo-status"
import { formatAbsolute, formatRelativeTime } from "@/lib/format-time"
import { usePullRequests } from "@/hooks/use-pulls"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { PrBadge } from "@/components/pr-badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"

/** Branch + ahead/behind + clean-dot / dirty-badge — mirrors the sidebar line. */
function StatusLine({ status, pr }: { status: RepoStatus; pr?: PrInfo }) {
  const bits = dirtBits(status)
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <GitBranch className="size-3 shrink-0" />
      <span className="truncate" title={status.current ?? "detached"}>
        {status.current ?? "detached"}
      </span>
      {/* Inert (the whole card is a <button>): a soft pill reading "branch · #4". */}
      {pr ? <PrBadge pr={pr} variant="soft" interactive={false} /> : null}
      {status.ahead > 0 || status.behind > 0 ? (
        <span className="shrink-0 tabular-nums">
          {status.ahead > 0 ? `↑${status.ahead}` : ""}
          {status.ahead > 0 && status.behind > 0 ? " " : ""}
          {status.behind > 0 ? `↓${status.behind}` : ""}
        </span>
      ) : null}
      <span className="ml-auto shrink-0">
        {status.clean ? (
          <span className="flex items-center gap-1">
            <span className="size-1.5 rounded-full bg-emerald-500/80" />
            clean
          </span>
        ) : (
          <Badge
            variant="secondary"
            className="h-4 px-1 font-mono text-[10px] font-normal tabular-nums"
          >
            {bits.join(" ")}
          </Badge>
        )}
      </span>
    </div>
  )
}

/** Clock icon + relative last-activity (absolute datetime in the title). */
function ActivityLine({
  iso,
  className,
}: {
  iso: string | null
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 text-xs text-muted-foreground",
        className,
      )}
    >
      <Clock className="size-3 shrink-0" />
      {iso ? (
        <span className="truncate tabular-nums" title={formatAbsolute(iso)}>
          {formatRelativeTime(iso)}
        </span>
      ) : (
        <span className="truncate">no commits yet</span>
      )}
    </div>
  )
}

/** Amber warning + tooltip for an ok:false repo. */
function ErrorBadge({ error }: { error?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <span className="flex shrink-0 items-center text-amber-600 dark:text-amber-500" />
        }
      >
        <TriangleAlert className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{error ?? "Not a git repository"}</TooltipContent>
    </Tooltip>
  )
}

/** Kebab → Remove. Positioned absolutely so it is a sibling of the card button.
 *  The position is overridable because the tall card wants it top-anchored while
 *  the short list row wants it centered next to ReviewAction. */
function RepoKebab({
  repo,
  onRemove,
  className = "top-2 right-1.5",
}: {
  repo: RepoSummary
  onRemove: (id: string) => Promise<void>
  className?: string
}) {
  return (
    <div
      className={cn(
        "absolute opacity-60 transition-opacity group-hover/card:opacity-100 pointer-coarse:opacity-100",
        className,
      )}
      // Belt-and-suspenders: keep clicks in the kebab from reaching the card.
      onClick={(e) => e.stopPropagation()}
    >
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-xs"
              className="pointer-coarse:size-9"
              aria-label={`Actions for ${repo.name}`}
            />
          }
        >
          <EllipsisVertical />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem
            variant="destructive"
            onClick={() => {
              void onRemove(repo.id)
            }}
          >
            <Trash2 />
            Remove
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/** One-click triage entry: opens the repo pre-set to HEAD → Working. Rendered
 *  only for dirty repos, as a positioned sibling of the card/row <button> (never
 *  nested inside it — invalid HTML). Mirrors RepoKebab's reveal behavior. */
function ReviewAction({
  repo,
  onReview,
  className,
}: {
  repo: RepoSummary
  onReview: (id: string) => void
  className?: string
}) {
  return (
    <div
      className={cn(
        "absolute opacity-60 transition-opacity group-hover/card:opacity-100 pointer-coarse:opacity-100",
        className,
      )}
      // Belt-and-suspenders: keep clicks in the action from reaching the card.
      onClick={(e) => e.stopPropagation()}
    >
      <Button
        size="xs"
        variant="secondary"
        className="pointer-coarse:h-9"
        onClick={(e) => {
          e.stopPropagation()
          onReview(repo.id)
        }}
      >
        <ListChecks />
        Review
      </Button>
    </div>
  )
}

/** A single repo as a grid card. The whole card selects the repo. */
export function RepoCard({
  repo,
  onSelect,
  onReview,
  onRemove,
}: {
  repo: RepoSummary
  onSelect: (id: string) => void
  onReview?: (id: string) => void
  onRemove: (id: string) => Promise<void>
}) {
  const status = repo.ok ? repo.status : undefined
  const dirty = repo.ok && repo.status ? !repo.status.clean : false
  // Per-repo, lazy + cached: the dashboard avoids a gh-storm because the server
  // cache + in-flight coalescing bound this to one `gh` per repo per 60s, and
  // non-GitHub repos short-circuit before any spawn.
  const { prByBranch } = usePullRequests(repo.id)
  const pr = status?.current ? prByBranch[status.current] : undefined
  return (
    <div className="group/card relative">
      <button
        type="button"
        onClick={() => onSelect(repo.id)}
        title={repo.path}
        className={cn(
          "flex w-full flex-col gap-2 rounded-lg border p-3 pr-9 text-left transition-all",
          // Touch grows Review to a 36px target; pad the card so it sits below
          // the status line instead of on top of the dirty badge.
          dirty && onReview && "pointer-coarse:pb-6",
          "hover:border-foreground/15 hover:bg-muted/40 hover:shadow-sm focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          repo.ok === false && "bg-muted/30",
        )}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          {repo.ok === false ? (
            <ErrorBadge error={repo.error} />
          ) : (
            <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm font-medium",
              repo.ok === false && "text-muted-foreground",
            )}
          >
            {repo.name}
          </span>
        </div>

        <span className="truncate font-mono text-[11px] text-muted-foreground">
          {repo.path}
        </span>

        {status ? (
          <>
            <StatusLine status={status} pr={pr} />
            <ActivityLine iso={status.lastActivity} />
          </>
        ) : (
          <span className="truncate text-xs text-muted-foreground">
            {repo.error ?? "Unavailable"}
          </span>
        )}
      </button>

      {dirty && onReview ? (
        <ReviewAction
          repo={repo}
          onReview={onReview}
          className="bottom-2 right-1.5"
        />
      ) : null}
      <RepoKebab repo={repo} onRemove={onRemove} />
    </div>
  )
}

/** A single repo as a full-width list row (compact + list view). */
export function RepoListRow({
  repo,
  onSelect,
  onReview,
  onRemove,
}: {
  repo: RepoSummary
  onSelect: (id: string) => void
  onReview?: (id: string) => void
  onRemove: (id: string) => Promise<void>
}) {
  const status = repo.ok ? repo.status : undefined
  const bits = status ? dirtBits(status) : []
  const dirty = repo.ok && repo.status ? !repo.status.clean : false
  // Same lazy + cached per-repo PR fetch as RepoCard, for the current branch.
  const { prByBranch } = usePullRequests(repo.id)
  const pr = status?.current ? prByBranch[status.current] : undefined
  return (
    <div className="group/card relative">
      <button
        type="button"
        onClick={() => onSelect(repo.id)}
        title={repo.path}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-all pointer-coarse:py-3",
          "hover:border-foreground/15 hover:bg-muted/40 hover:shadow-sm focus-visible:outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          repo.ok === false && "bg-muted/30",
        )}
      >
        {/* Left: name + branch */}
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex min-w-0 items-center gap-1.5">
            {repo.ok === false ? (
              <ErrorBadge error={repo.error} />
            ) : (
              <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span
              className={cn(
                "truncate text-sm font-medium",
                repo.ok === false && "text-muted-foreground",
              )}
            >
              {repo.name}
            </span>
          </div>
          {status ? (
            <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
              <GitBranch className="size-3 shrink-0" />
              <span className="truncate" title={status.current ?? "detached"}>
                {status.current ?? "detached"}
              </span>
              {/* Inert soft pill (the row is a <button>), same as RepoCard. */}
              {pr ? <PrBadge pr={pr} variant="soft" interactive={false} /> : null}
              {status.ahead > 0 || status.behind > 0 ? (
                <span className="shrink-0 tabular-nums">
                  {status.ahead > 0 ? `↑${status.ahead}` : ""}
                  {status.ahead > 0 && status.behind > 0 ? " " : ""}
                  {status.behind > 0 ? `↓${status.behind}` : ""}
                </span>
              ) : null}
            </div>
          ) : (
            <span className="truncate font-mono text-[11px] text-muted-foreground">
              {repo.path}
            </span>
          )}
        </div>

        {/* Right: dirty/clean + relative time. Reserve room for the absolutely
            positioned siblings — kebab alone, or kebab + Review on dirty repos.
            Both grow on touch, so the reserved gutter grows with them. */}
        <div
          className={cn(
            "flex shrink-0 items-center gap-3",
            dirty && onReview ? "pr-28 pointer-coarse:pr-32" : "pr-7 pointer-coarse:pr-11",
          )}
        >
          {status ? (
            status.clean ? (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <span className="size-1.5 rounded-full bg-emerald-500/80" />
                clean
              </span>
            ) : (
              <Badge
                variant="secondary"
                className="h-4 px-1 font-mono text-[10px] font-normal tabular-nums"
              >
                {bits.join(" ")}
              </Badge>
            )
          ) : null}
          {status ? (
            <span
              className="hidden tabular-nums text-xs text-muted-foreground sm:inline"
              title={formatAbsolute(status.lastActivity)}
            >
              {status.lastActivity
                ? formatRelativeTime(status.lastActivity)
                : "—"}
            </span>
          ) : null}
        </div>
      </button>

      {dirty && onReview ? (
        <ReviewAction
          repo={repo}
          onReview={onReview}
          className="top-1/2 right-9 -translate-y-1/2 pointer-coarse:right-12"
        />
      ) : null}
      <RepoKebab
        repo={repo}
        onRemove={onRemove}
        className="top-1/2 right-1.5 -translate-y-1/2"
      />
    </div>
  )
}
