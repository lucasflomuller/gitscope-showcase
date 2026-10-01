"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import parseDiff from "parse-diff";
import { toast } from "sonner";

import {
  anchorHashFor,
  buildResolver,
  buildWorklist,
  commentId,
  commentState,
  type ResolvedComment,
} from "@/components/diff/comment-meta";
import type { Comment, CommentState, DiffResult } from "@/lib/types";

export interface NewComment {
  path: string;
  startLine: number;
  endLine: number;
  body: string;
  /** Raw new-side diff line(s) (markers included) the note anchors to. */
  code: string[];
}

export interface CommentsController {
  /** Stored comments re-anchored to the current diff (+ orphaned flag). */
  comments: ResolvedComment[];
  /** Comment count per new-side path (drives the file-tree badges). */
  byPath: Map<string, number>;
  /** Total comment count. */
  count: number;
  /** Count of comments whose effective state is "open". */
  openCount: number;
  /** Absolute repo path, echoed into the copied worklist header. */
  repoPath: string | null;
  add: (input: NewComment) => void;
  update: (id: string, body: string) => void;
  /** Set a note's lifecycle state (+ optional agent note), optimistically. */
  setState: (id: string, state: CommentState, note?: string) => void;
  remove: (id: string) => void;
  clear: () => void;
  /** Re-fetch the persisted list for the current repo (e.g. after a pre-review). */
  refresh: () => void;
  /** Build the Markdown worklist, write it to the clipboard, toast the result. */
  copyForAI: () => void;
}

const EMPTY = new Map<string, number>();

/**
 * Per-repo review-comment controller, mirroring the pre-flight controller.
 * Comments are fetched once per repo, mutated optimistically (with revert on a
 * failed POST/PATCH/DELETE), and re-anchored against the current parsed diff so
 * they survive line shifts. `copyForAI` is the sole hand-off — clipboard only.
 */
export function useComments(
  repoId: string | null,
  result: DiffResult | undefined,
  repoPath: string | null,
): CommentsController {
  const [stored, setStored] = useState<Comment[]>([]);

  // Notes are scoped per branch server-side, keyed off the compare side; the
  // server resolves WORKING/STAGED to the current branch, so the client just
  // forwards whatever it's comparing against.
  const compare = result?.compare ?? null;

  // Clear stale comments the instant the repo OR the compared branch changes
  // (render-phase reset — the React-recommended "reset state when a prop
  // changes" pattern, as in the pre-flight controller) so the previous scope's
  // notes never flash on the new one.
  const scopeKey = `${repoId ?? ""}\u0000${compare ?? ""}`;
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  if (loadedFor !== scopeKey) {
    setLoadedFor(scopeKey);
    setStored([]);
  }

  // Fetch the persisted comment list for the current repo + branch. Extracted so
  // the mount effect and the exposed `refresh` share one implementation; a
  // monotonic request token stands in for the old cleanup flag so only the
  // latest fetch (repo/branch switch or refresh) wins, and setStored lives in
  // the async .then.
  const reqId = useRef(0);
  const load = useCallback(() => {
    if (!repoId || !compare) return;
    const token = ++reqId.current;
    fetch(
      `/api/repos/${repoId}/comments?compare=${encodeURIComponent(compare)}`,
    )
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("load failed"))))
      .then((data: unknown) => {
        if (token === reqId.current && Array.isArray(data)) {
          setStored(data as Comment[]);
        }
      })
      .catch(() => {
        /* leave the list empty on failure */
      });
  }, [repoId, compare]);

  useEffect(() => {
    load();
  }, [load]);

  const files = useMemo(() => parseDiff(result?.patch ?? ""), [result?.patch]);
  const resolver = useMemo(() => buildResolver(files), [files]);

  const comments = useMemo(
    () =>
      stored
        .map((c) => resolver.resolve(c))
        .sort(
          (a, b) =>
            a.path.localeCompare(b.path) ||
            a.startLine - b.startLine ||
            a.createdAt.localeCompare(b.createdAt),
        ),
    [stored, resolver],
  );

  const byPath = useMemo(() => {
    if (stored.length === 0) return EMPTY;
    const m = new Map<string, number>();
    for (const c of stored) m.set(c.path, (m.get(c.path) ?? 0) + 1);
    return m;
  }, [stored]);

  const openCount = useMemo(
    () => stored.reduce((n, c) => n + (commentState(c) === "open" ? 1 : 0), 0),
    [stored],
  );

  const add = useCallback(
    (input: NewComment) => {
      if (!repoId || !compare) return;
      const body = input.body.trim();
      if (!body) return;
      const comment: Comment = {
        id: commentId(),
        path: input.path,
        startLine: input.startLine,
        endLine: input.endLine,
        anchorHash: anchorHashFor(input.path, input.code),
        body,
        createdAt: new Date().toISOString(),
      };
      setStored((prev) => [...prev, comment]);
      fetch(`/api/repos/${repoId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `compare` rides along so the server can stamp the review scope; the
        // optimistic copy above deliberately has no `ref` (only the server can
        // resolve it), which is fine — it's replaced by the next load.
        body: JSON.stringify({ ...comment, compare }),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`Request failed (${r.status})`);
        })
        .catch(() => {
          setStored((prev) => prev.filter((c) => c.id !== comment.id));
          toast.error("Couldn't save the comment");
        });
    },
    [repoId, compare],
  );

  const update = useCallback(
    (id: string, body: string) => {
      if (!repoId) return;
      const trimmed = body.trim();
      if (!trimmed) return;
      let prevBody: string | undefined;
      setStored((prev) =>
        prev.map((c) => {
          if (c.id !== id) return c;
          prevBody = c.body;
          return { ...c, body: trimmed, updatedAt: new Date().toISOString() };
        }),
      );
      fetch(`/api/repos/${repoId}/comments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, body: trimmed }),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`Request failed (${r.status})`);
        })
        .catch(() => {
          setStored((prev) =>
            prev.map((c) =>
              c.id === id && prevBody !== undefined ? { ...c, body: prevBody } : c,
            ),
          );
          toast.error("Couldn't update the comment");
        });
    },
    [repoId],
  );

  const setState = useCallback(
    (id: string, state: CommentState, note?: string) => {
      if (!repoId) return;
      let prev: Comment | undefined;
      const at = new Date().toISOString();
      const trimmed = note?.trim();
      setStored((list) =>
        list.map((c) => {
          if (c.id !== id) return c;
          prev = c;
          const next: Comment = { ...c, state, updatedAt: at };
          if (trimmed) next.stateNote = trimmed;
          else delete next.stateNote;
          return next;
        }),
      );
      fetch(`/api/repos/${repoId}/comments`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, state, stateNote: note }),
      })
        .then((r) => {
          if (!r.ok) throw new Error(`Request failed (${r.status})`);
        })
        .catch(() => {
          if (prev) {
            const restored = prev;
            setStored((list) => list.map((c) => (c.id === id ? restored : c)));
          }
          toast.error("Couldn't update the note");
        });
    },
    [repoId],
  );

  const remove = useCallback(
    (id: string) => {
      if (!repoId) return;
      let removed: Comment | undefined;
      setStored((prev) => {
        removed = prev.find((c) => c.id === id);
        return prev.filter((c) => c.id !== id);
      });
      fetch(`/api/repos/${repoId}/comments?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
      })
        .then((r) => {
          if (!r.ok) throw new Error(`Request failed (${r.status})`);
        })
        .catch(() => {
          if (removed) {
            const restored = removed;
            setStored((prev) => [...prev, restored]);
          }
          toast.error("Couldn't delete the comment");
        });
    },
    [repoId],
  );

  const clear = useCallback(() => {
    if (!repoId || !compare) return;
    let prev: Comment[] = [];
    setStored((s) => {
      prev = s;
      return [];
    });
    // Scoped delete: clears this branch's notes, never another branch's.
    fetch(
      `/api/repos/${repoId}/comments?compare=${encodeURIComponent(compare)}`,
      { method: "DELETE" },
    )
      .then((r) => {
        if (!r.ok) throw new Error(`Request failed (${r.status})`);
        toast.success("Cleared all notes");
      })
      .catch(() => {
        setStored(prev);
        toast.error("Couldn't clear the notes");
      });
  }, [repoId, compare]);

  const copyForAI = useCallback(() => {
    // The worklist itself carries only open notes; guard + count on that subset.
    const open = comments.filter((c) => commentState(c) === "open");
    if (open.length === 0) {
      toast.error("No open notes to copy");
      return;
    }
    const md = buildWorklist(comments, {
      repoPath,
      base: result?.base ?? "base",
      compare: result?.compare ?? "compare",
    });
    navigator.clipboard
      .writeText(md)
      .then(() =>
        toast.success(
          `Copied ${open.length} note${open.length === 1 ? "" : "s"} for AI`,
        ),
      )
      .catch(() => toast.error("Couldn't copy to the clipboard"));
  }, [comments, repoPath, result?.base, result?.compare]);

  return useMemo(
    () => ({
      comments,
      byPath,
      count: stored.length,
      openCount,
      repoPath,
      add,
      update,
      setState,
      remove,
      clear,
      refresh: load,
      copyForAI,
    }),
    [
      comments,
      byPath,
      stored.length,
      openCount,
      repoPath,
      add,
      update,
      setState,
      remove,
      clear,
      load,
      copyForAI,
    ],
  );
}
