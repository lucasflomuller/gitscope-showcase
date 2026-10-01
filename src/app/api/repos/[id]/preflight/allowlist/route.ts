import { NextResponse, type NextRequest } from "next/server"
import { getRepo } from "@/lib/config"
import { addIgnore, getAllowlist, removeIgnore } from "@/lib/preflight-config"

export const dynamic = "force-dynamic"

type Body = { id?: string; ruleId?: string }

async function parseBody(req: NextRequest): Promise<Body> {
  try {
    const json = (await req.json()) as unknown
    if (!json || typeof json !== "object") return {}
    const o = json as Record<string, unknown>
    return {
      id: typeof o.id === "string" ? o.id : undefined,
      ruleId: typeof o.ruleId === "string" ? o.ruleId : undefined,
    }
  } catch {
    return {}
  }
}

/** GET /api/repos/[id]/preflight/allowlist → PreflightAllowlist */
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
    const allowlist = await getAllowlist(id)
    return NextResponse.json(allowlist)
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to read allowlist"
    return NextResponse.json({ error }, { status: 500 })
  }
}

/** POST /api/repos/[id]/preflight/allowlist  body {id?,ruleId?} → add ignore */
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
    const body = await parseBody(req)
    if (!body.id && !body.ruleId) {
      return NextResponse.json(
        { error: "Provide an 'id' or a 'ruleId' to ignore" },
        { status: 400 },
      )
    }
    const allowlist = await addIgnore(id, body)
    return NextResponse.json({ ok: true, allowlist })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to add ignore"
    return NextResponse.json({ error }, { status: 500 })
  }
}

/** DELETE /api/repos/[id]/preflight/allowlist  body {id?,ruleId?} → un-ignore */
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
    const body = await parseBody(req)
    if (!body.id && !body.ruleId) {
      return NextResponse.json(
        { error: "Provide an 'id' or a 'ruleId' to un-ignore" },
        { status: 400 },
      )
    }
    const allowlist = await removeIgnore(id, body)
    return NextResponse.json({ ok: true, allowlist })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to remove ignore"
    return NextResponse.json({ error }, { status: 500 })
  }
}
