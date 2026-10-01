import { NextResponse, type NextRequest } from "next/server"
import path from "node:path"
import { addRepo, readConfig } from "@/lib/config"
import { getRepoStatus, isGitRepo } from "@/lib/git"
import type { RepoConfig, RepoSummary } from "@/lib/types"

export const dynamic = "force-dynamic"

/** Enrich a persisted repo with validity + live status, guarding every call. */
async function toSummary(repo: RepoConfig): Promise<RepoSummary> {
  try {
    const ok = await isGitRepo(repo.path)
    if (!ok) {
      return { ...repo, ok: false, error: "Not a git repository" }
    }
    const status = await getRepoStatus(repo.path)
    return { ...repo, ok: true, status }
  } catch (err) {
    return {
      ...repo,
      ok: false,
      error: err instanceof Error ? err.message : "Failed to read repository",
    }
  }
}

/** GET /api/repos → RepoSummary[] */
export async function GET() {
  try {
    const repos = await readConfig()
    const summaries = await Promise.all(repos.map(toSummary))
    // Keep host usernames and workspace paths out of demo screens and exports.
    const visible = process.env.GITSCOPE_DEMO === "1"
      ? summaries.map((repo) => ({ ...repo, path: `/demo/${path.basename(repo.path)}` }))
      : summaries
    return NextResponse.json(visible)
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to list repos"
    return NextResponse.json({ error }, { status: 500 })
  }
}

/** POST /api/repos { path, name? } → RepoSummary */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as
      | { path?: unknown; name?: unknown }
      | null
    const path = typeof body?.path === "string" ? body.path.trim() : ""
    if (!path) {
      return NextResponse.json(
        { error: "A repository path is required" },
        { status: 400 },
      )
    }
    const name =
      typeof body?.name === "string" && body.name.trim() !== ""
        ? body.name.trim()
        : undefined
    const repo = await addRepo({ path, name })
    const summary = await toSummary(repo)
    return NextResponse.json(summary, { status: 201 })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to add repo"
    return NextResponse.json({ error }, { status: 400 })
  }
}
