"use client"

import { useMemo, useState } from "react"
import {
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  CircleCheckBig,
  Loader2,
  Sparkles,
  Trash2,
} from "lucide-react"
import { toast } from "sonner"

import type { DiffFileSummary, GuideSection } from "@/lib/types"
import { formatRelativeTime } from "@/lib/format-time"
import type { GuideController } from "@/hooks/use-guide"
import type { ViewedController } from "@/hooks/use-viewed"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { FileStatusIcon, ViewedCheck } from "./file-meta"

function splitPath(path: string): { dir: string; base: string } {
  const idx = path.lastIndexOf("/")
  if (idx === -1) return { dir: "", base: path }
  return { dir: path.slice(0, idx + 1), base: path.slice(idx + 1) }
}

function sectionNumber(i: number, total: number): string {
  return `${String(i + 1).padStart(2, "0")}/${String(total).padStart(2, "0")}`
}

/** One file row inside the open section — DiffFileList's grammar + viewed check. */
function SectionFileRow({
  path,
  summary,
  selected,
  onSelect,
  viewed,
}: {
  path: string
  summary?: DiffFileSummary
  selected: boolean
  onSelect: (path: string) => void
  viewed?: ViewedController
}) {
  const { dir, base } = splitPath(path)
  const isViewed = viewed?.isViewed(path) ?? false
  return (
    <button
      type="button"
      onClick={() => onSelect(path)}
      title={path}
      data-path={path}
      className={cn(
        "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60 pointer-coarse:py-2",
        selected && "bg-accent",
      )}
    >
      <FileStatusIcon status={summary?.status ?? "modified"} />
      <span
        className={cn(
          "flex min-w-0 flex-1 items-baseline overflow-hidden font-mono",
          isViewed && !selected && "text-muted-foreground/70",
        )}
      >
        {dir && <span className="min-w-0 truncate text-muted-foreground">{dir}</span>}
        <span className="shrink-0 font-medium">{base}</span>
      </span>
      {summary && (
        <span className="shrink-0 font-mono text-[11px] tabular-nums">
          <span className="text-[var(--diff-add-marker)]">+{summary.additions}</span>{" "}
          <span className="text-[var(--diff-del-marker)]">−{summary.deletions}</span>
        </span>
      )}
      <ViewedCheck viewed={viewed} path={path} />
    </button>
  )
}

/**
 * The Linear-style review guide pane, v2: an accordion where exactly one
 * section is open — the one you're reading, followed automatically. Section
 * progress derives entirely from the viewed-files system (one tracking system,
 * no separate checkboxes): a section settles once every file in it is viewed.
 */
export function GuidePanel({
  repoId,
  controller,
  sections,
  files,
  selectedPath,
  onSelectPath,
  viewed,
}: {
  repoId: string | null
  controller: GuideController
  /** Diff-filtered sections (only paths visible in this diff; see DiffViewer). */
  sections: GuideSection[]
  /** Changed files of the current diff — status/± for the section file rows. */
  files: DiffFileSummary[]
  selectedPath: string | null
  onSelectPath: (p: string) => void
  viewed?: ViewedController
}) {
  const { guide, isLoading, generating, error, generate, discard } = controller

  const summaryByPath = useMemo(() => {
    const m = new Map<string, DiffFileSummary>()
    for (const f of files) m.set(f.path, f)
    return m
  }, [files])

  // Accordion: manual clicks open a section; navigating the diff auto-follows
  // (render-phase adjust keyed on which section the selected file is in).
  const selSectionId = selectedPath
    ? (sections.find((s) => s.paths.includes(selectedPath))?.id ?? null)
    : null
  const [openId, setOpenId] = useState<string | null>(null)
  const [followedId, setFollowedId] = useState<string | null>(null)
  if (selSectionId !== followedId) {
    setFollowedId(selSectionId)
    if (selSectionId) setOpenId(selSectionId)
  }

  const doneCount = (s: GuideSection) => viewed?.countIn(s.paths) ?? 0
  const isDone = (s: GuideSection) =>
    s.paths.length > 0 && doneCount(s) === s.paths.length

  // Default open: the first unfinished section (reading order), else the first.
  const effectiveOpen =
    openId ?? sections.find((s) => !isDone(s))?.id ?? sections[0]?.id ?? null

  const allPaths = useMemo(() => sections.flatMap((s) => s.paths), [sections])
  const totalDone = viewed?.countIn(allPaths) ?? 0
  const allDone = allPaths.length > 0 && totalDone === allPaths.length

  function openSection(s: GuideSection) {
    setOpenId(s.id)
    // Jump into the section: its first unviewed file, else its first file.
    const target = s.paths.find((p) => !(viewed?.isViewed(p) ?? false)) ?? s.paths[0]
    if (target) onSelectPath(target)
  }

  function markSection(s: GuideSection) {
    if (!viewed) return
    for (const p of s.paths) if (!viewed.isViewed(p)) viewed.toggle(p)
  }

  function runGenerate() {
    generate().catch((e) =>
      toast.error(e instanceof Error ? e.message : "Guide generation failed"),
    )
  }

  // First load for this comparison: never flash the zero-state, or a reviewer
  // kicks off a minutes-long generation for a guide that was about to arrive.
  if (!guide && isLoading) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex flex-col gap-1.5 border-b px-3 py-2.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-1.5 w-full rounded-full" />
        </div>
        <div className="flex flex-col gap-2 p-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-full" />
          ))}
        </div>
      </div>
    )
  }

  if (!guide) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-10 text-center">
        <BookOpen className="size-8 text-muted-foreground/60" />
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium">No review guide yet</p>
          <p className="max-w-[15rem] text-xs text-muted-foreground">
            A guide organizes this diff into explained, ordered chunks — like a
            tour of the change set.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          className="gap-1.5 pointer-coarse:h-9"
          disabled={generating || !repoId}
          onClick={runGenerate}
        >
          {generating ? <Loader2 className="animate-spin" /> : <Sparkles />}
          {generating ? "Generating…" : "Generate with Claude"}
        </Button>
        {generating && (
          <p className="text-[11px] text-muted-foreground/70">
            Reading the whole diff — usually 1–3 minutes. Keep this comparison open.
          </p>
        )}
        {error && !generating && (
          <p className="max-w-[16rem] rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-[11px] leading-relaxed text-destructive">
            {error}
            {/* Own line: server messages already end in their own "— try again". */}
            <span className="mt-0.5 block">
              Check that{" "}
              <code className="rounded bg-destructive/10 px-1 font-mono">claude</code>{" "}
              works in a terminal.
            </span>
          </p>
        )}
        <p className="max-w-[16rem] text-[10px] leading-relaxed text-muted-foreground/70">
          Agents can also submit one over MCP:
          <code className="mt-1 block rounded bg-muted px-1.5 py-1 font-mono text-[9px]">
            claude mcp add --transport http gitscope http://127.0.0.1:3000/api/mcp
          </code>
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-col gap-1.5 border-b px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <BookOpen className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={guide.title}>
            {guide.title}
          </span>
          <span
            className="flex shrink-0 items-center gap-1 rounded bg-muted px-1 py-0.5 text-[10px] tracking-wide text-muted-foreground uppercase"
            title={`Generated ${guide.generatedBy === "mcp" ? "by an MCP agent" : "with the local claude CLI"} · ${formatRelativeTime(guide.createdAt)}`}
          >
            <Bot className="size-3" />
            {guide.generatedBy}
          </span>
          <Button
            size="icon-xs"
            variant="ghost"
            className="shrink-0 text-muted-foreground pointer-coarse:size-9"
            title="Discard this guide"
            aria-label="Discard this guide"
            onClick={() => {
              void discard().catch((e) =>
                toast.error(e instanceof Error ? e.message : "Couldn't discard"),
              )
            }}
          >
            <Trash2 />
          </Button>
        </div>
        {guide.summary && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">
            {guide.summary}
          </p>
        )}
        <div className="flex items-center gap-2">
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[var(--diff-add-marker)] transition-[width] duration-300"
              style={{
                width: `${allPaths.length ? (totalDone / allPaths.length) * 100 : 0}%`,
              }}
            />
          </div>
          <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
            {totalDone}/{allPaths.length} files
          </span>
        </div>
        {allDone && (
          <p className="flex items-center gap-1.5 rounded-md bg-[var(--diff-add-bg)] px-2 py-1 text-[11px] text-foreground/80">
            <CircleCheckBig className="size-3.5 shrink-0 text-[var(--diff-add-marker)]" />
            Every section reviewed — nice work.
          </p>
        )}
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {/* Every path was filtered out (noise, or the compare ref moved on) —
            without this the panel is a blank void under a 0/0 progress bar. */}
        {sections.length === 0 && (
          <div className="flex flex-col items-center gap-1.5 px-6 py-10 text-center">
            <p className="text-sm font-medium">Nothing to show here</p>
            <p className="max-w-[16rem] text-xs leading-relaxed text-muted-foreground">
              None of this guide&apos;s files are in the current view — they may
              be hidden as generated or whitespace-only, or no longer part of
              this comparison. If it stays empty, discard the guide to generate
              a fresh one.
            </p>
          </div>
        )}
        <div className="flex flex-col">
          {sections.map((s, i) => {
            const open = s.id === effectiveOpen
            const done = isDone(s)
            const n = doneCount(s)
            return (
              <div key={s.id} className={cn("border-b", open && "bg-muted/20")}>
                <button
                  type="button"
                  onClick={() => (open ? setOpenId(null) : openSection(s))}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 pointer-coarse:py-3"
                >
                  <ChevronRight
                    className={cn(
                      "size-3.5 shrink-0 text-muted-foreground transition-transform",
                      open && "rotate-90",
                    )}
                  />
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                    {sectionNumber(i, sections.length)}
                  </span>
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      open && "font-medium",
                      done && "text-muted-foreground",
                    )}
                  >
                    {s.title}
                  </span>
                  {done ? (
                    <CircleCheckBig className="size-4 shrink-0 text-[var(--diff-add-marker)]" />
                  ) : (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {n}/{s.paths.length}
                    </span>
                  )}
                </button>

                {open && (
                  <div className="flex flex-col gap-1.5 px-3 pb-3">
                    {s.explanation && (
                      <p className="pl-6 text-xs leading-relaxed break-words text-muted-foreground">
                        {s.explanation}
                      </p>
                    )}
                    <div className="flex flex-col pl-4">
                      {s.paths.map((p) => (
                        <SectionFileRow
                          key={p}
                          path={p}
                          summary={summaryByPath.get(p)}
                          selected={p === selectedPath}
                          onSelect={onSelectPath}
                          viewed={viewed}
                        />
                      ))}
                    </div>
                    {viewed && !done && (
                      <div className="pl-6">
                        <Button
                          size="xs"
                          variant="ghost"
                          className="gap-1 text-muted-foreground pointer-coarse:h-9"
                          title="Mark every file in this section viewed"
                          onClick={() => markSection(s)}
                        >
                          <Check />
                          Mark section viewed
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </ScrollArea>
    </div>
  )
}

/**
 * Slim section context above the diff while the Guide tab drives navigation:
 * number, title, the explanation (clamped, click to expand), and an ambient
 * "file n of m in section" position. Scrolls away with the content — it
 * orients, it doesn't chase.
 */
export function GuideSectionBanner({
  section,
  index,
  total,
  pos,
}: {
  section: GuideSection
  index: number
  total: number
  pos: number
}) {
  const [expanded, setExpanded] = useState(false)
  return (
    <div className="border-b bg-muted/20 px-4 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
          {sectionNumber(index, total)}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm font-medium">
          {section.title}
        </span>
        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
          file {pos} of {section.paths.length} in section
        </span>
      </div>
      {section.explanation && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          title={expanded ? "Collapse" : "Expand"}
          aria-expanded={expanded}
          className={cn(
            "mt-1 w-full rounded text-left text-xs leading-relaxed text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            !expanded && "line-clamp-2",
          )}
        >
          {section.explanation}
        </button>
      )}
    </div>
  )
}
