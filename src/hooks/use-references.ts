"use client"

import { useCallback, useMemo, useState } from "react"
import useSWR from "swr"

import type { RefHit, ReferencesResponse } from "@/lib/types"

/** POST fetcher: the SWR key is [url, ref, name]. */
async function fetchReferences([url, ref, name]: readonly [
  string,
  string,
  string,
]): Promise<ReferencesResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, name }),
  })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<ReferencesResponse>
}

/**
 * On-demand "blast radius" controller. Unlike the symbol outline (keyed by the
 * selected file), this is keyed by the symbol NAME the user clicked: `find(name)`
 * sets the active name and opens the panel, which triggers the lazy POST. The
 * request key is null (no fetch) until repo + ref + an active name are all
 * present; failures are swallowed so the diff renders unchanged.
 */
export interface ReferencesController {
  /** The symbol currently being searched, or null. */
  activeName: string | null
  /** Whether the references panel is open. */
  open: boolean
  setOpen: (v: boolean) => void
  /** Search references to `name` and open the panel. */
  find: (name: string) => void
  /** Filtered hits (empty while loading / on failure). */
  hits: RefHit[]
  /** Total hit count after filtering (≥ hits.length when capped). */
  total: number
  /** True when the list was capped to the server's MAX_HITS. */
  capped: boolean
  isLoading: boolean
  error: boolean
}

export function useReferences(
  repoId: string | null,
  ref: string | null,
): ReferencesController {
  const [activeName, setActiveName] = useState<string | null>(null)
  const [open, setOpen] = useState(false)

  // Stable SWR key (memoized so it doesn't re-key the final controller memo on
  // every render): null — and therefore no request — until all three are set.
  const key = useMemo(
    () =>
      repoId && ref && activeName
        ? ([`/api/repos/${repoId}/references`, ref, activeName] as const)
        : null,
    [repoId, ref, activeName],
  )

  const { data, error, isLoading } = useSWR(key, fetchReferences, {
    revalidateOnFocus: false,
    keepPreviousData: false,
    shouldRetryOnError: false,
  })

  const find = useCallback((name: string) => {
    setActiveName(name)
    setOpen(true)
  }, [])

  return useMemo(
    () => ({
      activeName,
      open,
      setOpen,
      find,
      hits: data?.references ?? [],
      total: data?.total ?? 0,
      capped: data?.capped ?? false,
      isLoading: Boolean(key) && isLoading,
      error: Boolean(error),
    }),
    [activeName, open, find, data, key, isLoading, error],
  )
}
