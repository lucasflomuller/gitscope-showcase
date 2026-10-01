"use client";

import { useCallback, useMemo } from "react";

import { useLocalStorage } from "./use-local-storage";

/**
 * Per-comparison checkpoint: the content-hash set of every ADDED line at the
 * moment the reviewer snapshotted the diff. Added lines whose hash is absent
 * from the snapshot read as "new since checkpoint".
 */
type CheckpointSnapshot = { at: string; hashes: string[] };
type CheckpointStore = Record<string, CheckpointSnapshot>;

export type CheckpointController = {
  /** ISO timestamp of the active checkpoint, or null when none exists. */
  at: string | null;
  hasCheckpoint: boolean;
  /** Snapshot the current diff's added-line hashes as the reviewed baseline. */
  record: () => void;
  /** Drop the checkpoint for this comparison. */
  clear: () => void;
  /** True when a checkpoint exists and the hash wasn't in it. */
  isNew: (hash: string) => boolean;
  /** Count of new-since-checkpoint added lines in one file. */
  newCountFor: (path: string) => number;
  /** Total new-since-checkpoint added lines across the diff. */
  totalNew: number;
};

/**
 * Review-checkpoint tracking, persisted per repo in localStorage and keyed by
 * the exact comparison (mode + base + compare) — same keying as useViewedFiles.
 * No checkpoint → isNew is always false (no markers until the first snapshot).
 */
export function useCheckpoint(
  repoId: string | null | undefined,
  base: string,
  compare: string,
  mode: string,
  addedHashes: { all: string[]; byPath: Map<string, string[]> },
): CheckpointController {
  const [store, setStore] = useLocalStorage<CheckpointStore>(
    `gitscope.checkpoints.${repoId ?? "none"}`,
    {},
  );
  const compareKey = `${mode}:${base}...${compare}`;
  const snap = store[compareKey];
  const set = useMemo(() => new Set(snap?.hashes ?? []), [snap]);

  const isNew = useCallback(
    (hash: string) => snap != null && !set.has(hash),
    [snap, set],
  );

  const record = useCallback(() => {
    setStore((prev) => ({
      ...prev,
      [compareKey]: { at: new Date().toISOString(), hashes: addedHashes.all },
    }));
  }, [setStore, compareKey, addedHashes]);

  const clear = useCallback(() => {
    setStore((prev) => {
      const next = { ...prev };
      delete next[compareKey];
      return next;
    });
  }, [setStore, compareKey]);

  const newCountFor = useCallback(
    (path: string) =>
      snap == null
        ? 0
        : (addedHashes.byPath.get(path) ?? []).filter((h) => !set.has(h)).length,
    [snap, set, addedHashes],
  );

  const totalNew = useMemo(() => {
    if (snap == null) return 0;
    let n = 0;
    for (const hashes of addedHashes.byPath.values()) {
      for (const h of hashes) if (!set.has(h)) n++;
    }
    return n;
  }, [snap, set, addedHashes]);

  return useMemo(
    () => ({
      at: snap?.at ?? null,
      hasCheckpoint: snap != null,
      record,
      clear,
      isNew,
      newCountFor,
      totalNew,
    }),
    [snap, record, clear, isNew, newCountFor, totalNew],
  );
}
