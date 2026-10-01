"use client"

import { useState } from "react"
import {
  Blocks,
  Box,
  Braces,
  Component,
  List,
  ListTree,
  Radar,
  SquareFunction,
  Type,
} from "lucide-react"

import type { SymbolKind, SymbolNode } from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

import { KIND_LABEL, type SymbolTouch } from "./symbol-meta"

/** Static kind glyph (rendered per call site to satisfy the static-icon rule). */
function KindIcon({ kind, className }: { kind: SymbolKind; className?: string }) {
  switch (kind) {
    case "class":
      return <Box className={className} />
    case "component":
      return <Component className={className} />
    case "interface":
      return <Blocks className={className} />
    case "type":
      return <Type className={className} />
    case "enum":
      return <List className={className} />
    case "method":
      return <Braces className={className} />
    case "function":
    default:
      return <SquareFunction className={className} />
  }
}

/** Colour for a symbol row by its touch state (added / modified / untouched). */
function rowTone(state: "added" | "modified" | undefined): {
  icon: string
  name: string
} {
  if (state === "added") {
    return { icon: "text-[var(--diff-add-marker)]", name: "text-[var(--diff-add-marker)]" }
  }
  if (state === "modified") {
    return { icon: "text-primary", name: "text-foreground" }
  }
  return { icon: "text-muted-foreground/60", name: "text-muted-foreground" }
}

function OutlineList({
  symbols,
  touch,
  onJump,
  onFindReferences,
}: {
  symbols: SymbolNode[]
  touch: SymbolTouch
  onJump: (line: number) => void
  /** When set, each row gets a subtle "find references" (blast radius) action. */
  onFindReferences?: (name: string) => void
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1">
      {symbols.map((s, i) => {
        const state = touch.state.get(i)
        const tone = rowTone(state)
        const target = touch.firstChangedLine.get(i) ?? s.startLine
        return (
          <div
            key={`${s.name}:${s.startLine}:${i}`}
            className="group/sym relative"
          >
            <button
              type="button"
              onClick={() => onJump(target)}
              title={`${s.name} · ${KIND_LABEL[s.kind]} · L${s.startLine}${
                s.endLine > s.startLine ? `–${s.endLine}` : ""
              }${state ? ` · ${state}` : ""}`}
              className={cn(
                "flex w-full items-center gap-1.5 px-3 py-1 text-left transition-colors",
                "hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                "pointer-coarse:py-2",
                onFindReferences && "pr-9",
              )}
            >
              <span
                className="shrink-0"
                style={{ marginLeft: `${s.depth * 14}px` }}
              >
                <KindIcon kind={s.kind} className={cn("size-3.5", tone.icon)} />
              </span>
              <span className={cn("truncate font-mono text-xs", tone.name)}>
                {s.name}
              </span>
              {state && (
                <span
                  className={cn(
                    "ml-auto shrink-0 rounded-sm px-1 py-px text-[10px] font-medium tabular-nums",
                    state === "added"
                      ? "bg-[var(--diff-add-marker)]/10 text-[var(--diff-add-marker)]"
                      : "bg-primary/10 text-primary",
                  )}
                >
                  {state === "added" ? "added" : "mod"}
                </span>
              )}
            </button>
            {onFindReferences && (
              <Button
                size="icon-xs"
                variant="ghost"
                // Centred with inset-y-0 + my-auto rather than
                // -translate-y-1/2: buttonVariants' active press nudge
                // (translate-y-px) writes the same --tw-translate-y and wins on
                // specificity, which would jump the button on every click.
                className="absolute inset-y-0 right-1 my-auto text-muted-foreground opacity-0 transition-opacity group-hover/sym:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100"
                title={`Find references to ${s.name}`}
                aria-label={`Find references to ${s.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  onFindReferences(s.name)
                }}
              >
                <Radar />
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}

/**
 * Touched-symbols summary chip + outline. Mirrors the preflight/comments
 * summary chips: a muted icon when nothing is touched (still opens the full
 * outline), an icon + count once symbols are touched. The outline lists every
 * symbol as an indented tree with touched ones highlighted, each row jumping to
 * (scroll + pulse) the symbol's first changed line.
 */
export function SymbolOutline({
  symbols,
  touch,
  compact,
  onJump,
  onFindReferences,
}: {
  symbols: SymbolNode[]
  touch: SymbolTouch
  compact: boolean
  onJump: (line: number) => void
  /** Launch the blast-radius search for a symbol (closes the outline). */
  onFindReferences?: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  const count = touch.touchedCount

  function jump(line: number) {
    onJump(line)
    setOpen(false)
  }

  // The blast-radius trigger lives per-row; launching it closes the outline so
  // the references Sheet takes over (same handoff as a jump).
  const findRefs = onFindReferences
    ? (name: string) => {
        onFindReferences(name)
        setOpen(false)
      }
    : undefined

  const title =
    count > 0
      ? `${count} touched symbol${count === 1 ? "" : "s"} · ${symbols.length} total`
      : `${symbols.length} symbol${symbols.length === 1 ? "" : "s"}`

  // Empty Button via render + children outside — the app's trigger convention.
  const triggerButton = (
    <Button
      size="xs"
      variant="ghost"
      className={cn(
        "shrink-0 gap-1.5 tabular-nums pointer-coarse:h-9",
        count === 0 && "text-muted-foreground",
      )}
      title={title}
      aria-label={title}
    />
  )
  const triggerChildren = (
    <>
      <ListTree />
      {count > 0 && count}
    </>
  )

  const header = (
    <div className="flex items-center gap-2 border-b px-3 py-2">
      <ListTree className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="text-xs font-medium">Outline</span>
      <span className="ml-auto text-[11px] tabular-nums text-muted-foreground">
        {count > 0 ? `${count} touched · ` : ""}
        {symbols.length} symbol{symbols.length === 1 ? "" : "s"}
      </span>
    </div>
  )

  if (compact) {
    return (
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger render={triggerButton}>{triggerChildren}</SheetTrigger>
        {/* No close button: it would sit on top of the first row's "find
            references" action (both land in the top-right corner), and the
            app's other left drawers dismiss the same way — backdrop or Esc. */}
        <SheetContent
          side="left"
          showCloseButton={false}
          className="w-[88%] max-w-sm gap-0 p-0"
        >
          <SheetTitle className="sr-only">Symbol outline</SheetTitle>
          {header}
          <OutlineList
            symbols={symbols}
            touch={touch}
            onJump={jump}
            onFindReferences={findRefs}
          />
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={triggerButton}>{triggerChildren}</PopoverTrigger>
      <PopoverContent
        align="start"
        className="flex max-h-[60vh] w-72 flex-col gap-0 p-0"
      >
        {header}
        <OutlineList
          symbols={symbols}
          touch={touch}
          onJump={jump}
          onFindReferences={findRefs}
        />
      </PopoverContent>
    </Popover>
  )
}
