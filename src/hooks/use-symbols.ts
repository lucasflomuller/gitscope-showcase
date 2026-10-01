"use client"

import useSWR from "swr"

import type { SymbolNode, SymbolsResponse } from "@/lib/types"

/** POST fetcher: the SWR key is [url, ref, path]. */
async function fetchSymbols([url, ref, path]: readonly [
  string,
  string,
  string,
]): Promise<SymbolsResponse> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref, path }),
  })
  if (!res.ok) throw new Error(`Request failed (${res.status})`)
  return res.json() as Promise<SymbolsResponse>
}

/**
 * Lazy, ref-correct symbol outline for the SELECTED file only. Keyed on
 * (repo, compare-ref, path); the key is null (no request) until all three are
 * present. Failures are swallowed to `[]` so the diff renders unchanged.
 */
export function useSymbols(
  repoId: string | null,
  ref: string | null,
  path: string | null,
): { symbols: SymbolNode[]; lang: string | null; isLoading: boolean } {
  const key =
    repoId && ref && path
      ? ([`/api/repos/${repoId}/symbols`, ref, path] as const)
      : null

  const { data, isLoading } = useSWR(key, fetchSymbols, {
    revalidateOnFocus: false,
    keepPreviousData: false,
    shouldRetryOnError: false,
  })

  return {
    symbols: data?.symbols ?? [],
    lang: data?.lang ?? null,
    isLoading: Boolean(key) && isLoading,
  }
}
