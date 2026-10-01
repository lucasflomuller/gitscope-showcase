import { NextResponse, type NextRequest } from "next/server"
import { getRepo } from "@/lib/config"
import {
  addComment,
  clearComments,
  readComments,
  removeComment,
  updateComment,
  updateCommentState,
} from "@/lib/comments-config"
import { reviewScope } from "@/lib/git"
import type { Comment, CommentState } from "@/lib/types"

function parseState(v: unknown): CommentState | undefined {
  return v === "open" || v === "addressed" || v === "resolved" ? v : undefined
}

/**
 * Resolve the caller's compare side to a review scope. Callers always send
 * `compare`; a missing one yields undefined, which means "whole repo" — the
 * unscoped behaviour kept only so a bare curl still works.
 */
async function scopeOf(
  repoPath: string,
  compare: unknown,
): Promise<string | undefined> {
  return typeof compare === "string" && compare
    ? reviewScope(repoPath, compare)
    : undefined
}

export const dynamic = "force-dynamic"

async function parseBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const json = (await req.json()) as unknown
    if (!json || typeof json !== "object") return {}
    return json as Record<string, unknown>
  } catch {
    return {}
  }
}

/** GET /api/repos/[id]/comments?compare=… → Comment[] for that branch */
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
    const scope = await scopeOf(repo.path, req.nextUrl.searchParams.get("compare"))
    const comments = await readComments(id, scope)
    return NextResponse.json(comments)
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to read comments"
    return NextResponse.json({ error }, { status: 500 })
  }
}

/** POST /api/repos/[id]/comments  body: Comment → create */
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
    // Stamp the scope server-side: the client knows its compare ref but can't
    // resolve WORKING/STAGED to a branch, and a client-supplied scope would let
    // a note be filed onto a branch it wasn't written against.
    const ref = await scopeOf(repo.path, body.compare)
    const comment = await addComment(id, ref ? { ...body, ref } : body)
    return NextResponse.json({ ok: true, comment })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to add comment"
    return NextResponse.json({ error }, { status: 400 })
  }
}

/** PATCH /api/repos/[id]/comments  body: {id, body} → update body */
export async function PATCH(
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
    const commentId = typeof body.id === "string" ? body.id : undefined
    const text = typeof body.body === "string" ? body.body : undefined
    // A state change and a body edit can arrive together or apart; require id
    // plus at least one of the two, and reject a present-but-invalid state.
    const hasState = body.state !== undefined
    const state = parseState(body.state)
    if (hasState && !state) {
      return NextResponse.json({ error: "Invalid comment state" }, { status: 400 })
    }
    if (!commentId || (text === undefined && !state)) {
      return NextResponse.json(
        { error: "Provide a comment 'id' and a 'body' or 'state'" },
        { status: 400 },
      )
    }
    // Body first, then state, so a combined update returns the fully-applied row.
    let comment: Comment | null = null
    if (text !== undefined) {
      comment = await updateComment(id, commentId, text)
      if (!comment) {
        return NextResponse.json({ error: "Comment not found" }, { status: 404 })
      }
    }
    if (state) {
      const stateNote =
        typeof body.stateNote === "string" ? body.stateNote : undefined
      comment = await updateCommentState(id, commentId, state, stateNote)
      if (!comment) {
        return NextResponse.json({ error: "Comment not found" }, { status: 404 })
      }
    }
    return NextResponse.json({ ok: true, comment })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to update comment"
    return NextResponse.json({ error }, { status: 400 })
  }
}

/** DELETE /api/repos/[id]/comments?id=… → remove one; no id → clear all. */
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
    const commentId = req.nextUrl.searchParams.get("id")
    if (commentId) {
      await removeComment(id, commentId)
    } else {
      // Scoped: "clear all" wipes the branch under review, not every branch's.
      const scope = await scopeOf(
        repo.path,
        req.nextUrl.searchParams.get("compare"),
      )
      await clearComments(id, scope)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    const error = err instanceof Error ? err.message : "Failed to delete comments"
    return NextResponse.json({ error }, { status: 500 })
  }
}
