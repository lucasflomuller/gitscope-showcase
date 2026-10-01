"use client"

import { useMemo } from "react"
import useSWR from "swr"

import type { BlobResponse } from "@/lib/types"

/** GET fetcher: the SWR key is [url, ref, path] (url already encodes both). */
async function fetchBlob([url]: readonly [string, string, string]): Promise<BlobResponse> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<BlobResponse>
}

/**
 * Lazy compare-side blob content for context expansion. Keyed on
 * (repo, ref, path); the key is null (no request) until `enabled` and all three
 * are present. `lines[k - 1]` is the file's line k, without any diff marker.
 */
export function useBlob(
  repoId: string | null,
  ref: string | null,
  path: string | null,
  enabled: boolean,
): {
  lines: string[]
  truncated: boolean
  isLoading: boolean
  error: boolean
  /** True once content has actually arrived (lines is meaningful). */
  loaded: boolean
} {
  const key =
    enabled && repoId && ref && path
      ? ([
          `/api/repos/${repoId}/blob?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(path)}`,
          ref,
          path,
        ] as const)
      : null

  const { data, isLoading, error } = useSWR(key, fetchBlob, {
    revalidateOnFocus: false,
    keepPreviousData: false,
    shouldRetryOnError: false,
  })

  const content = data?.content
  const lines = useMemo(() => (content ?? "").split("\n"), [content])

  return {
    lines,
    truncated: Boolean(data?.truncated),
    isLoading: Boolean(key) && isLoading,
    error: Boolean(error),
    loaded: data !== undefined,
  }
}
