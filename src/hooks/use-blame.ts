"use client"

import useSWR from "swr"

import type { BlameLine, BlameResponse } from "@/lib/types"

/** GET fetcher for the porcelain blame of one file at a ref. */
async function fetchBlame(url: string): Promise<BlameResponse> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<BlameResponse>
}

/**
 * Lazy per-line blame for the SELECTED file only. Keyed on (repo, ref, path);
 * the key is null (no request) until `enabled` and all three are present, so
 * nothing is fetched until the blame gutter is toggled on. Failures swallow to
 * `[]` so the diff renders unchanged. Index i = source line i+1 (dense, gaps
 * possible — callers must guard by index).
 */
export function useBlame(
  repoId: string | null,
  ref: string | null,
  path: string | null,
  enabled: boolean,
): { blame: BlameLine[]; isLoading: boolean } {
  const key =
    enabled && repoId && ref && path
      ? `/api/repos/${repoId}/blame?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`
      : null

  const { data, isLoading } = useSWR(key, fetchBlame, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    keepPreviousData: false,
  })

  return {
    blame: data?.lines ?? [],
    isLoading: Boolean(key) && isLoading,
  }
}
