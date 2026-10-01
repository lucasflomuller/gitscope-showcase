import { NextResponse, type NextRequest } from "next/server"
import { getRepo } from "@/lib/config"
import { getCommitRange, getCommits } from "@/lib/git"

export const dynamic = "force-dynamic"

/** GET /api/repos/[id]/commits?ref&limit | ?base&compare&limit → CommitInfo[] */
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
    const limitParam = searchParams.get("limit")
    const parsed = limitParam ? Number.parseInt(limitParam, 10) : Number.NaN

    const base = searchParams.get("base")
    const compare = searchParams.get("compare")
    if (base && compare) {
      // Range mode: commits in base..compare (limit capped at 100).
      const limit = Math.min(100, parsed > 0 ? parsed : 100)
      const commits = await getCommitRange(repo.path, base, compare, limit)
      return NextResponse.json(commits)
    }

    const ref = searchParams.get("ref") ?? undefined
    const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : 60

    const commits = await getCommits(repo.path, ref, limit)
    return NextResponse.json(commits)
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to load commits"
    return NextResponse.json({ error }, { status: 500 })
  }
}
