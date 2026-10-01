/**
 * Client-safe relative / absolute time helpers (no `server-only`).
 *
 * `formatRelativeTime` renders a dense, compact token ("3h ago", "5m ago",
 * "2d ago", "just now") via Intl.RelativeTimeFormat (narrow style). The
 * absolute datetime is for `title` attributes / tooltips. No dependencies.
 */

const RELATIVE = new Intl.RelativeTimeFormat(undefined, {
  numeric: "always",
  style: "narrow",
})

const ABSOLUTE = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
})

/** Largest-first buckets, in milliseconds, mapped to Intl units. */
const UNITS: { unit: Intl.RelativeTimeFormatUnit; ms: number }[] = [
  { unit: "year", ms: 365 * 24 * 60 * 60 * 1000 },
  { unit: "month", ms: 30 * 24 * 60 * 60 * 1000 },
  { unit: "week", ms: 7 * 24 * 60 * 60 * 1000 },
  { unit: "day", ms: 24 * 60 * 60 * 1000 },
  { unit: "hour", ms: 60 * 60 * 1000 },
  { unit: "minute", ms: 60 * 1000 },
]

/** "3h ago" / "just now" / "—" (null or unparseable). */
export function formatRelativeTime(iso: string | null): string {
  if (!iso) return "—"
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return "—"

  const diff = t - Date.now() // negative for the past
  const abs = Math.abs(diff)
  if (abs < 45_000) return "just now"

  for (const { unit, ms } of UNITS) {
    if (abs >= ms) return RELATIVE.format(Math.round(diff / ms), unit)
  }
  return "just now"
}

/** Absolute, locale-formatted datetime for a `title` attribute; "" when null. */
export function formatAbsolute(iso: string | null): string {
  if (!iso) return ""
  const t = Date.parse(iso)
  if (!Number.isFinite(t)) return ""
  return ABSOLUTE.format(new Date(t))
}
