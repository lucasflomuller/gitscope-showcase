import { NextResponse, type NextRequest } from "next/server"

import { getRepo } from "@/lib/config"
import { runPrereview } from "@/lib/prereview"

export const dynamic = "force-dynamic"

/**
 * POST /api/repos/[id]/prereview  body: { base, compare, mode }
 *   → { filed: number }
 *
 * Runs the local claude CLI over the comparison's diff and files each concrete
 * defect it finds as an "ai"/"open" review comment (see lib/prereview.ts).
 * Errors surface verbatim (the runClaude messages are user-facing, e.g. "is the
 * claude CLI installed?"), so the panel can show them to the reviewer.
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

    let body: { base?: unknown; compare?: unknown; mode?: unknown } = {}
    try {
      body = (await req.json()) as {
        base?: unknown
        compare?: unknown
        mode?: unknown
      }
    } catch {
      /* empty / invalid body → handled by the guard below */
    }

    const base = typeof body.base === "string" ? body.base : ""
    const compare = typeof body.compare === "string" ? body.compare : ""
    const mode = body.mode
    if (!base || !compare || (mode !== "merge-base" && mode !== "direct")) {
      return NextResponse.json(
        {
          error:
            "'base', 'compare', and a valid 'mode' (merge-base | direct) are required",
        },
        { status: 400 },
      )
    }

    const { filed } = await runPrereview(repo.path, repo.id, {
      base,
      compare,
      mode,
    })
    return NextResponse.json({ filed })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Pre-review failed"
    return NextResponse.json({ error }, { status: 500 })
  }
}
