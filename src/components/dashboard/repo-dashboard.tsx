"use client"

import * as React from "react"
import { ArrowUpDown, FolderGit2, LayoutGrid, List } from "lucide-react"

import type { RepoSummary } from "@/lib/types"
import { dirtyCount } from "@/lib/repo-status"
import { AddRepoDialog } from "@/components/add-repo-dialog"
import { RepoCard, RepoListRow } from "@/components/dashboard/repo-card"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { TooltipProvider } from "@/components/ui/tooltip"

export type DashboardSort = "recent" | "name" | "changes"
export type DashboardView = "grid" | "list"

const SORT_ITEMS: { value: DashboardSort; label: string }[] = [
  { value: "recent", label: "Recently touched" },
  { value: "name", label: "Name" },
  { value: "changes", label: "Most changes" },
]

/** Sort a copy of `repos`. ok:false repos always sink to the bottom; name is
 *  the stable secondary key for every mode. */
export function sortRepos(repos: RepoSummary[], sort: DashboardSort): RepoSummary[] {
  const byName = (a: RepoSummary, b: RepoSummary) =>
    a.name.localeCompare(b.name)

  return [...repos].sort((a, b) => {
    // Invalid repos last, regardless of the chosen sort.
    const aBad = a.ok ? 0 : 1
    const bBad = b.ok ? 0 : 1
    if (aBad !== bBad) return aBad - bBad

    if (sort === "name") return byName(a, b)

    if (sort === "changes") {
      const ac = a.status ? dirtyCount(a.status) : 0
      const bc = b.status ? dirtyCount(b.status) : 0
      if (ac !== bc) return bc - ac
      return byName(a, b)
    }

    // "recent": lastActivity desc, nulls last.
    const at = a.status?.lastActivity ? Date.parse(a.status.lastActivity) : NaN
    const bt = b.status?.lastActivity ? Date.parse(b.status.lastActivity) : NaN
    const aHas = Number.isFinite(at)
    const bHas = Number.isFinite(bt)
    if (aHas && bHas && at !== bt) return bt - at
    if (aHas !== bHas) return aHas ? -1 : 1
    return byName(a, b)
  })
}

function SummaryStrip({ repos }: { repos: RepoSummary[] }) {
  let dirty = 0
  let ahead = 0
  for (const r of repos) {
    if (!r.ok || !r.status) continue
    if (!r.status.clean) dirty += 1
    if (r.status.ahead > 0) ahead += 1
  }
  const n = repos.length
  return (
    <p className="text-xs text-muted-foreground">
      {n} {n === 1 ? "repo" : "repos"} · {dirty} dirty · {ahead} ahead
    </p>
  )
}

/** Mirrors RepoCard's box so the grid doesn't reflow when data lands: bars track
 *  the real line boxes (text-sm name 20px, font-mono text-[11px] path ~14px,
 *  StatusLine + ActivityLine text-xs 16px each). */
function CardSkeleton() {
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3">
      <Skeleton className="h-5 w-32" />
      <Skeleton className="h-3.5 w-44" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-20" />
    </div>
  )
}

/** Mirrors RepoListRow's box so the list view doesn't reflow when data lands. */
function RowSkeleton() {
  return (
    <div className="flex items-center gap-3 rounded-lg border px-3 py-2.5 pointer-coarse:py-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-4 w-56" />
      </div>
      <Skeleton className="h-4 w-16 shrink-0" />
    </div>
  )
}

export function RepoDashboard({
  repos,
  onSelect,
  onReview,
  onRemove,
  onAdd,
  loading,
  sort,
  onSortChange,
  view,
  onViewChange,
}: {
  repos: RepoSummary[]
  onSelect: (id: string) => void
  onReview?: (id: string) => void
  onRemove: (id: string) => Promise<void>
  onAdd: (input: { path: string; name?: string }) => Promise<void>
  loading?: boolean
  sort: DashboardSort
  onSortChange: (s: DashboardSort) => void
  view: DashboardView
  onViewChange: (v: DashboardView) => void
}) {
  const sorted = React.useMemo(() => sortRepos(repos, sort), [repos, sort])

  // Loading with nothing to show yet → a skeleton shaped like the final layout
  // (toolbar row + the persisted view) so nothing shifts when data lands.
  if (loading && repos.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-4">
          {/* Heights track the real controls: SummaryStrip text-xs, sort Select
              size="sm" (h-7), view toggle (2× size-7 + p-0.5 + border = 34px),
              Add repo size="sm" (h-7) — each with the same coarse-pointer
              growth as its counterpart (size-9 buttons → 42×80 toggle). */}
          <div className="flex flex-wrap items-center gap-2">
            <Skeleton className="h-4 w-44" />
            <div className="ml-auto flex items-center gap-2">
              <Skeleton className="h-7 w-[160px] pointer-coarse:h-9" />
              <Skeleton className="h-[34px] w-16 rounded-lg pointer-coarse:h-[42px] pointer-coarse:w-20" />
              <Skeleton className="h-7 w-24 pointer-coarse:h-9" />
            </div>
          </div>

          {view === "grid" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <RowSkeleton key={i} />
              ))}
            </div>
          )}
        </div>
      </div>
    )
  }

  // No repos registered → welcoming empty state + CTA.
  if (repos.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <FolderGit2 className="size-10 text-muted-foreground/60" />
        <div className="flex flex-col gap-1">
          <p className="text-lg font-semibold">No repositories yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Add a local git repository to start comparing branches, worktrees,
            and commits — and see them all at a glance here.
          </p>
        </div>
        <AddRepoDialog onAdd={onAdd} />
      </div>
    )
  }

  return (
    <TooltipProvider>
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="min-w-0 flex-1">
              <SummaryStrip repos={repos} />
            </div>

            {/* Below sm: summary + Add share the first row and sort/view take
                a full-width second row, so the sort label never truncates. */}
            <div className="flex items-center gap-2 max-sm:order-last max-sm:w-full">
              <Select
                items={SORT_ITEMS}
                value={sort}
                onValueChange={(v) => onSortChange(v as DashboardSort)}
              >
                <SelectTrigger
                  size="sm"
                  className="w-[160px] pointer-coarse:h-9 max-sm:w-auto max-sm:min-w-0 max-sm:flex-1"
                  aria-label="Sort by"
                >
                  <ArrowUpDown className="size-3.5 text-muted-foreground" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SORT_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5">
                <Button
                  variant={view === "grid" ? "secondary" : "ghost"}
                  size="icon-sm"
                  className="pointer-coarse:size-9"
                  aria-label="Grid view"
                  aria-pressed={view === "grid"}
                  onClick={() => onViewChange("grid")}
                >
                  <LayoutGrid />
                </Button>
                <Button
                  variant={view === "list" ? "secondary" : "ghost"}
                  size="icon-sm"
                  className="pointer-coarse:size-9"
                  aria-label="List view"
                  aria-pressed={view === "list"}
                  onClick={() => onViewChange("list")}
                >
                  <List />
                </Button>
              </div>
            </div>

            <AddRepoDialog onAdd={onAdd} />
          </div>

          {view === "grid" ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {sorted.map((repo) => (
                <RepoCard
                  key={repo.id}
                  repo={repo}
                  onSelect={onSelect}
                  onReview={onReview}
                  onRemove={onRemove}
                />
              ))}
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sorted.map((repo) => (
                <RepoListRow
                  key={repo.id}
                  repo={repo}
                  onSelect={onSelect}
                  onReview={onReview}
                  onRemove={onRemove}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </TooltipProvider>
  )
}
