"use client";

import { useCallback, useState } from "react";
import useSWR from "swr";

import type { GuideResponse, ReviewGuide } from "@/lib/types";

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `Request failed (${res.status})`);
  }
  return res.json() as Promise<T>;
}

export interface GuideController {
  guide: ReviewGuide | null;
  isLoading: boolean;
  /** True while the local claude CLI is generating a guide. */
  generating: boolean;
  /**
   * The last generation failure, kept until the next attempt — generation runs
   * for minutes, so a transient toast alone is easy to miss.
   */
  error: string | null;
  /** One-click generation via the local claude CLI (throws with a friendly message). */
  generate: () => Promise<void>;
  /** Discard the stored guide for this comparison. */
  discard: () => Promise<void>;
}

/**
 * The review guide for the current comparison. Polls lightly so a guide an
 * agent submits over MCP pops into the UI within a few seconds — that live
 * hand-off is the point of the feature.
 */
export function useGuide(
  repoId: string | null | undefined,
  base: string,
  compare: string,
  mode: string,
): GuideController {
  const key =
    repoId && base && compare
      ? `/api/repos/${repoId}/guide?base=${encodeURIComponent(base)}&compare=${encodeURIComponent(compare)}&mode=${encodeURIComponent(mode)}`
      : null;
  const { data, isLoading, mutate } = useSWR<GuideResponse>(key, fetcher, {
    refreshInterval: 5000,
    revalidateOnFocus: true,
  });
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    if (!repoId || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/repos/${repoId}/guide/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base, compare, mode }),
      });
      const body = (await res.json().catch(() => null)) as
        | (GuideResponse & { error?: string })
        | null;
      if (!res.ok) {
        throw new Error(body?.error || "Guide generation failed");
      }
      await mutate();
    } catch (e) {
      // Keep the failure visible in the panel — generation runs for minutes
      // and a toast alone is easy to miss.
      setError(e instanceof Error ? e.message : "Guide generation failed");
      throw e;
    } finally {
      setGenerating(false);
    }
  }, [repoId, base, compare, mode, generating, mutate]);

  const discard = useCallback(async () => {
    if (!repoId) return;
    const res = await fetch(
      `/api/repos/${repoId}/guide?base=${encodeURIComponent(base)}&compare=${encodeURIComponent(compare)}&mode=${encodeURIComponent(mode)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || "Couldn't discard the guide");
    }
    await mutate();
  }, [repoId, base, compare, mode, mutate]);

  return {
    guide: data?.guide ?? null,
    isLoading,
    generating,
    error,
    generate,
    discard,
  };
}
