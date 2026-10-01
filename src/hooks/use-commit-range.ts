"use client";

import useSWR from "swr";
import type { CommitInfo } from "@/lib/types";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Commits in base..compare (newest-first), for the review-by-commit stepper. */
export function useCommitRange(
  repoId: string | null,
  base: string | null,
  compare: string | null,
  enabled: boolean,
) {
  const key =
    enabled && repoId && base && compare
      ? `/api/repos/${repoId}/commits?base=${encodeURIComponent(base)}&compare=${encodeURIComponent(
          compare,
        )}`
      : null;
  const { data, error, isLoading } = useSWR<CommitInfo[]>(key, fetcher, {
    keepPreviousData: true,
  });
  return { commits: data ?? [], isLoading, error };
}
