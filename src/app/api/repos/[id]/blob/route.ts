import { NextResponse, type NextRequest } from "next/server"
import { getRepo } from "@/lib/config"
import { getFileAtRef, getFileBytesAtRef } from "@/lib/git"

export const dynamic = "force-dynamic"

/** Extension → mime for the image set (raw mode). */
const MIME_BY_EXT: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  bmp: "image/bmp",
  avif: "image/avif",
}

/** Best-effort content type from a path's extension. */
function mimeForPath(p: string): string {
  const ext = p.slice(p.lastIndexOf(".") + 1).toLowerCase()
  return MIME_BY_EXT[ext] ?? "application/octet-stream"
}

/** GET /api/repos/[id]/blob?ref&path&raw → { content, truncated } | raw bytes */
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

    if (searchParams.get("raw") === "1") {
      const bytes = await getFileBytesAtRef(repo.path, ref, filePath)
      if (!bytes) {
        return NextResponse.json({ error: "Not found" }, { status: 404 })
      }
      // Copy into a plain Uint8Array so the body type matches BodyInit.
      return new NextResponse(Uint8Array.from(bytes), {
        headers: {
          "Content-Type": mimeForPath(filePath),
          "Cache-Control": "no-store",
        },
      })
    }

    const r = await getFileAtRef(repo.path, ref, filePath)
    if (!r) {
      return NextResponse.json({ error: "Not found" }, { status: 404 })
    }
    return NextResponse.json(r)
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to load blob"
    return NextResponse.json({ error }, { status: 500 })
  }
}
