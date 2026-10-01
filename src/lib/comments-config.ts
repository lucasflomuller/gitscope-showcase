import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { CONFIG_DIR } from "@/lib/config"
import type { Comment, CommentSource, CommentState } from "@/lib/types"

/** The review-comments file: ~/.config/gitscope/comments.json */
export const COMMENTS_PATH = path.join(CONFIG_DIR, "comments.json")

/** On-disk shape: per-repo comment lists keyed by repo id. */
type CommentStore = Record<string, Comment[]>

function isString(v: unknown): v is string {
  return typeof v === "string"
}

/** Narrow an arbitrary parsed value to a well-formed Comment. */
function isComment(v: unknown): v is Comment {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    isString(o.id) &&
    isString(o.path) &&
    typeof o.startLine === "number" &&
    typeof o.endLine === "number" &&
    isString(o.anchorHash) &&
    isString(o.body) &&
    isString(o.createdAt)
  )
}

/** stateNote is bounded so a runaway agent note can't bloat the store. */
const STATE_NOTE_MAX = 2000

function isCommentState(v: unknown): v is CommentState {
  return v === "open" || v === "addressed" || v === "resolved"
}

function isCommentSource(v: unknown): v is CommentSource {
  return v === "user" || v === "ai"
}

/**
 * The optional lifecycle fields (state / source / stateNote), each preserved
 * only when valid so a corrupt on-disk value silently drops to the default.
 * Spread onto a rebuilt Comment (never mutate in place) so an invalid stored
 * value is actually removed rather than riding along.
 */
function lifecycleFields(
  o: Record<string, unknown>,
): Pick<Comment, "state" | "source" | "stateNote"> {
  return {
    ...(isCommentState(o.state) ? { state: o.state } : {}),
    ...(isCommentSource(o.source) ? { source: o.source } : {}),
    ...(isString(o.stateNote)
      ? { stateNote: o.stateNote.slice(0, STATE_NOTE_MAX) }
      : {}),
  }
}

/** Rebuild a stored Comment, sanitising its optional lifecycle fields. */
function cleanComment(c: Comment): Comment {
  return {
    id: c.id,
    path: c.path,
    startLine: c.startLine,
    endLine: c.endLine,
    anchorHash: c.anchorHash,
    body: c.body,
    createdAt: c.createdAt,
    ...(isString(c.updatedAt) ? { updatedAt: c.updatedAt } : {}),
    ...(isString(c.ref) ? { ref: c.ref } : {}),
    ...lifecycleFields(c as unknown as Record<string, unknown>),
  }
}

/** Read the whole store. Returns {} when the file is missing or corrupt. */
async function readStore(): Promise<CommentStore> {
  try {
    const raw = await readFile(COMMENTS_PATH, "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const store: CommentStore = {}
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(entry)) continue
      store[id] = entry.filter(isComment).map(cleanComment)
    }
    return store
  } catch {
    return {}
  }
}

/** Persist the whole store (creates the config dir, pretty-prints JSON). */
async function writeStore(store: CommentStore): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(COMMENTS_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8")
}

/** Sanitise an incoming comment payload into a stored Comment. */
function normalizeIncoming(input: unknown): Comment | null {
  if (!input || typeof input !== "object") return null
  const o = input as Record<string, unknown>
  if (!isString(o.id) || !isString(o.path) || !isString(o.anchorHash)) return null
  const body = isString(o.body) ? o.body : ""
  if (!body.trim()) return null
  const startLine = typeof o.startLine === "number" ? o.startLine : 0
  const endLine = typeof o.endLine === "number" ? o.endLine : startLine
  return {
    id: o.id,
    path: o.path,
    startLine,
    endLine,
    anchorHash: o.anchorHash,
    body,
    createdAt: isString(o.createdAt) ? o.createdAt : new Date().toISOString(),
    ...(isString(o.updatedAt) ? { updatedAt: o.updatedAt } : {}),
    ...(isString(o.ref) ? { ref: o.ref } : {}),
    ...lifecycleFields(o),
  }
}

/**
 * The comments for one repo. Pass `ref` (a `reviewScope` result) to get only
 * the notes filed against that branch — the normal read path, and what keeps
 * one branch's notes off another's diff. Omit it for the whole repo, which the
 * delete-all path needs.
 */
export async function readComments(
  repoId: string,
  ref?: string,
): Promise<Comment[]> {
  const store = await readStore()
  const list = store[repoId] ?? []
  if (ref === undefined) return list
  return list.filter((c) => c.ref === ref)
}

/** Append a comment (replacing any existing one with the same id). */
export async function addComment(
  repoId: string,
  input: unknown,
): Promise<Comment> {
  const comment = normalizeIncoming(input)
  if (!comment) throw new Error("Invalid comment payload")
  const store = await readStore()
  const list = (store[repoId] ?? []).filter((c) => c.id !== comment.id)
  list.push(comment)
  store[repoId] = list
  await writeStore(store)
  return comment
}

/** Update one comment's body (and stamp updatedAt). Returns it, or null. */
export async function updateComment(
  repoId: string,
  id: string,
  body: string,
): Promise<Comment | null> {
  const trimmed = body.trim()
  if (!trimmed) throw new Error("A comment body is required")
  const store = await readStore()
  const list = store[repoId] ?? []
  const idx = list.findIndex((c) => c.id === id)
  if (idx === -1) return null
  const next: Comment = {
    ...list[idx],
    body: trimmed,
    updatedAt: new Date().toISOString(),
  }
  list[idx] = next
  store[repoId] = list
  await writeStore(store)
  return next
}

/**
 * Set one comment's lifecycle state (and its accompanying note), stamping
 * updatedAt. `stateNote` is stored trimmed + capped; passing `undefined` clears
 * any existing note. Returns the updated comment, or null when the id is absent.
 * Imported by the MCP server — the (repoId, id, state, stateNote?) shape is a
 * load-bearing contract.
 */
export async function updateCommentState(
  repoId: string,
  id: string,
  state: CommentState,
  stateNote?: string,
): Promise<Comment | null> {
  const store = await readStore()
  const list = store[repoId] ?? []
  const idx = list.findIndex((c) => c.id === id)
  if (idx === -1) return null
  const trimmed = stateNote?.trim().slice(0, STATE_NOTE_MAX)
  const next: Comment = {
    ...list[idx],
    state,
    updatedAt: new Date().toISOString(),
  }
  if (trimmed) next.stateNote = trimmed
  else delete next.stateNote
  list[idx] = next
  store[repoId] = list
  await writeStore(store)
  return next
}

/** Remove one comment by id (no-op when absent). */
export async function removeComment(repoId: string, id: string): Promise<void> {
  const store = await readStore()
  const list = store[repoId] ?? []
  const next = list.filter((c) => c.id !== id)
  if (next.length !== list.length) {
    store[repoId] = next
    await writeStore(store)
  }
}

/**
 * Drop comments for a repo. With `ref`, only that branch's notes go — "Clear
 * all notes" is scoped to what the reviewer can actually see, so it can never
 * wipe another branch's review. Without it, the repo's entire list is removed.
 */
export async function clearComments(
  repoId: string,
  ref?: string,
): Promise<void> {
  const store = await readStore()
  const list = store[repoId]
  if (!list) return
  if (ref === undefined) {
    delete store[repoId]
    await writeStore(store)
    return
  }
  const next = list.filter((c) => c.ref !== ref)
  if (next.length !== list.length) {
    store[repoId] = next
    await writeStore(store)
  }
}
