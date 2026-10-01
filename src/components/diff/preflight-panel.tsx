"use client"

import { useState } from "react"
import {
  EllipsisVertical,
  EyeOff,
  FilterX,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react"

import type { PreflightFinding, PreflightSummary } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"

import {
  SEVERITY_BG,
  SEVERITY_TEXT,
  summaryLabel,
  type FindingIndex,
} from "./preflight-meta"
import type { PreflightController } from "@/hooks/use-preflight"

type Filter = "all" | "secrets" | "leftovers" | "ignored"

/** Static severity glyph (ShieldAlert for blockers, TriangleAlert for warnings). */
function SeverityIcon({
  severity,
  className,
}: {
  severity: PreflightFinding["severity"]
  className?: string
}) {
  return severity === "blocker" ? (
    <ShieldAlert className={className} />
  ) : (
    <TriangleAlert className={className} />
  )
}

function truncateMiddle(s: string, max = 42): string {
  if (s.length <= max) return s
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = Math.floor(keep / 2)
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`
}

function Snippet({ finding }: { finding: PreflightFinding }) {
  const hl =
    finding.severity === "blocker" ? "bg-destructive/20" : "bg-amber-500/25"
  if (!finding.match) {
    return <code className="break-all">{finding.snippet}</code>
  }
  const { start, end } = finding.match
  return (
    <code className="break-all">
      {finding.snippet.slice(0, start)}
      <span className={cn("rounded-sm px-0.5", hl)}>
        {finding.snippet.slice(start, end)}
      </span>
      {finding.snippet.slice(end)}
    </code>
  )
}

function FindingRow({
  finding,
  controller,
  onJump,
  ignoredView,
}: {
  finding: PreflightFinding
  controller: PreflightController
  onJump: (f: PreflightFinding) => void
  ignoredView?: boolean
}) {
  const byRule = controller.ignoredRuleIds.has(finding.ruleId)

  return (
    <div className="group/finding relative">
      <button
        type="button"
        onClick={() => onJump(finding)}
        className={cn(
          "flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 pr-9 text-left transition-colors",
          "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          "pointer-coarse:py-3",
        )}
        title={`${finding.path}:${finding.line}`}
      >
        <div className="flex min-w-0 items-center gap-1.5">
          <SeverityIcon
            severity={finding.severity}
            className={cn("size-3.5 shrink-0", SEVERITY_TEXT[finding.severity])}
          />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {finding.title}
          </span>
          {ignoredView && byRule && (
            <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
              rule
            </span>
          )}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground pointer-coarse:text-xs">
          {truncateMiddle(finding.path)}:{finding.line}
        </div>
        <div
          className={cn(
            "overflow-hidden rounded px-1.5 py-1 font-mono text-[11px] leading-snug pointer-coarse:text-xs",
            SEVERITY_BG[finding.severity],
          )}
        >
          <Snippet finding={finding} />
        </div>
      </button>

      <div className="absolute top-1.5 right-1 opacity-70 transition-opacity group-hover/finding:opacity-100 pointer-coarse:opacity-100">
        {ignoredView ? (
          <Button
            size="icon-xs"
            variant="ghost"
            className="pointer-coarse:size-9"
            title={byRule ? "Un-ignore this rule" : "Un-ignore this finding"}
            aria-label="Un-ignore"
            onClick={() =>
              byRule ? controller.unignoreRule(finding) : controller.unignore(finding)
            }
          >
            <RotateCcw />
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="pointer-coarse:size-9"
                  aria-label="Finding actions"
                />
              }
            >
              <EllipsisVertical />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => controller.ignore(finding)}>
                <EyeOff />
                Ignore this finding
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => controller.ignoreRule(finding)}>
                <FilterX />
                Ignore this rule in this repo
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  color,
  children,
}: {
  title: string
  color: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
        <span className={cn("size-2 rounded-full", color)} />
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

function FilterTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}) {
  return (
    <Button
      size="xs"
      variant={active ? "secondary" : "ghost"}
      className="gap-1 pointer-coarse:h-9"
      aria-pressed={active}
      onClick={onClick}
    >
      {label}
      <span className={cn("tabular-nums", active ? "" : "text-muted-foreground")}>
        {count}
      </span>
    </Button>
  )
}

export function PreflightPanel({
  open,
  onOpenChange,
  index,
  summary,
  controller,
  onJump,
  compact,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  index: FindingIndex
  summary: PreflightSummary | undefined
  controller: PreflightController
  onJump: (finding: PreflightFinding) => void
  compact: boolean
}) {
  const [filter, setFilter] = useState<Filter>("all")

  // Default to the most pressing tab each time the panel opens (render-phase
  // reset, keyed on the open transition — no effect needed).
  const [wasOpen, setWasOpen] = useState(false)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setFilter(
        index.active.length === 0 && index.ignored.length > 0 ? "ignored" : "all",
      )
    }
  }

  const secrets = index.active.filter((f) => f.category === "secret")
  const leftovers = index.active.filter((f) => f.category === "leftover")

  const showSecrets = filter === "all" || filter === "secrets"
  const showLeftovers = filter === "all" || filter === "leftovers"
  const showIgnored = filter === "ignored"

  const nothingActive = index.active.length === 0

  // The viewer closes the panel on jump; this is just the click forwarder.
  const jump = onJump

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={compact ? "left" : "right"}
        className={cn(
          "gap-0 p-0",
          compact ? "w-[92%] max-w-md" : "w-[26rem] sm:max-w-md",
        )}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3 pr-12">
          <div className="min-w-0">
            <SheetTitle>Pre-flight check</SheetTitle>
            <p className="truncate text-xs text-muted-foreground">
              {summaryLabel(index.secrets, index.leftovers)}
              {index.ignored.length > 0 ? ` · ${index.ignored.length} ignored` : ""}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-2">
          <FilterTab
            active={filter === "all"}
            label="All"
            count={index.active.length}
            onClick={() => setFilter("all")}
          />
          <FilterTab
            active={filter === "secrets"}
            label="Secrets"
            count={index.secrets}
            onClick={() => setFilter("secrets")}
          />
          <FilterTab
            active={filter === "leftovers"}
            label="Leftovers"
            count={index.leftovers}
            onClick={() => setFilter("leftovers")}
          />
          <FilterTab
            active={filter === "ignored"}
            label="Ignored"
            count={index.ignored.length}
            onClick={() => setFilter("ignored")}
          />
        </div>

        {summary?.truncated && (
          <div className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            <TriangleAlert className="size-3.5 shrink-0" />
            Diff was truncated — some findings may be missing.
          </div>
        )}
        {summary?.capped && (
          <div className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            <TriangleAlert className="size-3.5 shrink-0" />
            Showing the first 500 findings.
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {showIgnored ? (
            index.ignored.length === 0 ? (
              <EmptyNote text="Nothing is ignored in this repo." />
            ) : (
              <div className="flex flex-col gap-0.5 px-1">
                {index.ignored.map((f) => (
                  <FindingRow
                    key={f.id}
                    finding={f}
                    controller={controller}
                    onJump={jump}
                    ignoredView
                  />
                ))}
              </div>
            )
          ) : nothingActive ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
              <ShieldCheck className="size-7 text-emerald-600 dark:text-emerald-500" />
              <p className="text-sm font-medium">All clear</p>
              <p className="max-w-[16rem] text-xs text-muted-foreground">
                No secrets or leftovers in this diff.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1 px-1">
              {showSecrets && secrets.length > 0 && (
                <Section title="Secrets" color="bg-destructive">
                  {secrets.map((f) => (
                    <FindingRow
                      key={f.id}
                      finding={f}
                      controller={controller}
                      onJump={jump}
                    />
                  ))}
                </Section>
              )}
              {showLeftovers && leftovers.length > 0 && (
                <Section title="Leftovers" color="bg-amber-500">
                  {leftovers.map((f) => (
                    <FindingRow
                      key={f.id}
                      finding={f}
                      controller={controller}
                      onJump={jump}
                    />
                  ))}
                </Section>
              )}
              {filter === "secrets" && secrets.length === 0 && (
                <EmptyNote text="No secret findings." />
              )}
              {filter === "leftovers" && leftovers.length === 0 && (
                <EmptyNote text="No leftover findings." />
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function EmptyNote({ text }: { text: string }) {
  return (
    <div className="p-8 text-center text-xs text-muted-foreground">{text}</div>
  )
}
