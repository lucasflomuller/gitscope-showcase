import "server-only"

import parseDiff from "parse-diff"

import { extractJson, runClaude } from "@/lib/ai-cli"
import { anchorHashFor, serverCommentId } from "@/lib/comment-anchor"
import { addComment } from "@/lib/comments-config"
import { getDiff, reviewScope } from "@/lib/git"
import type { DiffMode } from "@/lib/types"

/** Hard cap on the patch text we feed the model (keeps the prompt bounded). */
const MAX_PATCH_CHARS = 120_000
/** Never file more than this many notes from one pass. */
const MAX_FINDINGS = 12
/** Clamp a finding's anchored range so a stray endLine can't span the file. */
const MAX_RANGE_LINES = 20
/** Mirror the comments store's body limit (defensive; addComment also trims). */
const MAX_BODY_CHARS = 2000

/** The strict reviewer prompt: patch in, JSON-array-of-findings out. */
function buildPrompt(patch: string): string {
  return [
    "You are a senior code reviewer performing a pre-review of a git diff.",
    "Report ONLY concrete defects in the ADDED code: bugs, broken edge cases,",
    "security issues, leftover debug code, and contract violations. Do NOT report",
    "style nits, formatting preferences, naming opinions, or praise. Report at",
    "most 12 findings — the most important ones.",
    "",
    "Respond with ONLY a JSON array and nothing else. Each element is an object:",
    '  { "path": string, "line": number, "endLine": number (optional), "body": string }',
    "  - path: the new-side file path EXACTLY as it appears in the diff.",
    "  - line: the new-side line number the finding anchors to. It MUST be a line",
    "    that is VISIBLE in the diff below (an added or surrounding context line).",
    "  - endLine: optional last line of a multi-line range; omit for a single line.",
    "  - body: imperative, 1-3 sentences — why it is wrong and what to change.",
    "If nothing qualifies, respond with exactly [].",
    "",
    "Do NOT use any tools. Do NOT output any prose, explanation, markdown, or code",
    "fences outside the single JSON array.",
    "",
    "--- DIFF ---",
    patch,
  ].join("\n")
}

/**
 * Build, once, a new-side line map per file from the parsed patch: the same
 * `byLine` mapping resolveAnchor computes (add → ch.ln, context → ch.ln2), keyed
 * by the diff's display path (to ?? from). Anchoring N findings then costs one
 * diff + one parse instead of one diff per finding.
 */
function buildLineMaps(patch: string): Map<string, Map<number, string>> {
  const maps = new Map<string, Map<number, string>>()
  for (const file of parseDiff(patch)) {
    const to = file.to && file.to !== "/dev/null" ? file.to : undefined
    const from = file.from && file.from !== "/dev/null" ? file.from : undefined
    const key = to ?? from
    if (!key) continue
    const byLine = new Map<number, string>()
    for (const chunk of file.chunks) {
      for (const ch of chunk.changes) {
        if (ch.type === "add") byLine.set(ch.ln, ch.content)
        else if (ch.type === "normal") byLine.set(ch.ln2, ch.content)
      }
    }
    maps.set(key, byLine)
  }
  return maps
}

/**
 * Anchor a NEW-side line range within one file using the pre-built line maps.
 * Returns the content-hash (same digest resolveAnchor produces), or null when
 * the path or any line in the range isn't present in the diff — which also
 * drops hallucinated paths and out-of-range lines the model may invent.
 */
function anchorInDiff(
  lineMaps: Map<string, Map<number, string>>,
  path: string,
  startLine: number,
  endLine: number,
): string | null {
  if (startLine < 1 || endLine < startLine) return null
  const byLine = lineMaps.get(path)
  if (!byLine) return null
  const code: string[] = []
  for (let n = startLine; n <= endLine; n++) {
    const content = byLine.get(n)
    if (content === undefined) return null
    code.push(content)
  }
  return anchorHashFor(path, code)
}

/** A validated + anchored finding, ready to persist. */
interface AnchoredFinding {
  path: string
  startLine: number
  endLine: number
  anchorHash: string
  body: string
}

/**
 * Run one AI pre-review pass over `base..compare` and file each defect the model
 * finds as an "ai"/"open" review comment. Purely additive: it stores notes and
 * returns how many landed; the diff renders identically whether or not it ran.
 *
 * Empty diffs short-circuit. Findings are fully validated + anchored into a list
 * BEFORE anything is stored, so a bad finding mid-list never leaves a partial
 * set filed and then throws. Model output is treated as untrusted text.
 */
export async function runPrereview(
  repoPath: string,
  repoId: string,
  cmp: { base: string; compare: string; mode: DiffMode },
): Promise<{ filed: number }> {
  const diff = await getDiff(repoPath, cmp.base, cmp.compare, cmp.mode)
  if (diff.stats.files === 0) return { filed: 0 }

  const raw = diff.patch ?? ""
  const patch =
    raw.length > MAX_PATCH_CHARS
      ? `${raw.slice(0, MAX_PATCH_CHARS)}\n[diff truncated]`
      : raw

  const text = await runClaude(buildPrompt(patch), {
    cwd: repoPath,
    timeoutMs: 600_000,
  })

  const parsed = extractJson(text)
  if (!Array.isArray(parsed)) {
    throw new Error("The AI response wasn't valid JSON")
  }

  const lineMaps = buildLineMaps(patch)

  // Validate + anchor everything first; only persist once the whole set resolves.
  const anchored: AnchoredFinding[] = []
  for (const item of parsed.slice(0, MAX_FINDINGS)) {
    if (!item || typeof item !== "object") continue
    const o = item as Record<string, unknown>

    const path = typeof o.path === "string" ? o.path : ""
    const line =
      typeof o.line === "number" && Number.isFinite(o.line)
        ? Math.trunc(o.line)
        : Number.NaN
    const body = typeof o.body === "string" ? o.body.trim() : ""
    if (!path || Number.isNaN(line) || line < 1 || !body) continue

    let endLine =
      typeof o.endLine === "number" && Number.isFinite(o.endLine)
        ? Math.trunc(o.endLine)
        : line
    if (endLine < line) endLine = line
    if (endLine > line + MAX_RANGE_LINES - 1) endLine = line + MAX_RANGE_LINES - 1

    const anchorHash = anchorInDiff(lineMaps, path, line, endLine)
    if (!anchorHash) continue

    anchored.push({ path, startLine: line, endLine, anchorHash, body })
  }

  // One resolve for the whole batch — every finding belongs to the branch that
  // was reviewed, so pre-review notes stay off other branches' diffs.
  const ref = await reviewScope(repoPath, cmp.compare)

  let filed = 0
  for (const f of anchored) {
    await addComment(repoId, {
      id: serverCommentId(),
      path: f.path,
      startLine: f.startLine,
      endLine: f.endLine,
      anchorHash: f.anchorHash,
      body: f.body.slice(0, MAX_BODY_CHARS),
      createdAt: new Date().toISOString(),
      state: "open",
      source: "ai",
      ref,
    })
    filed++
  }

  return { filed }
}
