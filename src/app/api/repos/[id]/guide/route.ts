import { NextResponse, type NextRequest } from "next/server"
import { getRepo } from "@/lib/config"
import { compareKeyFor, readGuide, removeGuide } from "@/lib/guides"

export const dynamic = "force-dynamic"

/** GET /api/repos/[id]/guide?base&compare&mode → GuideResponse */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params
    const repo = await getRepo(id)
    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 })
    }
    const { searchParams } = req.nextUrl
    const base = searchParams.get("base")
    const compare = searchParams.get("compare")
    const mode = searchParams.get("mode") === "direct" ? "direct" : "merge-base"
    if (!base || !compare) {
      return NextResponse.json(
        { error: "Both 'base' and 'compare' are required" },
        { status: 400 },
      )
    }
    const guide = await readGuide(repo.id, compareKeyFor(mode, base, compare))
    return NextResponse.json({ guide })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to load the guide"
    return NextResponse.json({ error }, { status: 500 })
  }
}

/** DELETE /api/repos/[id]/guide?base&compare&mode — discard the stored guide. */
export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params
    const repo = await getRepo(id)
    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 })
    }
    const { searchParams } = req.nextUrl
    const base = searchParams.get("base")
    const compare = searchParams.get("compare")
    const mode = searchParams.get("mode") === "direct" ? "direct" : "merge-base"
    if (!base || !compare) {
      return NextResponse.json(
        { error: "Both 'base' and 'compare' are required" },
        { status: 400 },
      )
    }
    await removeGuide(repo.id, compareKeyFor(mode, base, compare))
    return NextResponse.json({ ok: true })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to remove the guide"
    return NextResponse.json({ error }, { status: 500 })
  }
}
