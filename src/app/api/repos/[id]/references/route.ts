import { NextResponse, type NextRequest } from "next/server"
import { getRepo } from "@/lib/config"
import { findReferences } from "@/lib/references"

export const dynamic = "force-dynamic"

/**
 * POST /api/repos/[id]/references  body: { ref, name }
 *   → { references: RefHit[], total, capped, name }
 *
 * Lazy, ref-correct "blast radius" search: every textual reference to `name`
 * across the whole repo at `ref` (`git grep`, no checkout), tree-sitter-filtered
 * to drop comment/string false positives. Best-effort — a bad identifier, no
 * matches, or any failure returns an empty list rather than an error, so the
 * diff renders unchanged.
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

    let body: { ref?: unknown; name?: unknown } = {}
    try {
      body = (await req.json()) as { ref?: unknown; name?: unknown }
    } catch {
      /* empty / invalid body → handled by the guard below */
    }

    const ref = typeof body.ref === "string" ? body.ref : ""
    const name = typeof body.name === "string" ? body.name : ""
    if (!ref || !name) {
      return NextResponse.json(
        { error: "Both 'ref' and 'name' are required" },
        { status: 400 },
      )
    }

    const { references, total, capped } = await findReferences(repo.path, ref, name)
    return NextResponse.json({ references, total, capped, name })
  } catch (err) {
    const error =
      err instanceof Error ? err.message : "Failed to find references"
    return NextResponse.json({ error }, { status: 500 })
  }
}
