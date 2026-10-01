import type { DiffMode, RefInfo, RefKind, RepoRefs } from "./types";

/**
 * URL <-> selection-state codec for shareable GitScope views. Pure functions
 * only — no window/React — so both the reconcile and write paths in page.tsx
 * share one canonical serialization (stable param order → stable equality).
 */

/** The lossy on-the-wire form of a RefInfo (no label/subtitle). */
export interface RefRef {
  kind: RefKind;
  ref: string;
}

export interface UrlState {
  repo: string | null;
  base: RefRef | null;
  compare: RefRef | null;
  mode: DiffMode | null;
  file: string | null;
}

/** Must stay in sync with the RefKind union in ./types. */
const REF_KINDS: readonly RefKind[] = [
  "branch",
  "remote",
  "tag",
  "commit",
  "worktree",
  "working",
  "staged",
  "head",
];

export function serializeRef(r: RefInfo | RefRef): string {
  // No pre-encoding — URLSearchParams encodes the whole value.
  return `${r.kind}:${r.ref}`;
}

export function parseRef(s: string | null): RefRef | null {
  if (!s) return null;
  const i = s.indexOf(":");
  if (i < 0) return null;
  const kind = s.slice(0, i) as RefKind;
  const ref = s.slice(i + 1);
  if (!REF_KINDS.includes(kind) || !ref) return null;
  return { kind, ref };
}

export function parseUrl(search: string): UrlState {
  const sp = new URLSearchParams(search);
  const mode = sp.get("mode");
  return {
    repo: sp.get("repo") || null,
    base: parseRef(sp.get("base")),
    compare: parseRef(sp.get("compare")),
    mode: mode === "direct" ? "direct" : mode === "merge-base" ? "merge-base" : null,
    file: sp.get("file") || null,
  };
}

export function serializeUrl(s: UrlState): string {
  // Fixed insertion order (repo, base, compare, mode, file) keeps the output
  // byte-identical for equal states, so string comparison works as equality.
  const sp = new URLSearchParams();
  if (s.repo) sp.set("repo", s.repo);
  if (s.base) sp.set("base", serializeRef(s.base));
  if (s.compare) sp.set("compare", serializeRef(s.compare));
  if (s.mode) sp.set("mode", s.mode);
  if (s.file) sp.set("file", s.file);
  const out = sp.toString();
  return out ? `?${out}` : "";
}

/**
 * Rebuild a full RefInfo (label/subtitle) from its on-the-wire form using the
 * fetched refs. Mirrors branchRef() in page.tsx — keep the shapes consistent.
 * Every not-found case falls back to {kind, ref, label: ref}; the diff API
 * tolerates stale refs and errors gracefully downstream.
 */
export function resolveRefInfo(refs: RepoRefs | undefined, rr: RefRef): RefInfo {
  switch (rr.kind) {
    case "working":
      return { kind: "working", ref: "WORKING", label: "Working tree" };
    case "staged":
      return { kind: "staged", ref: rr.ref, label: "Staged (index)" };
    case "head":
      return { kind: "head", ref: "HEAD", label: "HEAD" };
    case "branch": {
      const b = refs?.branches.find((x) => x.name === rr.ref);
      if (b) return { kind: "branch", ref: b.name, label: b.name, subtitle: b.commit };
      break;
    }
    case "remote": {
      const b = refs?.remotes.find((x) => x.name === rr.ref);
      if (b) return { kind: "remote", ref: b.name, label: b.name, subtitle: b.commit };
      break;
    }
    case "tag": {
      const t = refs?.tags.find((x) => x.name === rr.ref);
      if (t) return { kind: "tag", ref: t.name, label: t.name, subtitle: t.commit };
      break;
    }
    case "worktree": {
      const w = refs?.worktrees.find(
        (x) => (x.branch ? x.branchLabel : x.head) === rr.ref,
      );
      if (w) return { kind: "worktree", ref: rr.ref, label: w.branchLabel };
      break;
    }
    case "commit":
      return { kind: "commit", ref: rr.ref, label: rr.ref.slice(0, 7) };
  }
  return { kind: rr.kind, ref: rr.ref, label: rr.ref };
}
