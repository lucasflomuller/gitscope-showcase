import Ajv from "ajv"
import { comparisonLink, publicUrl, resolveCommit, validateComparison } from "@/lib/comparison-link"

import { NextRequest, NextResponse } from "next/server"

import { addRepo, removeRepo, getRepo, readConfig } from "@/lib/config"
import { getDiff, getRepoRefs, getCommits, getCommitRange, getRepoStatus, isGitRepo, reviewScope } from "@/lib/git"
import {
  addComment,
  readComments,
  updateCommentState,
} from "@/lib/comments-config"
import { resolveAnchor, serverCommentId } from "@/lib/comment-anchor"
import { compareKeyFor, readGuide, saveGuide } from "@/lib/guides"
import type { CommentState, DiffMode } from "@/lib/types"

export const dynamic = "force-dynamic"

/**
 * GitScope's MCP server — a single stateless Streamable-HTTP endpoint (plain
 * JSON responses; no SSE stream, no sessions) exposing the review loop to
 * agents: read the diff, file/settle review notes, and submit the review
 * guide the UI renders. Connect with:
 *   claude mcp add --transport http gitscope http://127.0.0.1:3000/api/mcp
 */

const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26"]

const SERVER_INFO = { name: "gitscope", version: "0.2.0" }

const INSTRUCTIONS = `GitScope is a local diff-review hub. Typical loop:
1. list_repos → pick the project; add_repo registers an existing local checkout.
   list_refs discovers branches/tags/worktrees without fetching or checking out.
   create_comparison_link returns a validated shareable URL (Tailscale when configured).
   Use pin=true for immutable commit refs, or false to follow branches.
   Never invent URLs. Return the tool URL to the user. remove_repo only unregisters.
2. get_diff → read the comparison under review (defaults to HEAD → working tree).
3. submit_review_guide → organize the diff into a guided reading order with
   explanations; the human sees it instantly in the GitScope UI.
4. get_comments → the human's review notes; address them in the code, then
   set_comment_state to "addressed" with a short note of what you did.
Line numbers are NEW-side (post-change). Comments/guides persist on disk and
render live in the UI.`

// ── Tool definitions ─────────────────────────────────────────────────────────

const CMP_PROPS = {
  base: {
    type: "string",
    description:
      'Base ref: branch/tag/sha or sentinel "WORKING" | "STAGED" | "HEAD". Default "HEAD".',
  },
  compare: {
    type: "string",
    description: 'Compare ref (same forms). Default "WORKING" (the working tree).',
  },
  mode: {
    type: "string",
    enum: ["merge-base", "direct"],
    description:
      '"merge-base" = base...compare (what a PR shows, default); "direct" = raw tree-to-tree.',
  },
} as const

const TOOLS = [
  {
    name: "add_repo",
    description: "Register an existing local Git project by absolute path or ~/path. Idempotent; does not clone or modify its files.",
    inputSchema: { type: "object", properties: { path: { type: "string", minLength: 1 }, name: { type: "string" } }, required: ["path"], additionalProperties: false },
  },
  {
    name: "remove_repo",
    description: "Unregister a project from GitScope. Preserves repository files and review data.",
    inputSchema: { type: "object", properties: { repoId: { type: "string" } }, required: ["repoId"], additionalProperties: false },
  },
  {
    name: "list_refs",
    description: "Discover local branches, remote-tracking branches, tags, worktrees and recent commits. Does not fetch remotes.",
    inputSchema: { type: "object", properties: { repoId: { type: "string" } }, required: ["repoId"], additionalProperties: false },
  },
  {
    name: "list_commits",
    description: "List recent commits, or commits in base..compare when both are supplied. Reads local refs only.",
    inputSchema: { type: "object", properties: { repoId: { type: "string" }, ref: { type: "string" }, base: { type: "string" }, compare: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 100 } }, required: ["repoId"], additionalProperties: false },
  },
  {
    name: "create_comparison_link",
    description: "Get a validated browser link comparing two branches/refs in a registered project, using the configured Tailscale URL. Optional file focus and pin to commit SHAs. Does not checkout, push, or change files. Branch links follow future changes; pinned links retain commit refs while objects remain available.",
    inputSchema: { type: "object", properties: { repoId: { type: "string" }, ...CMP_PROPS, pin: { type: "boolean", default: false }, file: { type: "string" } }, required: ["repoId"], additionalProperties: false },
  },
  {
    name: "list_repos",
    description:
      "List the repositories registered in GitScope with their current branch and dirty state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_diff",
    description:
      "Get the diff for a comparison in one repo: per-file stats plus the unified patch (truncated when very large).",
    inputSchema: {
      type: "object",
      properties: { repoId: { type: "string" }, ...CMP_PROPS },
      required: ["repoId"],
      additionalProperties: false,
    },
  },
  {
    name: "get_comments",
    description:
      "The review notes for a comparison (path, new-side lines, body, lifecycle state, source). Notes with state \"open\" are the actionable worklist.",
    inputSchema: {
      type: "object",
      properties: {
        repoId: { type: "string" },
        ...CMP_PROPS,
        state: {
          type: "string",
          enum: ["open", "addressed", "resolved"],
          description: "Optional filter.",
        },
      },
      required: ["repoId"],
      additionalProperties: false,
    },
  },
  {
    name: "add_comment",
    description:
      "File a review note on a NEW-side line range of the given comparison's diff. Use for findings you want the human to see inline. Lines must be visible in the diff.",
    inputSchema: {
      type: "object",
      properties: {
        repoId: { type: "string" },
        path: { type: "string", description: "New-side file path exactly as in the diff." },
        startLine: { type: "number", description: "New-side line (1-based). 0 with endLine 0 = whole-file note." },
        endLine: { type: "number", description: "Defaults to startLine." },
        body: { type: "string" },
        ...CMP_PROPS,
      },
      required: ["repoId", "path", "startLine", "body"],
      additionalProperties: false,
    },
  },
  {
    name: "set_comment_state",
    description:
      'Update a note\'s lifecycle state. Agents set "addressed" after acting on a note (include a short note of what was done); humans resolve in the UI.',
    inputSchema: {
      type: "object",
      properties: {
        repoId: { type: "string" },
        id: { type: "string" },
        state: { type: "string", enum: ["open", "addressed", "resolved"] },
        note: { type: "string", description: "What was done (shown to the human)." },
      },
      required: ["repoId", "id", "state"],
      additionalProperties: false,
    },
  },
  {
    name: "get_review_guide",
    description: "The stored review guide for a comparison, or null.",
    inputSchema: {
      type: "object",
      properties: { repoId: { type: "string" }, ...CMP_PROPS },
      required: ["repoId"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_review_guide",
    description:
      "Store a guided reading order for a comparison — semantic sections (title + explanation + ordered file paths) the human reviews top-to-bottom in the GitScope UI. Replaces any previous guide for the comparison. Group by intent (what changes together), not by directory; explanations should say what the chunk does and what to scrutinise.",
    inputSchema: {
      type: "object",
      properties: {
        repoId: { type: "string" },
        title: { type: "string", description: "One-line guide title." },
        summary: { type: "string", description: "Optional overall summary of the change set." },
        sections: {
          type: "array",
          items: {
            type: "object",
            properties: {
              title: { type: "string" },
              explanation: { type: "string" },
              paths: { type: "array", items: { type: "string" } },
            },
            required: ["title", "explanation", "paths"],
            additionalProperties: false,
          },
        },
        ...CMP_PROPS,
      },
      required: ["repoId", "sections"],
      additionalProperties: false,
    },
  },
]

const ajv = new Ajv({ allErrors: true })
const validators = new Map(TOOLS.map(tool => [tool.name, ajv.compile(tool.inputSchema)]))
const readOnlyTools = new Set(["list_repos", "list_refs", "list_commits", "create_comparison_link", "get_diff", "get_comments", "get_review_guide"])

// ── Tool handlers ────────────────────────────────────────────────────────────

const PATCH_CAP = 160_000

type Args = Record<string, unknown>

function str(v: unknown, fallback: string): string {
  return typeof v === "string" && v ? v : fallback
}

function cmpOf(args: Args): { base: string; compare: string; mode: DiffMode } {
  const mode = args.mode === "direct" ? "direct" : "merge-base"
  return {
    base: str(args.base, "HEAD"),
    compare: str(args.compare, "WORKING"),
    mode,
  }
}

async function requireRepo(args: Args) {
  const id = str(args.repoId, "")
  const repo = id ? await getRepo(id) : undefined
  if (!repo) throw new Error(`Unknown repoId "${id}" — call list_repos first`)
  return repo
}

async function callTool(name: string, args: Args): Promise<unknown> {
  switch (name) {
    case "add_repo":
      return addRepo({ path: args.path as string, name: args.name as string | undefined })
    case "remove_repo": {
      await removeRepo(args.repoId as string)
      return { repoId: args.repoId, removed: true, filesDeleted: false }
    }
    case "list_refs":
      return getRepoRefs((await requireRepo(args)).path)
    case "list_commits": {
      const repo = await requireRepo(args)
      const limit = (args.limit as number | undefined) ?? 60
      if (args.base !== undefined || args.compare !== undefined) {
        if (!args.base || !args.compare) throw new Error('Provide both base and compare for a commit range')
        const base = await resolveCommit(repo.path, args.base as string)
        const compare = await resolveCommit(repo.path, args.compare as string)
        return getCommitRange(repo.path, base, compare, limit)
      }
      return getCommits(repo.path, await resolveCommit(repo.path, str(args.ref, 'HEAD')), limit)
    }
    case "create_comparison_link": {
      const repo = await requireRepo(args)
      const cmp = cmpOf(args)
      const link = await comparisonLink(repo, cmp, args.pin === true, args.file as string | undefined)
      if (args.file) {
        const diff = await getDiff(repo.path, link.baseCommit, link.compareCommit ?? cmp.compare, cmp.mode)
        if (!diff.files.some(file => file.path === args.file)) throw new Error('Requested file is not in this comparison')
      }
      return link
    }
    case "list_repos": {
      const repos = await readConfig()
      return Promise.all(
        repos.map(async (r) => {
          const ok = await isGitRepo(r.path)
          if (!ok) return { id: r.id, name: r.name, path: r.path, ok: false }
          try {
            const s = await getRepoStatus(r.path)
            return {
              id: r.id,
              name: r.name,
              path: r.path,
              ok: true,
              branch: s.current,
              dirty: !s.clean,
              ahead: s.ahead,
              behind: s.behind,
            }
          } catch {
            return { id: r.id, name: r.name, path: r.path, ok: true }
          }
        }),
      )
    }
    case "get_diff": {
      const repo = await requireRepo(args)
      const cmp = cmpOf(args)
      await validateComparison(repo.path, cmp.base, cmp.compare, cmp.mode)
      const d = await getDiff(repo.path, cmp.base, cmp.compare, cmp.mode)
      const patch = d.patch.length > PATCH_CAP ? d.patch.slice(0, PATCH_CAP) : d.patch
      return {
        base: d.base,
        compare: d.compare,
        mode: d.mode,
        stats: d.stats,
        files: d.files.map((f) => ({
          path: f.path,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          binary: f.binary,
        })),
        patch,
        patchTruncated: d.truncated || d.patch.length > PATCH_CAP,
      }
    }
    case "get_comments": {
      const repo = await requireRepo(args)
      // Scoped to the branch under review, so an agent working one branch never
      // sees (or settles) another branch's notes.
      const all = await readComments(
        repo.id,
        await reviewScope(repo.path, cmpOf(args).compare),
      )
      const filter = args.state
      const effective = (s?: string) => s ?? "open"
      return all
        .filter((c) => (typeof filter === "string" ? effective(c.state) === filter : true))
        .map((c) => ({
          id: c.id,
          path: c.path,
          startLine: c.startLine,
          endLine: c.endLine,
          body: c.body,
          state: effective(c.state),
          source: c.source ?? "user",
          stateNote: c.stateNote,
          createdAt: c.createdAt,
        }))
    }
    case "add_comment": {
      const repo = await requireRepo(args)
      const cmp = cmpOf(args)
      const path = str(args.path, "")
      const body = str(args.body, "").trim()
      const startLine = typeof args.startLine === "number" ? args.startLine : NaN
      const endLine =
        typeof args.endLine === "number" ? args.endLine : startLine
      if (!path || !body || Number.isNaN(startLine)) {
        throw new Error("path, startLine and body are required")
      }
      const anchor = await resolveAnchor(repo.path, cmp, path, startLine, endLine)
      if (!anchor) {
        throw new Error(
          `Lines ${startLine}-${endLine} of ${path} are not visible in this diff — anchor notes to NEW-side lines that appear in get_diff`,
        )
      }
      return addComment(repo.id, {
        id: serverCommentId(),
        path,
        startLine,
        endLine,
        anchorHash: anchor.anchorHash,
        body: body.slice(0, 4000),
        createdAt: new Date().toISOString(),
        state: "open",
        source: "ai",
        ref: await reviewScope(repo.path, cmp.compare),
      })
    }
    case "set_comment_state": {
      const repo = await requireRepo(args)
      const state = args.state
      if (state !== "open" && state !== "addressed" && state !== "resolved") {
        throw new Error('state must be "open" | "addressed" | "resolved"')
      }
      const updated = await updateCommentState(
        repo.id,
        str(args.id, ""),
        state as CommentState,
        typeof args.note === "string" ? args.note : undefined,
      )
      if (!updated) throw new Error(`No comment with id "${str(args.id, "")}"`)
      return updated
    }
    case "get_review_guide": {
      const repo = await requireRepo(args)
      const cmp = cmpOf(args)
      const guide = await readGuide(repo.id, compareKeyFor(cmp.mode, cmp.base, cmp.compare))
      return { guide }
    }
    case "submit_review_guide": {
      const repo = await requireRepo(args)
      const cmp = cmpOf(args)
      // Validate section paths against the actual diff so hallucinated files
      // never render; report what was dropped instead of failing the submit.
      await validateComparison(repo.path, cmp.base, cmp.compare, cmp.mode)
      const d = await getDiff(repo.path, cmp.base, cmp.compare, cmp.mode)
      const known = new Set(d.files.map((f) => f.path))
      const dropped: string[] = []
      const sections = Array.isArray(args.sections)
        ? args.sections.map((s) => {
            if (!s || typeof s !== "object") return s
            const o = s as Record<string, unknown>
            const paths = Array.isArray(o.paths)
              ? o.paths.filter((p) => {
                  const keep = typeof p === "string" && known.has(p)
                  if (!keep && typeof p === "string") dropped.push(p)
                  return keep
                })
              : []
            return { ...o, paths }
          })
        : []
      const guide = await saveGuide(repo.id, {
        compareKey: compareKeyFor(cmp.mode, cmp.base, cmp.compare),
        title: args.title,
        summary: args.summary,
        sections,
        generatedBy: "mcp",
      })
      return {
        guide,
        ...(dropped.length
          ? { droppedPaths: dropped, note: "These paths are not in the diff and were removed" }
          : {}),
      }
    }
    default:
      throw new Error(`Unknown tool "${name}"`)
  }
}

// ── JSON-RPC plumbing ────────────────────────────────────────────────────────

type RpcRequest = {
  jsonrpc?: string
  id?: number | string | null
  method?: string
  params?: Record<string, unknown>
}

function rpcResult(id: RpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0", id: id ?? null, result }
}

function rpcError(id: RpcRequest["id"], code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin')
  const allowed = new Set([publicUrl().origin, 'http://127.0.0.1:3000', 'http://localhost:3000'])
  if (origin && !allowed.has(origin)) return NextResponse.json({ error: 'Forbidden origin' }, { status: 403 })
  const version = req.headers.get('mcp-protocol-version')
  if (version && !PROTOCOL_VERSIONS.includes(version)) return NextResponse.json(rpcError(null, -32600, 'Unsupported protocol version'), { status: 400 })
  if (!req.headers.get('content-type')?.includes('application/json')) return new NextResponse(null, { status: 415 })
  let rpc: RpcRequest
  try {
    rpc = (await req.json()) as RpcRequest
  } catch {
    return NextResponse.json(rpcError(null, -32700, "Parse error"), { status: 400 })
  }
  if (!rpc || Array.isArray(rpc) || rpc.jsonrpc !== '2.0' || typeof rpc.method !== 'string' || (rpc.id !== undefined && typeof rpc.id !== 'number' && typeof rpc.id !== 'string') || (rpc.params !== undefined && (!rpc.params || typeof rpc.params !== 'object' || Array.isArray(rpc.params)))) {
    return NextResponse.json(rpcError(null, -32600, 'Invalid Request'), { status: 400 })
  }
  const { id, method, params } = rpc

  // Notifications (no id) get an empty 202 per Streamable HTTP.
  if (id === undefined) {
    return new NextResponse(null, { status: 202 })
  }

  try {
    switch (method) {
      case "initialize": {
        const requested = params?.protocolVersion
        const protocolVersion =
          typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested)
            ? requested
            : PROTOCOL_VERSIONS[0]
        return NextResponse.json(
          rpcResult(id, {
            protocolVersion,
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS,
          }),
        )
      }
      case "ping":
        return NextResponse.json(rpcResult(id, {}))
      case "tools/list":
        return NextResponse.json(rpcResult(id, { tools: TOOLS.map(tool => ({ ...tool, annotations: { readOnlyHint: readOnlyTools.has(tool.name), destructiveHint: tool.name === "remove_repo" || tool.name === "submit_review_guide", idempotentHint: tool.name !== "add_comment", openWorldHint: false } })) }))
      case "tools/call": {
        const name = typeof params?.name === "string" ? params.name : ""
        const args =
          params?.arguments && typeof params.arguments === "object"
            ? (params.arguments as Args)
            : {}
        try {
          const validate = validators.get(name)
          if (!validate) throw new Error(`Unknown tool "${name}"`)
          if (!validate(params?.arguments ?? {})) throw new Error(`Invalid arguments: ${ajv.errorsText(validate.errors)}`)
          const result = await callTool(name, args)
          return NextResponse.json(
            rpcResult(id, {
              content: [{ type: "text", text: JSON.stringify(result, null, 1) }],
            }),
          )
        } catch (e) {
          // Tool failures are results with isError, not protocol errors.
          return NextResponse.json(
            rpcResult(id, {
              content: [
                { type: "text", text: e instanceof Error ? e.message : String(e) },
              ],
              isError: true,
            }),
          )
        }
      }
      default:
        return NextResponse.json(
          rpcError(id, -32601, `Method not found: ${method}`),
        )
    }
  } catch (e) {
    return NextResponse.json(
      rpcError(id, -32603, e instanceof Error ? e.message : "Internal error"),
    )
  }
}

// No server-initiated stream: GET is explicitly unsupported (spec-allowed).
export function GET(req: NextRequest) {
  const origin = req.headers.get("origin")
  if (origin && ![publicUrl().origin, "http://127.0.0.1:3000", "http://localhost:3000"].includes(origin)) return new NextResponse(null, { status: 403 })
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } })
}
