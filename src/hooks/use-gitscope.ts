"use client";

import useSWR from "swr";
import type { RepoSummary, RepoRefs, DiffResult, DiffMode } from "@/lib/types";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/** Registered repositories + add/remove mutations. Polls for live status. */
export function useRepos() {
  const { data, error, isLoading, mutate } = useSWR<RepoSummary[]>(
    "/api/repos",
    fetcher,
    { refreshInterval: 8000, revalidateOnFocus: true },
  );

  async function addRepo(input: { path: string; name?: string }) {
    const res = await fetch("/api/repos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const body = (await res.json().catch(() => null)) as
      | (RepoSummary & { error?: string })
      | { error?: string }
      | null;
    if (!res.ok) throw new Error((body as { error?: string })?.error || "Failed to add repository");
    await mutate();
    return body as RepoSummary;
  }

  async function removeRepo(id: string) {
    const res = await fetch(`/api/repos/${id}`, { method: "DELETE" });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || "Failed to remove repository");
    }
    await mutate();
  }

  return { repos: data ?? [], error, isLoading, mutate, addRepo, removeRepo };
}

/** Branches / tags / worktrees / commits for the ref pickers. */
export function useRefs(repoId: string | null) {
  const { data, error, isLoading, mutate } = useSWR<RepoRefs>(
    repoId ? `/api/repos/${repoId}/refs` : null,
    fetcher,
  );
  return { refs: data, error, isLoading, mutate };
}

/** Diff between two refs. Disabled until both refs are chosen. */
export function useDiff(
  repoId: string | null,
  base: string | null,
  compare: string | null,
  mode: DiffMode,
  ignoreWhitespace: boolean,
) {
  const key =
    repoId && base && compare
      ? `/api/repos/${repoId}/diff?base=${encodeURIComponent(base)}&compare=${encodeURIComponent(
          compare,
        )}&mode=${mode}${ignoreWhitespace ? "&whitespace=ignore" : ""}`
      : null;
  const { data, error, isLoading, mutate } = useSWR<DiffResult>(key, fetcher, {
    keepPreviousData: true,
  });
  return { diff: data, error, isLoading, mutate };
}
