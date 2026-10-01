import { NextResponse, type NextRequest } from "next/server"
import { getRepo } from "@/lib/config"
import { getSymbols, grammarForPath } from "@/lib/symbols"

export const dynamic = "force-dynamic"

/**
 * POST /api/repos/[id]/symbols  body: { ref, path }
 *   → { symbols: SymbolNode[], lang: string | null }
 *
 * Lazy, ref-correct symbol outline for ONE file (the compare-side blob at
 * `ref`). Best-effort: unsupported languages / parse failures return an empty
 * symbol list rather than an error, so the diff renders unchanged.
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

    let body: { ref?: unknown; path?: unknown } = {}
    try {
      body = (await req.json()) as { ref?: unknown; path?: unknown }
    } catch {
      /* empty / invalid body → handled by the guard below */
    }

    const ref = typeof body.ref === "string" ? body.ref : ""
    const filePath = typeof body.path === "string" ? body.path : ""
    if (!ref || !filePath) {
      return NextResponse.json(
        { error: "Both 'ref' and 'path' are required" },
        { status: 400 },
      )
    }

    const lang = grammarForPath(filePath)
    const symbols = await getSymbols(repo.path, ref, filePath)
    return NextResponse.json({ symbols, lang })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to compute symbols"
    return NextResponse.json({ error }, { status: 500 })
  }
}
