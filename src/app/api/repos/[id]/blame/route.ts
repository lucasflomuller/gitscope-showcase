import { NextResponse, type NextRequest } from "next/server"
import { getRepo } from "@/lib/config"
import { getBlame } from "@/lib/git"

export const dynamic = "force-dynamic"

/** GET /api/repos/[id]/blame?ref&path → { lines: BlameLine[] } */
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
    const ref = searchParams.get("ref")
    const filePath = searchParams.get("path")
    if (!ref || !filePath) {
      return NextResponse.json(
        { error: "Both 'ref' and 'path' are required" },
        { status: 400 },
      )
    }

    const lines = await getBlame(repo.path, ref, filePath)
    return NextResponse.json({ lines })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to load blame"
    return NextResponse.json({ error }, { status: 500 })
  }
}
