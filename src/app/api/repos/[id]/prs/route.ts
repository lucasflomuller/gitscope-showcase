import { NextResponse, type NextRequest } from "next/server"
import { getRepo } from "@/lib/config"
import { getPullRequests } from "@/lib/pulls"

export const dynamic = "force-dynamic"

/**
 * GET /api/repos/[id]/prs[?refresh=1]
 *   → PullsResponse: { available, repo?, prs }
 *
 * Best-effort GitHub PR status, keyed by head branch. Mirrors the refs/
 * references route shape (Next-16: `ctx.params` is a Promise, dynamic). 404 is
 * returned ONLY for an unknown repo id; every gh / GitHub failure is already
 * folded into `available:false` upstream, so a non-GitHub repo, missing/unauthed
 * gh, offline, or rate-limited all return HTTP 200 with `available:false` —
 * never an error, so the picker and dashboard render unchanged. `refresh=1`
 * bypasses the 60s server cache.
 */
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

    const refresh = req.nextUrl.searchParams.get("refresh") === "1"
    const pulls = await getPullRequests(repo.path, { refresh })
    return NextResponse.json(pulls) // always { available, repo?, prs }
  } catch {
    // Defensive only — getPullRequests never throws, but keep the route a 200.
    return NextResponse.json({ available: false, prs: {} })
  }
}
