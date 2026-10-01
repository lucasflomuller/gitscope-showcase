import type { DiffMode, RefInfo, RepoRefs } from "./types";

/**
 * A persisted comparison selection (base + compare + mode), stored per repo in
 * localStorage so returning to a repo — or reloading — restores exactly what
 * you were looking at. Pure client-side convenience; never sent to the server.
 */
export interface StoredComparison {
  base: RefInfo;
  compare: RefInfo;
  mode: DiffMode;
}

/** repoId → its current comparison + a short history of previous ones. */
export type ComparisonStore = Record<
  string,
  { current: StoredComparison; recent: StoredComparison[] }
>;

export function sameRefInfo(a: RefInfo, b: RefInfo): boolean {
  return a.kind === b.kind && a.ref === b.ref;
}

export function sameComparison(a: StoredComparison, b: StoredComparison): boolean {
  return (
    sameRefInfo(a.base, b.base) &&
    sameRefInfo(a.compare, b.compare) &&
    a.mode === b.mode
  );
}

/**
 * Whether a stored ref is still selectable against the freshly-fetched refs —
 * guards restore against branches/tags deleted since the selection was saved.
 */
export function refStillExists(refs: RepoRefs, r: RefInfo): boolean {
  switch (r.kind) {
    case "working":
    case "staged":
    case "head":
      return true;
    case "branch":
      return refs.branches.some((b) => b.name === r.ref);
    case "remote":
      return refs.remotes.some((b) => b.name === r.ref);
    case "tag":
      return refs.tags.some((t) => t.name === r.ref);
    case "worktree":
      return refs.worktrees.some(
        (w) => (w.branch ? w.branchLabel : w.head) === r.ref,
      );
    case "commit":
      // A sha stays diffable even after it leaves the "recent commits" list.
      return true;
  }
}
