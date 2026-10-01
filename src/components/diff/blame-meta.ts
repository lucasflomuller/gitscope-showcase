import { formatRelativeTime } from "@/lib/format-time"

// ── Blame gutter age styling ──────────────────────────────────────────────────
// Newest commits read as the strongest tint, fading to transparent for the
// oldest — a subtle recency heat map on the new-side blame column. The ramp is
// deliberately neutral: this column sits flush against the add/delete gutters,
// and green/red belong to those, not to "recent".

const DAY_MS = 24 * 60 * 60 * 1000

/** Age bucket for a commit date: <7d→0, <30d→1, <180d→2, <365d→3, else/invalid→4. */
export function ageBucket(dateIso: string, now = Date.now()): 0 | 1 | 2 | 3 | 4 {
  const t = Date.parse(dateIso)
  if (!Number.isFinite(t)) return 4
  const days = (now - t) / DAY_MS
  if (days < 7) return 0
  if (days < 30) return 1
  if (days < 180) return 2
  if (days < 365) return 3
  return 4
}

/** Tailwind background tint per age bucket (newest strongest → oldest transparent). */
export const AGE_TINT: Record<number, string> = {
  0: "bg-muted-foreground/25",
  1: "bg-muted-foreground/15",
  2: "bg-muted-foreground/10",
  3: "bg-muted-foreground/5",
  4: "bg-transparent",
}

/** Compact relative age ("3h ago") for a blame tooltip; reuses the shared formatter. */
export function relativeDate(dateIso: string): string {
  return formatRelativeTime(dateIso)
}
