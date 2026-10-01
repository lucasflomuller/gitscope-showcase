"use client";

import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

import type { PreflightAllowlist, PreflightFinding } from "@/lib/types";

export interface PreflightController {
  ignoredIds: Set<string>;
  ignoredRuleIds: Set<string>;
  /** Suppress a single finding (optimistic + persisted). */
  ignore: (finding: PreflightFinding) => void;
  /** Reverse a per-finding ignore. */
  unignore: (finding: PreflightFinding) => void;
  /** Suppress the whole rule for this repo. */
  ignoreRule: (finding: PreflightFinding) => void;
  /** Reverse a per-rule ignore. */
  unignoreRule: (finding: PreflightFinding) => void;
  /** True when a finding is currently suppressed (by id or by rule). */
  isIgnored: (finding: PreflightFinding) => boolean;
}

/**
 * Holds the per-repo pre-flight allowlist, seeded from the snapshot that rides
 * along in the diff payload and mutated optimistically. Each toggle updates the
 * local sets instantly and persists to the allowlist API; failures revert.
 *
 * Seeding is done during render (the React-recommended "reset state when a prop
 * changes" pattern) keyed by the snapshot's CONTENT: purely local optimistic
 * edits leave the snapshot unchanged, so they are never clobbered, while a fresh
 * snapshot (repo switch, or a persisted change picked up on revalidation) does
 * re-seed — keeping the displayed findings + allowlist consistent.
 */
export function usePreflightAllowlist(
  repoId: string | null,
  seed: PreflightAllowlist | undefined,
): PreflightController {
  const [ignoredIds, setIgnoredIds] = useState<Set<string>>(new Set());
  const [ignoredRuleIds, setIgnoredRuleIds] = useState<Set<string>>(new Set());

  // Re-seed when the snapshot's content (or the repo) changes.
  const seedKey = `${repoId ?? ""}::${seed?.ignoredIds.join(",") ?? ""}::${
    seed?.ignoredRuleIds.join(",") ?? ""
  }`;
  const [seededKey, setSeededKey] = useState<string | null>(null);
  if (seedKey !== seededKey) {
    setSeededKey(seedKey);
    setIgnoredIds(new Set(seed?.ignoredIds ?? []));
    setIgnoredRuleIds(new Set(seed?.ignoredRuleIds ?? []));
  }

  const persist = useCallback(
    async (
      method: "POST" | "DELETE",
      body: { id?: string; ruleId?: string },
      revert: () => void,
    ) => {
      if (!repoId) return;
      try {
        const res = await fetch(`/api/repos/${repoId}/preflight/allowlist`, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(`Request failed (${res.status})`);
      } catch {
        revert();
        toast.error("Couldn't update the allowlist");
      }
    },
    [repoId],
  );

  const unignore = useCallback(
    (finding: PreflightFinding) => {
      setIgnoredIds((prev) => {
        const next = new Set(prev);
        next.delete(finding.id);
        return next;
      });
      persist("DELETE", { id: finding.id }, () =>
        setIgnoredIds((prev) => new Set(prev).add(finding.id)),
      );
    },
    [persist],
  );

  const ignore = useCallback(
    (finding: PreflightFinding) => {
      setIgnoredIds((prev) => new Set(prev).add(finding.id));
      persist("POST", { id: finding.id }, () =>
        setIgnoredIds((prev) => {
          const next = new Set(prev);
          next.delete(finding.id);
          return next;
        }),
      );
      toast.success(`Ignored "${finding.title}"`, {
        action: { label: "Undo", onClick: () => unignore(finding) },
      });
    },
    [persist, unignore],
  );

  const unignoreRule = useCallback(
    (finding: PreflightFinding) => {
      setIgnoredRuleIds((prev) => {
        const next = new Set(prev);
        next.delete(finding.ruleId);
        return next;
      });
      persist("DELETE", { ruleId: finding.ruleId }, () =>
        setIgnoredRuleIds((prev) => new Set(prev).add(finding.ruleId)),
      );
    },
    [persist],
  );

  const ignoreRule = useCallback(
    (finding: PreflightFinding) => {
      setIgnoredRuleIds((prev) => new Set(prev).add(finding.ruleId));
      persist("POST", { ruleId: finding.ruleId }, () =>
        setIgnoredRuleIds((prev) => {
          const next = new Set(prev);
          next.delete(finding.ruleId);
          return next;
        }),
      );
      toast.success(`Ignoring "${finding.title}" in this repo`, {
        action: { label: "Undo", onClick: () => unignoreRule(finding) },
      });
    },
    [persist, unignoreRule],
  );

  const isIgnored = useCallback(
    (finding: PreflightFinding) =>
      ignoredRuleIds.has(finding.ruleId) || ignoredIds.has(finding.id),
    [ignoredIds, ignoredRuleIds],
  );

  return useMemo(
    () => ({
      ignoredIds,
      ignoredRuleIds,
      ignore,
      unignore,
      ignoreRule,
      unignoreRule,
      isIgnored,
    }),
    [ignoredIds, ignoredRuleIds, ignore, unignore, ignoreRule, unignoreRule, isIgnored],
  );
}
