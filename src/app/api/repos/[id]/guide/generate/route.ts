import { NextResponse, type NextRequest } from "next/server"
import { getRepo } from "@/lib/config"
import { getDiff } from "@/lib/git"
import { extractJson, runClaude } from "@/lib/ai-cli"
import { compareKeyFor, saveGuide } from "@/lib/guides"

export const dynamic = "force-dynamic"

const PATCH_CAP = 120_000

/**
 * POST /api/repos/[id]/guide/generate { base, compare, mode } → GuideResponse
 * One-click guide generation via the local claude CLI — the no-MCP-needed
 * path to the same store submit_review_guide writes.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params
    const repo = await getRepo(id)
    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 })
    }
    const body = (await req.json().catch(() => null)) as {
      base?: string
      compare?: string
      mode?: string
    } | null
    const base = body?.base
    const compare = body?.compare
    const mode = body?.mode === "direct" ? "direct" : "merge-base"
    if (!base || !compare) {
      return NextResponse.json(
        { error: "Both 'base' and 'compare' are required" },
        { status: 400 },
      )
    }

    const diff = await getDiff(repo.path, base, compare, mode)
    if (diff.stats.files === 0) {
      return NextResponse.json(
        { error: "No changes between these refs — nothing to organize" },
        { status: 400 },
      )
    }
    const patch =
      diff.patch.length > PATCH_CAP
        ? `${diff.patch.slice(0, PATCH_CAP)}\n[diff truncated]`
        : diff.patch

    const fileList = diff.files
      .map((f) => `${f.path} (${f.status}, +${f.additions} −${f.deletions})`)
      .join("\n")

    const prompt = `You are organizing a code review. Below is a unified diff (${diff.stats.files} files, +${diff.stats.additions} −${diff.stats.deletions}) comparing ${diff.base} → ${diff.compare}.

Group the CHANGED FILES into a guided reading order: 3-8 semantic sections a reviewer should read top to bottom. Group by intent — what changes together and why — never by directory. Every changed file must appear in exactly one section. Order sections so foundations come before their consumers.

Changed files:
${fileList}

Respond with ONLY this JSON (no prose, no code fence, no tool use):
{
  "title": "One-line title of the whole change set",
  "summary": "2-4 sentence overview of what this change accomplishes",
  "sections": [
    {
      "title": "Short section heading",
      "explanation": "2-5 sentences: what this chunk does, how the files relate, and what a reviewer should scrutinise (risks, invariants, edge cases).",
      "paths": ["exact/changed/file/paths.ts"]
    }
  ]
}

Diff:
${patch}`

    // Sonnet: grouping + explanation quality is ample and it's 2-3× faster
    // than opus — this is a button a human is actively waiting on.
    const text = await runClaude(prompt, {
      cwd: repo.path,
      model: "claude-sonnet-5",
      timeoutMs: 600_000,
    })
    const parsed = extractJson(text) as {
      title?: unknown
      summary?: unknown
      sections?: unknown
    } | null
    if (!parsed || !Array.isArray(parsed.sections)) {
      return NextResponse.json(
        { error: "The AI response wasn't a valid guide — try again" },
        { status: 502 },
      )
    }

    // Same path validation as the MCP submit: hallucinated files never render.
    const known = new Set(diff.files.map((f) => f.path))
    const sections = parsed.sections.map((s) => {
      if (!s || typeof s !== "object") return s
      const o = s as Record<string, unknown>
      return {
        ...o,
        paths: Array.isArray(o.paths)
          ? o.paths.filter((p) => typeof p === "string" && known.has(p))
          : [],
      }
    })

    const guide = await saveGuide(repo.id, {
      compareKey: compareKeyFor(mode, base, compare),
      title: parsed.title,
      summary: parsed.summary,
      sections,
      generatedBy: "cli",
    })
    return NextResponse.json({ guide })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Guide generation failed"
    return NextResponse.json({ error }, { status: 500 })
  }
}
