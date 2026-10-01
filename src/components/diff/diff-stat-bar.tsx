"use client"

import { cn } from "@/lib/utils"

const SQUARES = 5

/**
 * GitHub-style proportional add/remove indicator: five small squares filled
 * green (additions) and red (deletions) in proportion, the rest neutral.
 */
export function DiffStatBar({
  additions,
  deletions,
}: {
  additions: number
  deletions: number
}) {
  const total = additions + deletions
  let green = 0
  let red = 0
  if (total > 0) {
    green = Math.round((additions / total) * SQUARES)
    // Guarantee at least one square per side that actually has changes.
    if (additions > 0 && green === 0) green = 1
    if (deletions > 0 && green === SQUARES) green = SQUARES - 1
    if (additions === 0) green = 0
    red = SQUARES - green
    if (deletions === 0) red = 0
  }

  return (
    <span
      className="inline-flex shrink-0 items-center gap-px"
      aria-hidden
      title={`+${additions} −${deletions}`}
    >
      {Array.from({ length: SQUARES }).map((_, i) => {
        const isGreen = i < green
        const isRed = !isGreen && i < green + red
        return (
          <span
            key={i}
            className={cn(
              "size-[7px] rounded-[2px]",
              isGreen
                ? "bg-[var(--diff-add-marker)]"
                : isRed
                  ? "bg-[var(--diff-del-marker)]"
                  : "bg-muted-foreground/20"
            )}
          />
        )
      })}
    </span>
  )
}
