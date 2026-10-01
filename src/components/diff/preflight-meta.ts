import type {
  PreflightCategory,
  PreflightFinding,
  PreflightSeverity,
} from "@/lib/types"

// ── Severity → colour tokens ──────────────────────────────────────────────────
// Blockers reuse the existing destructive token; warnings reuse the amber tokens
// already used elsewhere in the app (e.g. the truncation notice). The matching
// icons (ShieldAlert / TriangleAlert / ShieldCheck) are rendered as static
// components at each call site to satisfy the static-components lint rule.
export const SEVERITY_TEXT: Record<PreflightSeverity, string> = {
  blocker: "text-destructive",
  warning: "text-amber-600 dark:text-amber-500",
}

export const SEVERITY_BG: Record<PreflightSeverity, string> = {
  blocker: "bg-destructive/10",
  warning: "bg-amber-500/10",
}

/** Left-edge accent border colour for an inline-marked line. */
export const SEVERITY_BORDER: Record<PreflightSeverity, string> = {
  blocker: "border-destructive",
  warning: "border-amber-500",
}

/** Solid dot colour, used in the file tree / list (by category). */
export const CATEGORY_DOT: Record<PreflightCategory, string> = {
  secret: "bg-destructive",
  leftover: "bg-amber-500",
}

// ── Finding index (active vs ignored, per-path + per-line lookups) ────────────
export interface FindingCounts {
  secrets: number
  leftovers: number
}

export interface FindingIndex {
  /** Findings the user has NOT suppressed. */
  active: PreflightFinding[]
  /** Findings suppressed via the allowlist (per-finding or per-rule). */
  ignored: PreflightFinding[]
  /** Active counts per file path. */
  byPath: Map<string, FindingCounts>
  /** Active findings per file path, keyed by new-side line number. */
  byPathLine: Map<string, Map<number, PreflightFinding[]>>
  /** Active secret count. */
  secrets: number
  /** Active leftover count. */
  leftovers: number
}

/** Partition + index findings using the caller's current ignore predicate. */
export function buildFindingIndex(
  findings: PreflightFinding[],
  isIgnored: (f: PreflightFinding) => boolean,
): FindingIndex {
  const active: PreflightFinding[] = []
  const ignored: PreflightFinding[] = []
  const byPath = new Map<string, FindingCounts>()
  const byPathLine = new Map<string, Map<number, PreflightFinding[]>>()
  let secrets = 0
  let leftovers = 0

  for (const f of findings) {
    if (isIgnored(f)) {
      ignored.push(f)
      continue
    }
    active.push(f)
    if (f.category === "secret") secrets++
    else leftovers++

    const counts = byPath.get(f.path) ?? { secrets: 0, leftovers: 0 }
    if (f.category === "secret") counts.secrets++
    else counts.leftovers++
    byPath.set(f.path, counts)

    let lineMap = byPathLine.get(f.path)
    if (!lineMap) {
      lineMap = new Map<number, PreflightFinding[]>()
      byPathLine.set(f.path, lineMap)
    }
    const lineArr = lineMap.get(f.line) ?? []
    lineArr.push(f)
    lineMap.set(f.line, lineArr)
  }

  return { active, ignored, byPath, byPathLine, secrets, leftovers }
}

/** "2 secrets · 3 leftovers" style label (used in tooltips / a11y). */
export function summaryLabel(secrets: number, leftovers: number): string {
  const parts: string[] = []
  if (secrets > 0) parts.push(`${secrets} ${secrets === 1 ? "secret" : "secrets"}`)
  if (leftovers > 0)
    parts.push(`${leftovers} ${leftovers === 1 ? "leftover" : "leftovers"}`)
  return parts.join(" · ") || "Clean"
}
