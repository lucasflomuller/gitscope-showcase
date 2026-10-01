"use client"

import { ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

import { summaryLabel } from "./preflight-meta"

/**
 * Toolbar chip summarising the pre-flight scan. Findings → red secret count +
 * amber leftover count; otherwise a calm, muted "Clean" (no shouting on every
 * clean diff). Always clickable to open the findings panel.
 */
export function PreflightSummary({
  secrets,
  leftovers,
  ignoredCount,
  onOpen,
}: {
  /** Active (non-ignored) secret count. */
  secrets: number
  /** Active (non-ignored) leftover count. */
  leftovers: number
  /** Count of currently-suppressed findings. */
  ignoredCount: number
  onOpen: () => void
}) {
  const hasFindings = secrets > 0 || leftovers > 0

  if (!hasFindings) {
    return (
      <Button
        size="xs"
        variant="ghost"
        className="gap-1.5 text-muted-foreground pointer-coarse:h-9"
        onClick={onOpen}
        title={
          ignoredCount > 0
            ? `No active findings · ${ignoredCount} ignored`
            : "No secrets or leftovers in this diff"
        }
      >
        <ShieldCheck className="text-emerald-600 dark:text-emerald-500" />
        <span className="max-[359px]:sr-only">Clean</span>
        {ignoredCount > 0 && (
          <span className="text-muted-foreground/70">({ignoredCount} ignored)</span>
        )}
      </Button>
    )
  }

  return (
    <Button
      size="xs"
      variant="ghost"
      className="gap-2 font-mono tabular-nums pointer-coarse:h-9"
      onClick={onOpen}
      title={`Pre-flight: ${summaryLabel(secrets, leftovers)}`}
      aria-label={`Pre-flight check: ${summaryLabel(secrets, leftovers).replace(" · ", ", ")}`}
    >
      {secrets > 0 && (
        <span className={cn("flex items-center gap-1", "text-destructive")}>
          <ShieldAlert />
          {secrets}
        </span>
      )}
      {leftovers > 0 && (
        <span className="flex items-center gap-1 text-amber-600 dark:text-amber-500">
          <TriangleAlert />
          {leftovers}
        </span>
      )}
    </Button>
  )
}
