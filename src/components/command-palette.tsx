"use client"

import * as React from "react"
import { useTheme } from "next-themes"
import {
  AlignJustify,
  ArrowLeftRight,
  Columns2,
  Copy,
  FileClock,
  FolderGit2,
  GitBranch,
  History,
  Keyboard,
  LayoutDashboard,
  Moon,
  PanelLeft,
  RefreshCw,
  Sun,
  SunMoon,
  WrapText,
} from "lucide-react"
import { toast } from "sonner"

import type { StoredComparison } from "@/lib/comparison"
import type { DiffFileSummary, RefInfo, RepoRefs, RepoSummary } from "@/lib/types"
import { useIsMac } from "@/hooks/use-is-mac"
import { useLocalStorage } from "@/hooks/use-local-storage"
import { FileStatusIcon } from "@/components/diff/file-meta"
import { basename, dirname } from "@/components/diff/references-meta"
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"


/**
 * Global ⌘K palette: jump to a repo or a changed file, flip view/theme prefs,
 * and reach every top-level action without hunting for its button. Prefs are
 * read/written through the same synced useLocalStorage keys the diff viewer
 * owns, so toggles here update the open diff instantly.
 */
export function CommandPalette({
  open,
  onOpenChange,
  repos,
  selectedRepoId,
  files,
  patch,
  refs,
  base,
  compare,
  onSetCompare,
  onSwap,
  recentComparisons,
  onApplyComparison,
  onSelectRepo,
  onGoOverview,
  onSelectFile,
  onRefresh,
  onToggleSidebar,
  onShowShortcuts,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  repos: RepoSummary[]
  selectedRepoId: string | null
  /** Changed files of the current diff (empty when no diff is showing). */
  files: DiffFileSummary[]
  /** Raw patch of the current diff, for the copy action. */
  patch?: string
  /** Refs of the selected repo — enables the comparison/branch groups. */
  refs?: RepoRefs
  base?: RefInfo | null
  compare?: RefInfo | null
  onSetCompare?: (r: RefInfo) => void
  onSwap?: () => void
  /** Previously-used comparisons for this repo (most recent first). */
  recentComparisons?: StoredComparison[]
  onApplyComparison?: (c: StoredComparison) => void
  onSelectRepo: (id: string) => void
  onGoOverview: () => void
  onSelectFile: (path: string) => void
  onRefresh: () => void
  onToggleSidebar?: () => void
  onShowShortcuts: () => void
}) {
  const isMac = useIsMac()
  const mod = isMac ? "⌘" : "Ctrl"
  const { setTheme, theme } = useTheme()
  const [view, setView] = useLocalStorage<"unified" | "split">(
    "gitscope.diffView",
    "unified",
  )
  const [wrap, setWrap] = useLocalStorage("gitscope.wrapLines", false)

  function run(action: () => void) {
    onOpenChange(false)
    action()
  }

  async function copyPatch() {
    try {
      await navigator.clipboard.writeText(patch ?? "")
      toast.success("Patch copied to clipboard")
    } catch {
      toast.error("Couldn't copy the patch")
    }
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Jump to a repo or file, or run an action"
      className="max-w-lg"
    >
      <Command>
        <CommandInput placeholder="Search repos, files, actions…" />
        {/* The dialog is pinned at a third of the viewport, so the default
            18rem list runs off the bottom of a short (landscape phone) screen. */}
        <CommandList className="max-h-[min(18rem,55dvh)]">
        <CommandEmpty>Nothing matches.</CommandEmpty>

        <CommandGroup heading="Repositories">
          <CommandItem
            value="overview dashboard home"
            data-checked={selectedRepoId === null || undefined}
            onSelect={() => run(onGoOverview)}
          >
            <LayoutDashboard className="text-muted-foreground" />
            Overview
          </CommandItem>
          {repos.map((repo) => (
            <CommandItem
              key={repo.id}
              value={`repo ${repo.name} ${repo.path}`}
              data-checked={repo.id === selectedRepoId || undefined}
              onSelect={() => run(() => onSelectRepo(repo.id))}
            >
              <FolderGit2 className="text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate">{repo.name}</span>
              {repo.ok && repo.status ? (
                <span className="max-w-[14ch] truncate text-xs text-muted-foreground">
                  {repo.status.current ?? "detached"}
                  {!repo.status.clean && " ·"}
                  {!repo.status.clean && (
                    <span className="text-amber-600 dark:text-amber-500"> dirty</span>
                  )}
                </span>
              ) : null}
            </CommandItem>
          ))}
        </CommandGroup>

        {refs && onApplyComparison && (
          <CommandGroup heading="Comparison">
            {onSwap && (base || compare) && (
              <CommandItem
                value="swap base compare flip reverse"
                onSelect={() => run(onSwap)}
              >
                <ArrowLeftRight className="text-muted-foreground" />
                Swap base and compare
              </CommandItem>
            )}
            <CommandItem
              value="compare working tree vs head uncommitted changes"
              onSelect={() =>
                run(() =>
                  onApplyComparison({
                    base: { kind: "head", ref: "HEAD", label: "HEAD" },
                    compare: { kind: "working", ref: "WORKING", label: "Working tree" },
                    mode: "merge-base",
                  }),
                )
              }
            >
              <FileClock className="text-muted-foreground" />
              Working tree vs HEAD
            </CommandItem>
            {recentComparisons?.map((c, i) => (
              <CommandItem
                key={`${c.base.ref}-${c.compare.ref}-${i}`}
                value={`recent comparison ${c.base.label} ${c.compare.label}`}
                onSelect={() => run(() => onApplyComparison(c))}
              >
                <History className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">
                  {c.base.label} → {c.compare.label}
                </span>
                <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] leading-4 text-muted-foreground">
                  {c.mode === "merge-base" ? "..." : ".."}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {refs && onSetCompare && refs.branches.length > 0 && (
          <CommandGroup heading="Switch compare branch">
            {refs.branches.map((b) => (
              <CommandItem
                key={b.name}
                value={`branch compare switch ${b.name}`}
                data-checked={
                  (compare?.kind === "branch" && compare.ref === b.name) ||
                  undefined
                }
                onSelect={() =>
                  run(() =>
                    onSetCompare({
                      kind: "branch",
                      ref: b.name,
                      label: b.name,
                      subtitle: b.commit,
                    }),
                  )
                }
              >
                <GitBranch className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                {b.current ? (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    current
                  </span>
                ) : null}
              </CommandItem>
            ))}
          </CommandGroup>
        )}

        {files.length > 0 && (
          <CommandGroup heading="Changed files">
            {files.map((f) => {
              // Truncate the directory, never the file name — the name is what
              // the search was for. Same geometry as the diff file list.
              const dir = dirname(f.path)
              return (
                <CommandItem
                  key={f.path}
                  value={`file ${f.path}`}
                  title={f.path}
                  onSelect={() => run(() => onSelectFile(f.path))}
                >
                  <FileStatusIcon status={f.status} />
                  <span className="flex min-w-0 flex-1 items-baseline overflow-hidden font-mono text-xs">
                    {dir && (
                      <span className="min-w-0 truncate text-muted-foreground">{dir}</span>
                    )}
                    <span className="shrink-0 font-medium">{basename(f.path)}</span>
                  </span>
                  <span className="shrink-0 font-mono text-[11px] tabular-nums">
                    <span className="text-[var(--diff-add-marker)]">+{f.additions}</span>{" "}
                    <span className="text-[var(--diff-del-marker)]">−{f.deletions}</span>
                  </span>
                </CommandItem>
              )
            })}
          </CommandGroup>
        )}

        <CommandGroup heading="View">
          <CommandItem
            value="toggle unified split view diff layout"
            onSelect={() => run(() => setView(view === "unified" ? "split" : "unified"))}
          >
            {view === "unified" ? (
              <Columns2 className="text-muted-foreground" />
            ) : (
              <AlignJustify className="text-muted-foreground" />
            )}
            Switch to {view === "unified" ? "split" : "unified"} view
          </CommandItem>
          <CommandItem
            value="toggle wrap long lines"
            onSelect={() => run(() => setWrap(!wrap))}
          >
            <WrapText className="text-muted-foreground" />
            {wrap ? "Unwrap long lines" : "Wrap long lines"}
          </CommandItem>
          <CommandItem
            value="theme light mode"
            data-checked={theme === "light" || undefined}
            onSelect={() => run(() => setTheme("light"))}
          >
            <Sun className="text-muted-foreground" />
            Light theme
          </CommandItem>
          <CommandItem
            value="theme dark mode"
            data-checked={theme === "dark" || undefined}
            onSelect={() => run(() => setTheme("dark"))}
          >
            <Moon className="text-muted-foreground" />
            Dark theme
          </CommandItem>
          <CommandItem
            value="theme system mode"
            data-checked={(theme === "system" || theme === undefined) || undefined}
            onSelect={() => run(() => setTheme("system"))}
          >
            <SunMoon className="text-muted-foreground" />
            System theme
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Actions">
          <CommandItem value="refresh reload" onSelect={() => run(onRefresh)}>
            <RefreshCw className="text-muted-foreground" />
            Refresh
            <CommandShortcut>R</CommandShortcut>
          </CommandItem>
          {patch !== undefined && (
            <CommandItem
              value="copy raw patch diff clipboard"
              onSelect={() => run(() => void copyPatch())}
            >
              <Copy className="text-muted-foreground" />
              Copy raw patch
            </CommandItem>
          )}
          {onToggleSidebar && (
            <CommandItem
              value="toggle sidebar panel repositories"
              onSelect={() => run(onToggleSidebar)}
            >
              <PanelLeft className="text-muted-foreground" />
              Toggle sidebar
              <CommandShortcut>{mod}B</CommandShortcut>
            </CommandItem>
          )}
          <CommandItem
            value="keyboard shortcuts help keys"
            onSelect={() => run(onShowShortcuts)}
          >
            <Keyboard className="text-muted-foreground" />
            Keyboard shortcuts
            <CommandShortcut>?</CommandShortcut>
          </CommandItem>
        </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  )
}
