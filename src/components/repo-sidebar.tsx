"use client"

import * as React from "react"
import {
  EllipsisVertical,
  FolderGit2,
  GitBranch,
  GitCompareArrows,
  LayoutDashboard,
  Trash2,
  TriangleAlert,
} from "lucide-react"

import type { RepoStatus, RepoSummary } from "@/lib/types"
import { dirtBits } from "@/lib/repo-status"
import { cn } from "@/lib/utils"
import { AddRepoDialog } from "@/components/add-repo-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

function RepoStatusLine({ status }: { status: RepoStatus }) {
  const bits = dirtBits(status)
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
      <GitBranch className="size-3 shrink-0" />
      <span className="truncate" title={status.current ?? "detached"}>
        {status.current ?? "detached"}
      </span>
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

function RepoRow({
  repo,
  selected,
  onSelect,
  onRemove,
}: {
  repo: RepoSummary
  selected: boolean
  onSelect: (id: string) => void
  onRemove: (id: string) => Promise<void>
}) {
  return (
    <div className="group/repo relative">
      <button
        type="button"
        onClick={() => onSelect(repo.id)}
        className={cn(
          "flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 pr-9 text-left transition-colors pointer-coarse:py-3",
          "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          selected && "bg-accent hover:bg-accent"
        )}
      >
        {/* Every row leads with a size-4 glyph so the names share one left
            edge, matching the Overview row and the dashboard's RepoCard. */}
        <div className="flex min-w-0 items-center gap-2">
          {repo.ok === false ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <span className="flex shrink-0 items-center text-amber-600 dark:text-amber-500" />
                }
              >
                <TriangleAlert className="size-4" />
              </TooltipTrigger>
              <TooltipContent>{repo.error ?? "Not a git repository"}</TooltipContent>
            </Tooltip>
          ) : (
            <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
          )}
          <span
            className={cn(
              "truncate text-sm font-medium",
              repo.ok === false && "text-muted-foreground"
            )}
            title={repo.path}
          >
            {repo.name}
          </span>
        </div>
        {repo.ok && repo.status ? (
          <RepoStatusLine status={repo.status} />
        ) : (
          <span className="truncate text-xs text-muted-foreground">
            {repo.ok === false ? repo.error ?? "Unavailable" : repo.path}
          </span>
        )}
      </button>

      <div className="absolute top-1.5 right-1 opacity-60 transition-opacity group-hover/repo:opacity-100 pointer-coarse:opacity-100">
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
    </div>
  )
}

function SidebarSkeleton() {
  return (
    <div className="flex flex-col gap-1 p-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 px-2.5 py-2">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3 w-40" />
        </div>
      ))}
    </div>
  )
}

export function RepoSidebar({
  repos,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
  loading,
  onHome,
  homeActive,
}: {
  repos: RepoSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: (input: { path: string; name?: string }) => Promise<void>
  onRemove: (id: string) => Promise<void>
  loading?: boolean
  /** Returns to the cross-repo Overview dashboard. */
  onHome?: () => void
  /** Highlight the Overview row + wordmark when the dashboard is showing. */
  homeActive?: boolean
}) {
  // Count of dirty, valid repos — shown muted on the Overview row.
  const dirtyRepos = repos.reduce(
    (n, r) => (r.ok && r.status && !r.status.clean ? n + 1 : n),
    0,
  )

  return (
    <TooltipProvider>
      <div className="flex h-full flex-col">
        {/* Same 48px rail as the main headers in page.tsx so the two top
            borders line up across the sidebar's border-r. */}
        <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
          {onHome ? (
            <button
              type="button"
              onClick={onHome}
              className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              aria-label="Overview"
            >
              <GitCompareArrows className="size-5 text-primary" />
              <span className="text-base font-semibold tracking-tight">
                GitScope
              </span>
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <GitCompareArrows className="size-5 text-primary" />
              <span className="text-base font-semibold tracking-tight">
                GitScope
              </span>
            </div>
          )}
          <AddRepoDialog onAdd={onAdd} />
        </div>

        {loading ? (
          <SidebarSkeleton />
        ) : repos.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 py-10 text-center">
            <FolderGit2 className="size-8 text-muted-foreground/60" />
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium">No repositories yet</p>
              <p className="text-xs text-muted-foreground">
                Add a local git repo to start comparing refs.
              </p>
            </div>
            <AddRepoDialog onAdd={onAdd} />
          </div>
        ) : (
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-0.5 p-2">
              {onHome ? (
                <button
                  type="button"
                  onClick={onHome}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium transition-colors pointer-coarse:py-3",
                    "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                    homeActive && "bg-accent hover:bg-accent",
                  )}
                >
                  <LayoutDashboard className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate">Overview</span>
                  {dirtyRepos > 0 ? (
                    <span
                      className="shrink-0 text-xs tabular-nums text-muted-foreground"
                      title={`${dirtyRepos} ${dirtyRepos === 1 ? "repo" : "repos"} with uncommitted changes`}
                    >
                      {dirtyRepos}
                    </span>
                  ) : null}
                </button>
              ) : null}
              {repos.map((repo) => (
                <RepoRow
                  key={repo.id}
                  repo={repo}
                  selected={repo.id === selectedId}
                  onSelect={onSelect}
                  onRemove={onRemove}
                />
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </TooltipProvider>
  )
}
