"use client"

import * as React from "react"
import {
  ChevronsUpDown,
  FileClock,
  GitBranch,
  GitCommitHorizontal,
  Tag,
} from "lucide-react"

import type { BranchInfo, PrInfo, RefInfo, RefKind, RepoRefs } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { PrBadge } from "@/components/pr-badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export function RefKindIcon({
  kind,
  className,
}: {
  kind: RefKind
  className?: string
}) {
  switch (kind) {
    case "tag":
      return <Tag className={className} />
    case "commit":
      return <GitCommitHorizontal className={className} />
    case "working":
    case "staged":
      return <FileClock className={className} />
    case "branch":
    case "remote":
    case "worktree":
    case "head":
    default:
      return <GitBranch className={className} />
  }
}

const SENTINELS: RefInfo[] = [
  { kind: "working", ref: "WORKING", label: "Working tree" },
  { kind: "staged", ref: "STAGED", label: "Staged" },
  { kind: "head", ref: "HEAD", label: "HEAD" },
]

function sameRef(a: RefInfo | null, b: RefInfo): boolean {
  return !!a && a.kind === b.kind && a.ref === b.ref
}

/**
 * The searchable, grouped ref list (no popover wrapper). Reused inside both the
 * RefPicker popover and the compact comparison editor.
 */
export function RefCommandList({
  refs,
  value,
  onSelect,
  prByBranch,
  className,
  listClassName,
}: {
  refs?: RepoRefs
  value: RefInfo | null
  onSelect: (r: RefInfo) => void
  /** headRefName → primary PR, surfaced as a badge on branch & remote rows. */
  prByBranch?: Record<string, PrInfo>
  className?: string
  /** Overrides the list's popover-sized max height (e.g. to fill a sheet). */
  listClassName?: string
}) {
  function renderItem(
    item: RefInfo,
    current?: boolean,
    pr?: PrInfo,
    branch?: BranchInfo,
  ) {
    const selected = sameRef(value, item)
    return (
      <CommandItem
        key={`${item.kind}:${item.ref}:${item.label}`}
        value={`${item.kind} ${item.ref} ${item.label} ${item.subtitle ?? ""}`}
        onSelect={() => onSelect(item)}
        // Shows CommandItem's trailing check on the ref already chosen; cmdk's
        // own highlight only tracks the keyboard cursor (first row by default).
        data-checked={selected ? "true" : undefined}
        className={cn(
          "pointer-coarse:py-2.5",
          // Touch has no keyboard cursor, so cmdk's first-row highlight would
          // read as "selected"; tint the actually chosen ref instead.
          selected
            ? "pointer-coarse:bg-muted"
            : "pointer-coarse:data-selected:bg-transparent",
        )}
      >
        <RefKindIcon
          kind={item.kind}
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5">
            <span
              className={cn("truncate", selected && "font-medium")}
              title={item.label}
            >
              {item.label}
            </span>
            {current ? (
              <Badge
                variant="secondary"
                className="h-4 shrink-0 px-1 text-[10px] font-normal"
              >
                current
              </Badge>
            ) : null}
            {branch?.aheadBehind &&
            (branch.aheadBehind.ahead > 0 || branch.aheadBehind.behind > 0) ? (
              <span className="shrink-0 tabular-nums text-muted-foreground">
                ↑{branch.aheadBehind.ahead} ↓{branch.aheadBehind.behind}
              </span>
            ) : null}
            {branch?.merged ? (
              <Badge
                variant="secondary"
                className="h-4 shrink-0 px-1 text-[10px] font-normal"
              >
                merged
              </Badge>
            ) : null}
          </span>
          {item.subtitle ? (
            <span
              className="truncate text-xs text-muted-foreground"
              title={item.subtitle}
            >
              {item.subtitle}
            </span>
          ) : null}
        </span>
        {/* The PR badge sits at the right edge of the row (branch/remote only).
            The label column above grows (`flex-1`) and absorbs the free space,
            so the badge needs no `ml-auto` of its own — that would compete with
            the auto-appended (invisible) CommandItem CheckIcon and float the
            badge mid-row. `shrink-0` keeps it from wrapping or growing the row. */}
        {pr ? <PrBadge pr={pr} className="self-center" /> : null}
      </CommandItem>
    )
  }

  return (
    <Command className={className}>
      <CommandInput placeholder="Search refs…" />
      <CommandList className={listClassName}>
        <CommandEmpty>No matching refs.</CommandEmpty>

        <CommandGroup heading="Compare with">
          {SENTINELS.map((item) => renderItem(item))}
        </CommandGroup>

        {refs && refs.branches.length > 0 ? (
          <CommandGroup heading="Branches">
            {refs.branches.map((b) =>
              renderItem(
                {
                  kind: "branch",
                  ref: b.name,
                  label: b.name,
                  subtitle: [b.commit, b.subject].filter(Boolean).join(" · "),
                },
                b.current,
                prByBranch?.[b.name],
                b,
              ),
            )}
          </CommandGroup>
        ) : null}

        {refs && refs.worktrees.length > 0 ? (
          <CommandGroup heading="Worktrees">
            {refs.worktrees.map((w) =>
              renderItem({
                kind: "worktree",
                ref: w.branch ? w.branchLabel : w.head,
                label: w.branchLabel,
                subtitle: w.path,
              }),
            )}
          </CommandGroup>
        ) : null}

        {refs && refs.tags.length > 0 ? (
          <CommandGroup heading="Tags">
            {refs.tags.map((t) =>
              renderItem({
                kind: "tag",
                ref: t.name,
                label: t.name,
                subtitle: [t.commit, t.subject].filter(Boolean).join(" · "),
              }),
            )}
          </CommandGroup>
        ) : null}

        {refs && refs.remotes.length > 0 ? (
          <CommandGroup heading="Remotes">
            {refs.remotes.map((b) =>
              renderItem(
                {
                  kind: "remote",
                  ref: b.name,
                  label: b.name,
                  subtitle: [b.commit, b.subject].filter(Boolean).join(" · "),
                },
                undefined,
                // A remote `b.name` is "origin/feature"; a PR's head is the bare
                // "feature". Strip the leading remote segment for the lookup.
                prByBranch?.[b.name.replace(/^[^/]+\//, "")],
              ),
            )}
          </CommandGroup>
        ) : null}

        {refs && refs.commits.length > 0 ? (
          <CommandGroup heading="Recent commits">
            {refs.commits.map((c) =>
              renderItem({
                kind: "commit",
                ref: c.hash,
                label: c.shortHash,
                subtitle: c.subject,
              }),
            )}
          </CommandGroup>
        ) : null}
      </CommandList>
    </Command>
  )
}

export function RefPicker({
  refs,
  value,
  onChange,
  placeholder,
  align = "start",
  disabled,
  prByBranch,
}: {
  refs?: RepoRefs
  value: RefInfo | null
  onChange: (r: RefInfo) => void
  placeholder?: string
  align?: "start" | "end"
  disabled?: boolean
  /** Forwarded to the inner list so badges show in the inline CompareBar popovers. */
  prByBranch?: Record<string, PrInfo>
}) {
  const [open, setOpen] = React.useState(false)
  const isDisabled = disabled || !refs

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            disabled={isDisabled}
            className="h-8 w-full justify-between gap-2 font-normal pointer-coarse:h-10"
          />
        }
      >
        <span className="flex min-w-0 items-center gap-2">
          {value ? (
            <RefKindIcon
              kind={value.kind}
              className="size-3.5 shrink-0 text-muted-foreground"
            />
          ) : null}
          <span className={cn("truncate", !value && "text-muted-foreground")}>
            {value?.label ?? placeholder ?? "Select a ref"}
          </span>
        </span>
        <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>
      <PopoverContent
        align={align}
        className="w-(--anchor-width) min-w-[260px] max-w-[calc(100vw-1.5rem)] p-0"
      >
        <RefCommandList
          refs={refs}
          value={value}
          prByBranch={prByBranch}
          onSelect={(r) => {
            onChange(r)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}
