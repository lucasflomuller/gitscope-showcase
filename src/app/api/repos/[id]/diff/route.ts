import { NextResponse, type NextRequest } from "next/server"
import { getRepo } from "@/lib/config"
import { getDiff } from "@/lib/git"
import { getAllowlist } from "@/lib/preflight-config"
import { scanDiff, summarizeFindings } from "@/lib/preflight"
import type { DiffMode, PreflightReport } from "@/lib/types"

export const dynamic = "force-dynamic"

/** GET /api/repos/[id]/diff?base&compare&mode → DiffResult */
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
    if (!base || !compare) {
      return NextResponse.json(
        { error: "Both 'base' and 'compare' are required" },
        { status: 400 },
      )
    }

    const mode: DiffMode =
      searchParams.get("mode") === "direct" ? "direct" : "merge-base"

    const ignoreWhitespace = searchParams.get("whitespace") === "ignore"

    const diff = await getDiff(repo.path, base, compare, mode, ignoreWhitespace)

    // Pre-flight safety scan: one linear regex pass over the already-fetched
    // patch (zero extra git calls). Additive — the diff is unchanged if absent.
    const findings = scanDiff(diff.patch)
    const allowlist = await getAllowlist(id)
    const preflight: PreflightReport = {
      findings,
      summary: summarizeFindings(findings, { truncated: diff.truncated }),
      allowlist,
    }

    return NextResponse.json({ ...diff, preflight })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to compute diff"
    return NextResponse.json({ error }, { status: 500 })
  }
}
