import { NextResponse, type NextRequest } from "next/server"
import path from "node:path"
import { getRepo } from "@/lib/config"
import { getRepoRefs } from "@/lib/git"

export const dynamic = "force-dynamic"

/** GET /api/repos/[id]/refs → RepoRefs */
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params
    const repo = await getRepo(id)
    if (!repo) {
      return NextResponse.json({ error: "Repo not found" }, { status: 404 })
    }
    const refs = await getRepoRefs(repo.path)
    return NextResponse.json(process.env.GITSCOPE_DEMO === "1"
      ? { ...refs, worktrees: refs.worktrees.map((tree) => ({ ...tree, path: `/demo/${path.basename(tree.path)}` })) }
      : refs)
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to load refs"
    return NextResponse.json({ error }, { status: 500 })
  }
}
