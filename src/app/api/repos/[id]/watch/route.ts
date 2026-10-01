import { watch, type FSWatcher } from "node:fs"
import { NextResponse, type NextRequest } from "next/server"

import { getRepo } from "@/lib/config"

export const dynamic = "force-dynamic"
// node:fs.watch needs the Node runtime (not edge); make that explicit since the
// whole point of this route is to watch the repo working tree on disk.
export const runtime = "nodejs"

/** After a qualifying fs event, wait this long for quiet before emitting. */
const DEBOUNCE_MS = 400
/** Comment heartbeat cadence so proxies keep the long-lived socket open. */
const HEARTBEAT_MS = 25_000

/**
 * Split a watcher filename into its path segments, tolerating either separator
 * and a leading "./". `fs.watch(recursive)` yields paths relative to the repo.
 */
function segments(filename: string): string[] {
  return filename.split(/[\\/]+/).filter((s) => s.length > 0)
}

/**
 * Decide whether an fs event should trigger a diff refresh.
 *
 * We watch the whole working tree recursively, so we filter down to the things
 * that actually change what a working/staged diff shows:
 *  - inside `.git`, only `.git/index` matters (staging via `git add` rewrites
 *    it); all other git internals (HEAD, refs, logs, lockfiles) are ignored.
 *  - build/dependency output (node_modules, .next, dist, build) is noise.
 *  - editor cruft (.DS_Store) is noise.
 */
function isQualifying(filename: string | null): boolean {
  if (!filename) return false
  const parts = segments(filename)
  if (parts.length === 0) return false

  const first = parts[0]
  const last = parts[parts.length - 1]

  if (last === ".DS_Store") return false

  if (first === ".git") {
    // Everything under .git is ignored EXCEPT exactly ".git/index".
    return parts.length === 2 && parts[1] === "index"
  }

  if (
    first === "node_modules" ||
    first === ".next" ||
    first === "dist" ||
    first === "build"
  ) {
    return false
  }

  return true
}

/**
 * GET /api/repos/[id]/watch — Server-Sent Events stream that emits
 * `{"type":"changed","at":<ms>}` (debounced) whenever the repo working tree or
 * index changes, plus `: ping` heartbeats. Emits a single `{"type":"unavailable"}`
 * and closes if the filesystem watcher can't be established (the client then
 * simply stops live-updating). The connection is torn down on request abort.
 */
export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params
  const repo = await getRepo(id)
  if (!repo) {
    return NextResponse.json({ error: "Repo not found" }, { status: 404 })
  }

  const encoder = new TextEncoder()

  // Shared teardown state, reachable from both `start` and `cancel`.
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null
  let watcher: FSWatcher | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let heartbeat: ReturnType<typeof setInterval> | null = null
  let closed = false

  const send = (chunk: string) => {
    if (closed || !controller) return
    try {
      controller.enqueue(encoder.encode(chunk))
    } catch {
      // The client vanished mid-write; cleanup (via abort/cancel) will close.
    }
  }

  const cleanup = () => {
    if (closed) return
    closed = true
    if (debounce) clearTimeout(debounce)
    if (heartbeat) clearInterval(heartbeat)
    watcher?.close()
    req.signal.removeEventListener("abort", cleanup)
    try {
      controller?.close()
    } catch {
      // Already closed — fine.
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl

      req.signal.addEventListener("abort", cleanup)
      // The client may have already disconnected before we got here.
      if (req.signal.aborted) {
        cleanup()
        return
      }

      try {
        // Recursive watch is supported on Linux for Node 20+.
        watcher = watch(repo.path, { recursive: true }, (_event, filename) => {
          if (closed) return
          // With `{ recursive: true }` (no encoding) Node types this as string | null.
          if (!isQualifying(filename)) return
          // Coalesce a burst of events into one message per quiet period.
          if (debounce) clearTimeout(debounce)
          debounce = setTimeout(() => {
            debounce = null
            send(`data: ${JSON.stringify({ type: "changed", at: Date.now() })}\n\n`)
          }, DEBOUNCE_MS)
        })
      } catch {
        send(`data: ${JSON.stringify({ type: "unavailable" })}\n\n`)
        cleanup()
        return
      }

      // A runtime watcher error (e.g. inotify limit) is also "unavailable".
      watcher.on("error", () => {
        send(`data: ${JSON.stringify({ type: "unavailable" })}\n\n`)
        cleanup()
      })

      heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS)

      // Prime the stream so headers flush and EventSource fires `onopen`.
      send(`: connected\n\n`)
    },
    cancel() {
      // Reader cancelled (client went away) — teardown is idempotent.
      cleanup()
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
    },
  })
}
