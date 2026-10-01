"use client"

import { Copy, Loader2, Radar, TriangleAlert } from "lucide-react"
import { toast } from "sonner"

import type { RefHit } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import type { ReferencesController } from "@/hooks/use-references"

import { basename, dirname, partitionRefs } from "./references-meta"

/**
 * The "blast radius" panel — a Sheet mirroring PreflightPanel/CommentsPanel.
 *
 * Leads with the marquee insight: references to the clicked symbol that live in
 * files this diff never touches ("Not updated in this diff"), in amber, BEFORE
 * the muted "In this diff" group — the "did you forget them?" question no IDE
 * surfaces because none knows what "the changeset" is.
 *
 * Every row offers "Copy location" (`path:line` → clipboard) — the actual
 * hand-off-to-AI workflow. In-diff rows additionally jump (the file is on
 * screen); not-in-diff rows can't be shown in the viewer, so a click copies.
 */

/** Copy a `path:line` location to the clipboard with a toast. */
async function copyLocation(path: string, line: number): Promise<void> {
  const loc = `${path}:${line}`
  try {
    await navigator.clipboard.writeText(loc)
    toast.success(`Copied ${loc}`)
  } catch {
    toast.error("Couldn't copy the location")
  }
}

function RefRow({
  hit,
  jumpable,
  onJump,
}: {
  hit: RefHit
  /** In-diff rows jump on click; not-in-diff rows copy on click. */
  jumpable: boolean
  onJump: (path: string, line: number) => void
}) {
  const dir = dirname(hit.path)
  const base = basename(hit.path)
  return (
    <div className="group/ref relative">
      <button
        type="button"
        onClick={() =>
          jumpable ? onJump(hit.path, hit.line) : void copyLocation(hit.path, hit.line)
        }
        title={
          jumpable
            ? `Jump to ${hit.path}:${hit.line}`
            : `Copy ${hit.path}:${hit.line}`
        }
        className={cn(
          "flex w-full flex-col gap-1 rounded-lg px-2.5 py-2 pr-9 text-left transition-colors",
          "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
          "pointer-coarse:py-3",
        )}
      >
        <div className="flex min-w-0 items-baseline overflow-hidden font-mono text-xs">
          <span className="min-w-0 truncate text-muted-foreground">{dir}</span>
          <span className="shrink-0 font-medium text-foreground">{base}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">
            :{hit.line}
          </span>
        </div>
        <div className="truncate rounded bg-muted/60 px-1.5 py-1 font-mono text-[11px] leading-snug text-muted-foreground pointer-coarse:text-xs">
          {hit.text.trim()}
        </div>
      </button>

      <div className="absolute top-1.5 right-1 opacity-0 transition-opacity group-hover/ref:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
        <Button
          size="icon-xs"
          variant="ghost"
          className="pointer-coarse:size-9"
          title="Copy location"
          aria-label="Copy location"
          onClick={() => void copyLocation(hit.path, hit.line)}
        >
          <Copy />
        </Button>
      </div>
    </div>
  )
}

function Section({
  title,
  count,
  accent,
  children,
}: {
  title: string
  count: number
  /** Amber for the "not updated" group (the insight); muted otherwise. */
  accent: boolean
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
        <span
          className={cn(
            "size-2 rounded-full",
            accent ? "bg-amber-500" : "bg-muted-foreground/40",
          )}
        />
        <span
          className={cn(
            "text-xs font-medium",
            accent
              ? "text-amber-700 dark:text-amber-400"
              : "text-muted-foreground",
          )}
        >
          {title} ({count})
        </span>
      </div>
      <div className="flex flex-col gap-0.5">{children}</div>
    </div>
  )
}

export function ReferencesPanel({
  controller,
  changedPaths,
  onJump,
  compact,
}: {
  controller: ReferencesController
  /** Every changed-file path (new + rename old) — drives the in/out partition. */
  changedPaths: Set<string>
  onJump: (path: string, line: number) => void
  compact: boolean
}) {
  const { activeName, open, setOpen, hits, total, capped, isLoading, error } =
    controller
  const { inDiff, notInDiff } = partitionRefs(hits, changedPaths)

  const loading = isLoading && hits.length === 0
  const showEmpty = !loading && hits.length === 0

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side={compact ? "left" : "right"}
        className={cn(
          "gap-0 p-0",
          compact ? "w-[92%] max-w-md" : "w-[26rem] sm:max-w-md",
        )}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3 pr-12">
          <div className="min-w-0">
            <SheetTitle className="flex min-w-0 items-center gap-1.5">
              <Radar className="size-4 shrink-0 text-muted-foreground" />
              <span className="shrink-0">References to</span>
              <code className="min-w-0 truncate rounded bg-muted px-1 font-mono text-sm">
                {activeName ?? "…"}
              </code>
            </SheetTitle>
            <p className="truncate text-xs text-muted-foreground">
              {loading ? (
                "Searching…"
              ) : showEmpty ? (
                error ? "Couldn't search references" : "No references found"
              ) : (
                <>
                  {total} reference{total === 1 ? "" : "s"}
                  {" · "}
                  <span
                    className={cn(
                      "tabular-nums",
                      notInDiff.length > 0 &&
                        "font-medium text-amber-700 dark:text-amber-400",
                    )}
                  >
                    {notInDiff.length} not in this diff
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {capped && (
          <div className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
            <TriangleAlert className="size-3.5 shrink-0" />
            Showing the first {hits.length} references.
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {loading ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
              <Loader2 className="size-6 animate-spin text-muted-foreground" />
              <p className="text-xs text-muted-foreground">
                Searching the compare ref…
              </p>
            </div>
          ) : showEmpty ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
              <Radar className="size-7 text-muted-foreground opacity-70" />
              <p className="text-sm font-medium">
                {error ? "Couldn't search references" : "No references found"}
              </p>
              <p className="max-w-[16rem] text-xs text-muted-foreground">
                {error
                  ? "The search failed — the diff is unaffected."
                  : activeName
                    ? `Nothing references “${activeName}” at this ref.`
                    : "Pick a symbol from the outline."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-1 px-1">
              {notInDiff.length > 0 && (
                <Section
                  title="Not updated in this diff"
                  count={notInDiff.length}
                  accent
                >
                  {notInDiff.map((hit, i) => (
                    <RefRow
                      key={`${hit.path}:${hit.line}:${i}`}
                      hit={hit}
                      jumpable={false}
                      onJump={onJump}
                    />
                  ))}
                </Section>
              )}
              {inDiff.length > 0 && (
                <Section title="In this diff" count={inDiff.length} accent={false}>
                  {inDiff.map((hit, i) => (
                    <RefRow
                      key={`${hit.path}:${hit.line}:${i}`}
                      hit={hit}
                      jumpable
                      onJump={onJump}
                    />
                  ))}
                </Section>
              )}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
