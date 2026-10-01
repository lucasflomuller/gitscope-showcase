import type { RefHit } from "@/lib/types"

/**
 * Pure helpers turning a flat reference hit list into the panel's two groups:
 * hits that fall inside a file the diff touched ("In this diff") vs hits in
 * files the diff never shows ("Not updated in this diff"). The second group is
 * the marquee insight — references you may have forgotten to update outside the
 * changeset. Dependency-free and client-safe (no server imports).
 */

/** A reference hit list split by whether its file is part of the diff. */
export interface PartitionedRefs {
  /** Hits whose path is one of the diff's changed files (jumpable). */
  inDiff: RefHit[]
  /** Hits whose path is NOT in the diff — the "did you forget them?" group. */
  notInDiff: RefHit[]
}

/**
 * Split `hits` by membership in `changedPaths`. A hit is "in diff" iff its
 * `path` is a changed file. `changedPaths` should already include both the
 * new-side `path` and any rename `oldPath` (see DiffViewer). Order within each
 * group is preserved from the (already path/line-sorted) input.
 */
export function partitionRefs(
  hits: RefHit[],
  changedPaths: Set<string>,
): PartitionedRefs {
  const inDiff: RefHit[] = []
  const notInDiff: RefHit[] = []
  for (const hit of hits) {
    if (changedPaths.has(hit.path)) inDiff.push(hit)
    else notInDiff.push(hit)
  }
  return { inDiff, notInDiff }
}

/** The file name (last path segment), e.g. "diff-viewer.tsx". */
export function basename(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? path : path.slice(slash + 1)
}

/** The directory portion with a trailing slash, e.g. "src/components/diff/". */
export function dirname(path: string): string {
  const slash = path.lastIndexOf("/")
  return slash === -1 ? "" : path.slice(0, slash + 1)
}
