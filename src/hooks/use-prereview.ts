"use client"

import { useCallback, useRef, useState } from "react"

import type { DiffMode } from "@/lib/types"

/** The comparison to pre-review — the same triple the diff/comment APIs take. */
interface PrereviewCmp {
  base: string
  compare: string
  mode: DiffMode
}

/**
 * POST the comparison to the pre-review route and return the count of notes it
 * filed. Errors carry the server's user-facing message (e.g. the friendly
 * "is the claude CLI installed?") so the caller can surface it verbatim.
 */
async function postPrereview(
  repoId: string,
  cmp: PrereviewCmp,
): Promise<number> {
  const res = await fetch(`/api/repos/${repoId}/prereview`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(cmp),
  })
  if (!res.ok) {
    let message = "Pre-review failed"
    try {
      const data = (await res.json()) as { error?: unknown }
      if (typeof data.error === "string" && data.error) message = data.error
    } catch {
      /* non-JSON error body → keep the default message */
    }
    throw new Error(message)
  }
  const data = (await res.json()) as { filed?: unknown }
  return typeof data.filed === "number" ? data.filed : 0
}

/**
 * Imperative controller for the "AI pre-review" button. `run(cmp)` kicks off one
 * pass and resolves with how many notes were filed; `running` drives the button's
 * busy state. Re-entrant calls while a pass is in flight return the same promise
 * (one pass at a time — the CLI call is slow and side-effectful).
 */
export function usePrereview(repoId: string | null): {
  run: (cmp: PrereviewCmp) => Promise<number>
  running: boolean
} {
  const [running, setRunning] = useState(false)
  const inFlight = useRef<Promise<number> | null>(null)

  const run = useCallback(
    (cmp: PrereviewCmp): Promise<number> => {
      if (!repoId) throw new Error("No repository selected")
      if (inFlight.current) return inFlight.current

      setRunning(true)
      const promise = postPrereview(repoId, cmp).finally(() => {
        inFlight.current = null
        setRunning(false)
      })
      inFlight.current = promise
      return promise
    },
    [repoId],
  )

  return { run, running }
}
