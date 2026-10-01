"use client";

import { useCallback, useMemo } from "react";

import { useLocalStorage } from "./use-local-storage";

/**
 * Per-comparison "viewed" record: path → digest of the file's patch at the
 * moment it was marked viewed. A file whose diff has since changed no longer
 * matches its stored digest and reads as unviewed again (GitHub semantics).
 */
type ViewedRecord = Record<string, string>;
type ViewedStore = Record<string, ViewedRecord>;

export type ViewedController = {
  /** True when the path is marked viewed for its CURRENT digest. */
  isViewed: (path: string) => boolean;
  /** Toggle a path; marking viewed stores the current digest. */
  toggle: (path: string) => void;
  /** Count of currently-viewed paths among `paths`. */
  countIn: (paths: string[]) => number;
};

/**
 * GitHub-style reviewed-file tracking, persisted per repo in localStorage and
 * keyed by the exact comparison (mode + base + compare). Digest-checked so a
 * file edited after being marked viewed automatically resets.
 */
export function useViewedFiles(
  repoId: string | null | undefined,
  base: string,
  compare: string,
  mode: string,
  digestByPath: Map<string, string>,
): ViewedController {
  const [store, setStore] = useLocalStorage<ViewedStore>(
    `gitscope.viewed.${repoId ?? "none"}`,
    {},
  );
  const compareKey = `${mode}:${base}...${compare}`;
  const record = useMemo(
    () => store[compareKey] ?? {},
    [store, compareKey],
  );

  const isViewed = useCallback(
    (path: string) => {
      const digest = digestByPath.get(path);
      return digest !== undefined && record[path] === digest;
    },
    [record, digestByPath],
  );

  const toggle = useCallback(
    (path: string) => {
      const digest = digestByPath.get(path);
      if (digest === undefined) return;
      setStore((prev) => {
        const cur = { ...(prev[compareKey] ?? {}) };
        if (cur[path] === digest) delete cur[path];
        else cur[path] = digest;
        return { ...prev, [compareKey]: cur };
      });
    },
    [compareKey, digestByPath, setStore],
  );

  const countIn = useCallback(
    (paths: string[]) => paths.reduce((n, p) => n + (isViewed(p) ? 1 : 0), 0),
    [isViewed],
  );

  return { isViewed, toggle, countIn };
}

/** Path-salted djb2-xor hash of one added line (checkpoint "new" detection). */
export function lineHash(path: string, content: string): string {
  const s = path + "\n" + content;
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/** Small stable digest (djb2-xor) of a parsed file's changed lines. */
export function digestChanges(lines: Iterable<string>): string {
  let h = 5381;
  for (const line of lines) {
    for (let i = 0; i < line.length; i++) {
      h = (((h << 5) + h) ^ line.charCodeAt(i)) >>> 0;
    }
    h = (((h << 5) + h) ^ 10) >>> 0; // '\n' separator
  }
  return h.toString(36);
}
