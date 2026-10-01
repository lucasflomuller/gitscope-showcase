"use client"

import useSWR from "swr"

import type { PullsResponse } from "@/lib/types"

/**
 * GET fetcher. PRs are read with GET (not the POST used by symbols/references):
 * the request is idempotent, has no body, and is naturally cacheable — exactly
 * what SWR's url-keyed cache wants. A non-200 throws so SWR keeps the previous
 * (empty) data; with `shouldRetryOnError:false` a non-GitHub repo won't hammer.
 */
async function fetcher(url: string): Promise<PullsResponse> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<PullsResponse>
}

/**
 * Branch → primary GitHub PR map for a repo, fetched INDEPENDENTLY of `useRefs`
 * so the picker (and the whole diff) render before PR data resolves — the badges
 * just pop in, with no layout shift. The key is null (no request) until a repo is
 * selected. Failures resolve to an empty map, so the UI degrades to "no badge".
 *
 * The response field `prs` is exposed as `prByBranch` — the name the render sites
 * (ref-picker rows, dashboard card) look up by branch name.
 */
export function usePullRequests(repoId: string | null) {
  const { data } = useSWR<PullsResponse>(
    repoId ? `/api/repos/${repoId}/prs` : null,
    fetcher,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
      keepPreviousData: true,
      // Matches the 60s server TTL; cheap because the server cache + in-flight
      // coalescing bound this to at most one `gh` spawn per repo per minute.
      refreshInterval: 60_000,
    },
  )

  return {
    prByBranch: data?.prs ?? {},
    available: data?.available ?? false,
    repo: data?.repo,
  }
}
