import { NextResponse, type NextRequest } from "next/server"
import { removeRepo } from "@/lib/config"

export const dynamic = "force-dynamic"

/** DELETE /api/repos/[id] → { ok: true } */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await ctx.params
    await removeRepo(id)
    return NextResponse.json({ ok: true })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to remove repo"
    return NextResponse.json({ error }, { status: 500 })
  }
}
