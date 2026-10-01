"use client"

import { MessageSquare } from "lucide-react"

import { Button } from "@/components/ui/button"

/**
 * Toolbar chip for the review-notes panel: a speech-bubble icon plus the count
 * of OPEN notes (the actionable ones). Icon-only muted when there are no notes;
 * muted total when notes exist but none are open; a foreground open count
 * otherwise. The title always spells out "X open · Y total".
 */
export function CommentsSummary({
  count,
  openCount,
  onOpen,
}: {
  /** Total review notes (any state). */
  count: number
  /** Notes whose effective state is "open". */
  openCount: number
  onOpen: () => void
}) {
  if (count === 0) {
    return (
      <Button
        size="xs"
        variant="ghost"
        className="gap-1.5 text-muted-foreground pointer-coarse:h-9"
        onClick={onOpen}
        title="Review notes"
        aria-label="Review notes"
      >
        <MessageSquare />
      </Button>
    )
  }

  const title = `${openCount} open · ${count} total review note${count === 1 ? "" : "s"}`

  // Everything triaged: keep the chip present but muted, showing the total.
  if (openCount === 0) {
    return (
      <Button
        size="xs"
        variant="ghost"
        className="gap-1.5 tabular-nums text-muted-foreground pointer-coarse:h-9"
        onClick={onOpen}
        title={title}
        aria-label={`Review notes: ${count} total, none open`}
      >
        <MessageSquare />
        {count}
      </Button>
    )
  }

  return (
    <Button
      size="xs"
      variant="ghost"
      className="gap-1.5 tabular-nums pointer-coarse:h-9"
      onClick={onOpen}
      title={title}
      aria-label={`Review notes: ${openCount} open`}
    >
      <MessageSquare />
      {openCount}
    </Button>
  )
}
