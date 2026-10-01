"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  LayoutDashboard,
  RefreshCw,
  FolderGit2,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
} from "lucide-react";

import { RepoSidebar } from "@/components/repo-sidebar";
import { CompareBar, CompareTrigger } from "@/components/compare-bar";
import { CommandPalette } from "@/components/command-palette";
import { ShortcutsHelp } from "@/components/shortcuts-help";
import { DiffViewer } from "@/components/diff/diff-viewer";
import {
  RepoDashboard,
  sortRepos,
  type DashboardSort,
  type DashboardView,
} from "@/components/dashboard/repo-dashboard";
import { AppMenu } from "@/components/app-menu";
import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useRepos, useRefs, useDiff } from "@/hooks/use-gitscope";
import { useCommitRange } from "@/hooks/use-commit-range";
import { usePullRequests } from "@/hooks/use-pulls";
import { useCompactUI } from "@/hooks/use-compact-ui";
import { useIsMac } from "@/hooks/use-is-mac";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { usePreflightAllowlist } from "@/hooks/use-preflight";
import { useComments } from "@/hooks/use-comments";
import { useLiveDiff } from "@/hooks/use-live-diff";
import { useUrlSearch } from "@/hooks/use-url-search";
import { cn } from "@/lib/utils";
import {
  refStillExists,
  sameComparison,
  sameRefInfo,
  type ComparisonStore,
  type StoredComparison,
} from "@/lib/comparison";
import { parseUrl, serializeUrl, resolveRefInfo, type RefRef } from "@/lib/url-state";
import type { BranchInfo, DiffMode, RefInfo, RepoRefs } from "@/lib/types";

// The last URL string the page wrote via history. Reconciling our own write
// back is a no-op by construction, so the render-phase reconcile absorbs it
// without touching state (a stale self-written URL must never revert a newer
// edit). Module-level (not a ref) because render may not read refs, and the
// page is a per-window singleton; written only from the state→URL effect.
let lastSelfWrittenUrl: string | null = null;

function branchRef(b: BranchInfo): RefInfo {
  return {
    kind: b.isRemote ? "remote" : "branch",
    ref: b.name,
    label: b.name,
    subtitle: b.commit,
  };
}

/** Sensible default comparison: a PR-style "feature vs main", else "working vs HEAD". */
function defaultRefs(refs: RepoRefs): { base: RefInfo | null; compare: RefInfo | null } {
  const cur = refs.currentBranch;
  const find = (n: string) => refs.branches.find((b) => b.name === n);
  const mainB = find("main") ?? find("master") ?? find("develop");
  const working: RefInfo = { kind: "working", ref: "WORKING", label: "Working tree" };
  const head: RefInfo = { kind: "head", ref: "HEAD", label: "HEAD" };

  if (cur && mainB && mainB.name !== cur) {
    return {
      base: branchRef(mainB),
      compare: { kind: "branch", ref: cur, label: cur },
    };
  }
  return { base: head, compare: working };
}

export default function Home() {
  const compact = useCompactUI();
  // Shortcut hints must name the key the user actually presses (the handler
  // accepts meta OR ctrl), same convention as the palette and the "?" dialog.
  // Here they sit in prose inside a `title` tooltip rather than in a <kbd> box,
  // so "Ctrl" carries its own "+" separator ("Ctrl+K"); "⌘K" is already read as
  // one chord.
  const mod = useIsMac() ? "⌘" : "Ctrl+";
  const { repos, isLoading: reposLoading, addRepo, removeRepo, mutate: mutateRepos } =
    useRepos();

  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Review Inbox: `inboxMode` marks an active triage session (entered via a
  // dashboard card's "Review changes"); `reviewIntent` is the repo id that
  // should force the HEAD → Working comparison once its refs load.
  const [inboxMode, setInboxMode] = useState(false);
  const [reviewIntent, setReviewIntent] = useState<string | null>(null);

  // Single entry point for selecting a repo (or the dashboard). `review: true`
  // starts a triage session that forces HEAD → Working for that repo.
  const selectRepo = useCallback(
    (id: string | null, opts?: { review?: boolean }) => {
      setSelectedId(id);
      setInboxMode(Boolean(id && opts?.review));
      setReviewIntent(id && opts?.review ? id : null);
    },
    [],
  );

  const [sidebarCollapsed, setSidebarCollapsed] = useLocalStorage(
    "gitscope.sidebarCollapsed",
    false,
  );
  const [sidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // File selection within the current diff — lifted here so the ⌘K palette can
  // jump straight to a file. DiffViewer falls back gracefully on stale paths.
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);

  // URL <-> state sync: the query string mirrors the core selection so views
  // are shareable and back/forward works. `lastSeenSearch` is the search we
  // last reconciled (absorbs our own history writes); a URL comparison that
  // arrives before refs waits in `pendingUrlComparison` (carrying `file`,
  // since the repo-change reset nulls selectedFilePath).
  const search = useUrlSearch();
  const [lastSeenSearch, setLastSeenSearch] = useState("");
  const [pendingUrlComparison, setPendingUrlComparison] = useState<{
    base: RefRef | null;
    compare: RefRef | null;
    mode: DiffMode | null;
    file: string | null;
  } | null>(null);
  const prevRepoForUrl = useRef<string | null | undefined>(undefined);

  // Cross-repo dashboard preferences (persisted, SSR-safe).
  const [dashboardSort, setDashboardSort] = useLocalStorage<DashboardSort>(
    "gitscope.dashboard.sort",
    "recent",
  );
  const [dashboardView, setDashboardView] = useLocalStorage<DashboardView>(
    "gitscope.dashboard.view",
    "grid",
  );


  // The dashboard (selectedId === null) is the landing view: we never
  // auto-select a repo. Only reset to the dashboard if the selected repo
  // disappears from the list (e.g. it was removed).
  // Reconcile removed repositories before rendering dependent hooks. Wait for
  // the registry so a deep link is not cleared during the initial fetch.
  if (!reposLoading && selectedId && !repos.some((r) => r.id === selectedId)) {
    setSelectedId(null);
  }

  const selected = useMemo(
    () => repos.find((r) => r.id === selectedId) ?? null,
    [repos, selectedId],
  );

  // Never let the sidebar stay hidden when there's no repo to act on.
  const showSidebar = !sidebarCollapsed || !selected;

  const { refs, isLoading: refsLoading, mutate: mutateRefs } = useRefs(selectedId);

  // Per-branch GitHub PR status for the selected repo. Fetched independently of
  // useRefs so the picker renders before PRs resolve (badges pop in); empty on
  // any non-GitHub / no-gh / failure path.
  const { prByBranch } = usePullRequests(selectedId);

  const [base, setBase] = useState<RefInfo | null>(null);
  const [compare, setCompare] = useState<RefInfo | null>(null);
  const [mode, setMode] = useState<DiffMode>("merge-base");

  // Review-by-commit: when set, the diff view drills into a single commit
  // (base=<sha>~1, compare=<sha>, direct mode), overriding what useDiff fetches
  // below. Cleared on repo change and whenever the base/compare/mode change.
  const [commitSha, setCommitSha] = useState<string | null>(null);

  // Whitespace-insensitive diffs. Read-only here; the ReadabilityMenu in
  // DiffViewer writes this key and useLocalStorage syncs cross-instance.
  const [ignoreWhitespace] = useLocalStorage("gitscope.ignoreWhitespace", false);

  // Per-repo comparison persistence: coming back to a repo (or reloading the
  // page) restores exactly the refs + mode you had, with a short history of
  // previous comparisons for the ⌘K palette.
  const [comparisons, setComparisons] = useLocalStorage<ComparisonStore>(
    "gitscope.comparisons",
    {},
  );

  // URL → state reconcile (render-phase, before resetFor so a URL repo switch
  // sets selectedId first and the reset block reacts to it). Fires on first
  // hydration and on popstate; same-repo updates only setState on semantic
  // change, which is what keeps write → snapshot → reconcile from looping.
  if (search !== lastSeenSearch) {
    setLastSeenSearch(search);
    const u = search === lastSelfWrittenUrl ? null : parseUrl(search);
    if (u === null) {
      // Our own write reflected back by a later render — nothing to apply.
    } else if (u.repo !== selectedId) {
      setSelectedId(u.repo);
      setPendingUrlComparison(
        u.repo ? { base: u.base, compare: u.compare, mode: u.mode, file: u.file } : null,
      );
    } else if (u.repo) {
      if (refs) {
        if (u.base) {
          const b = resolveRefInfo(refs, u.base);
          if (!base || !sameRefInfo(base, b)) setBase(b);
        }
        if (u.compare) {
          const c = resolveRefInfo(refs, u.compare);
          if (!compare || !sameRefInfo(compare, c)) setCompare(c);
        }
      }
      if (u.mode && u.mode !== mode) setMode(u.mode);
      if ((u.file ?? null) !== selectedFilePath) setSelectedFilePath(u.file);
    }
  }

  // Reset selection the instant the repo changes, and initialize the
  // comparison once refs arrive — restoring the saved one when its refs still
  // exist, else picking defaults. Both are render-phase resets (the React
  // "adjust state when a prop changes" pattern, as in use-comments).
  const [resetFor, setResetFor] = useState<string | null>(null);
  const [comparisonInit, setComparisonInit] = useState<string | null>(null);
  if (resetFor !== selectedId) {
    setResetFor(selectedId);
    setComparisonInit(null);
    setBase(null);
    setCompare(null);
    setSelectedFilePath(null);
    setCommitSha(null);
  }
  if (selectedId && refs && comparisonInit !== selectedId) {
    setComparisonInit(selectedId);
    // priority: pendingUrlComparison > (reviewIntent, stage 3) > saved > defaults
    if (pendingUrlComparison) {
      const p = pendingUrlComparison;
      setPendingUrlComparison(null);
      if (p.base && p.compare) {
        setBase(resolveRefInfo(refs, p.base));
        setCompare(resolveRefInfo(refs, p.compare));
        setMode(p.mode ?? "merge-base");
      } else {
        const d = defaultRefs(refs);
        setBase(d.base);
        setCompare(d.compare);
        setMode(p.mode ?? "merge-base");
      }
      setSelectedFilePath(p.file ?? null);
    } else if (reviewIntent === selectedId) {
      // Review Inbox forces HEAD → Working, overriding any saved comparison.
      // HEAD/WORKING are sentinels (always valid) → no refs lookup needed.
      setReviewIntent(null);
      setBase({ kind: "head", ref: "HEAD", label: "HEAD" });
      setCompare({ kind: "working", ref: "WORKING", label: "Working tree" });
      setMode("merge-base");
    } else {
      const saved = comparisons[selectedId]?.current;
      if (
        saved &&
        refStillExists(refs, saved.base) &&
        refStillExists(refs, saved.compare)
      ) {
        setBase(saved.base);
        setCompare(saved.compare);
        setMode(saved.mode);
      } else {
        const d = defaultRefs(refs);
        setBase(d.base);
        setCompare(d.compare);
        setMode("merge-base");
      }
    }
  }

  // Exit commit view whenever the underlying comparison changes (render-phase
  // adjust-on-prop-change, not an effect). Placed after the URL reconcile and
  // comparisonInit blocks so a URL-driven or restored comparison change exits
  // the single-commit view in the same pass instead of fighting those guards.
  const cmpSig = `${base?.ref}|${compare?.ref}|${mode}`;
  const [cmpSigForCommit, setCmpSigForCommit] = useState(cmpSig);
  if (cmpSigForCommit !== cmpSig) {
    setCmpSigForCommit(cmpSig);
    setCommitSha(null);
  }

  // Effective diff args: while reviewing a single commit these override the
  // range refs (base=<sha>~1..<sha>, direct mode). A root commit's `<sha>~1`
  // won't resolve → getDiff catches it → empty diff (accepted limitation).
  const inCommitView = commitSha != null;
  const diffBase = inCommitView ? `${commitSha}~1` : base?.ref ?? null;
  const diffCompare = inCommitView ? commitSha : compare?.ref ?? null;
  const diffMode: DiffMode = inCommitView ? "direct" : mode;

  // Review-by-commit is only meaningful between two real commits; working /
  // staged refs have no commit range, so the affordance stays hidden.
  const canReview = Boolean(
    base &&
      compare &&
      base.kind !== "working" &&
      base.kind !== "staged" &&
      compare.kind !== "working" &&
      compare.kind !== "staged",
  );
  const commitRange = useCommitRange(
    selectedId,
    base?.ref ?? null,
    compare?.ref ?? null,
    canReview,
  );

  // Save the active comparison whenever it changes; the previous one rolls
  // into a small deduped history. No-op writes are skipped to avoid loops.
  useEffect(() => {
    if (!selectedId || !base || !compare) return;
    if (comparisonInit !== selectedId) return;
    const current: StoredComparison = { base, compare, mode };
    setComparisons((prev) => {
      const entry = prev[selectedId];
      if (entry && sameComparison(entry.current, current)) return prev;
      const recent = [entry?.current, ...(entry?.recent ?? [])]
        .filter((c): c is StoredComparison => Boolean(c))
        .filter((c) => !sameComparison(c, current))
        .filter((c, i, arr) => arr.findIndex((x) => sameComparison(x, c)) === i)
        .slice(0, 5);
      return { ...prev, [selectedId]: { current, recent } };
    });
  }, [selectedId, comparisonInit, base, compare, mode, setComparisons]);

  // State → URL: replaceState for in-repo tweaks, pushState on repo change
  // (a new history entry per repo, so back/forward walks repos). Our writes
  // emit no popstate, so useUrlSearch doesn't re-fire; the lastSeenSearch
  // guard absorbs the render where getSnapshot returns the new string.
  useEffect(() => {
    const isRepoChange =
      prevRepoForUrl.current !== undefined && prevRepoForUrl.current !== selectedId;
    prevRepoForUrl.current = selectedId;
    if (pendingUrlComparison) return; // URL selection not yet applied — don't clobber
    // During hydration the search snapshot is "" while the address bar may
    // carry a deep link; writing before that URL has been reconciled would
    // wipe it ahead of the post-hydration re-sync that applies it.
    if (window.location.search !== lastSeenSearch) return;
    const next = serializeUrl({
      repo: selectedId,
      base: base ? { kind: base.kind, ref: base.ref } : null,
      compare: compare ? { kind: compare.kind, ref: compare.ref } : null,
      mode: base && compare ? mode : null,
      file: selectedFilePath,
    });
    if (next === window.location.search) return;
    window.history[isRepoChange ? "pushState" : "replaceState"](
      null,
      "",
      next || window.location.pathname,
    );
    lastSelfWrittenUrl = next;
  }, [selectedId, base, compare, mode, selectedFilePath, pendingUrlComparison, lastSeenSearch]);

  // Keep the tab title scannable: repo + comparison when one is active.
  const selectedName = repos.find((r) => r.id === selectedId)?.name;
  useEffect(() => {
    document.title =
      selectedName && base && compare
        ? `${selectedName}: ${base.label} → ${compare.label} · GitScope`
        : selectedName
          ? `${selectedName} · GitScope`
          : "GitScope";
  }, [selectedName, base, compare]);

  const {
    diff,
    isLoading: diffLoading,
    error: diffError,
    mutate: mutateDiff,
  } = useDiff(selectedId, diffBase, diffCompare, diffMode, ignoreWhitespace);

  // Pre-flight allowlist controller: seeded from the snapshot embedded in the
  // diff payload, mutated optimistically, persisted via the allowlist API.
  const preflight = usePreflightAllowlist(selectedId, diff?.preflight?.allowlist);

  // Review-comments controller: per-repo notes, content-hash anchored to the
  // current diff, mutated optimistically, copied to the clipboard for an AI.
  const comments = useComments(selectedId, diff, selected?.path ?? null);

  async function handleAdd(input: { path: string; name?: string }) {
    const added = await addRepo(input); // throws → dialog shows inline error
    toast.success(`Added ${added.name}`);
    selectRepo(added.id);
  }

  async function handleRemove(id: string) {
    const name = repos.find((r) => r.id === id)?.name ?? "repository";
    try {
      await removeRepo(id);
      toast.success(`Removed ${name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to remove");
    }
  }

  const refreshAll = useCallback(() => {
    mutateRepos();
    mutateRefs();
    mutateDiff();
  }, [mutateRepos, mutateRefs, mutateDiff]);

  // Live diff: watch the working tree over SSE while a WORKING/STAGED
  // comparison is on screen (and not drilled into a commit), so an agent's
  // edits land in the diff as they happen.
  const liveActive = Boolean(
    selected?.ok &&
      !commitSha &&
      ((base && (base.kind === "working" || base.kind === "staged")) ||
        (compare && (compare.kind === "working" || compare.kind === "staged"))),
  );
  const { live } = useLiveDiff(
    selectedId,
    liveActive,
    useCallback(() => {
      mutateDiff();
      mutateRepos();
    }, [mutateDiff, mutateRepos]),
  );

  // Global keys: ⌘/Ctrl+B sidebar, ⌘/Ctrl+K palette, R refresh, ? shortcuts.
  // Single-key shortcuts are ignored while typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.altKey) {
        if (e.key === "b" || e.key === "B") {
          e.preventDefault();
          setSidebarCollapsed((c) => !c);
        } else if (e.key === "k" || e.key === "K") {
          e.preventDefault();
          setPaletteOpen((o) => !o);
        }
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT" ||
          t.isContentEditable)
      )
        return;
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        refreshAll();
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen((o) => !o);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setSidebarCollapsed, refreshAll]);

  // ── Shared pieces ─────────────────────────────────────────────────────────

  const compareProps = {
    refs,
    prByBranch,
    base,
    compare,
    // A manual ref edit ends any inbox triage session (step 8); mode changes
    // do not, so switching diff mode while reviewing keeps the flow.
    onBaseChange: (r: RefInfo) => {
      if (inboxMode) setInboxMode(false);
      setBase(r);
    },
    onCompareChange: (r: RefInfo) => {
      if (inboxMode) setInboxMode(false);
      setCompare(r);
    },
    mode,
    onModeChange: setMode,
    onSwap: () => {
      setBase(compare);
      setCompare(base);
    },
    commits: commitRange.commits,
    commitReviewEnabled: canReview,
    commitSha,
    onPickCommit: (sha: string) => setCommitSha(sha),
    onExitCommit: () => setCommitSha(null),
  };

  // Review Inbox: the next dirty repo to advance to once every file is viewed,
  // cycling in dashboard sort order. Null unless we arrived via "Review changes"
  // and more than one dirty repo remains.
  const nextReview = useMemo(() => {
    if (!inboxMode || !selectedId) return null;
    const dirty = sortRepos(repos, dashboardSort).filter(
      (r) => r.ok && r.status && !r.status.clean,
    );
    if (dirty.length <= 1) return null;
    const i = dirty.findIndex((r) => r.id === selectedId);
    const nextRepo = dirty[(i + 1) % dirty.length];
    if (!nextRepo || nextRepo.id === selectedId) return null;
    return {
      name: nextRepo.name,
      onGo: () => selectRepo(nextRepo.id, { review: true }),
    };
  }, [inboxMode, selectedId, repos, dashboardSort, selectRepo]);

  // Branch stats for the selected-repo header (plan C6): derived from the
  // already-fetched refs — no extra request.
  const branchCount = refs?.branches.length ?? 0;
  const mergedCount = refs?.branches.filter((b) => b.merged).length ?? 0;

  const headerActions = (
    <div className="ml-auto flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        className="pointer-coarse:size-10"
        aria-label="Command palette"
        title={`Command palette (${mod}K)`}
        onClick={() => setPaletteOpen(true)}
      >
        <Search />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="pointer-coarse:size-10"
        aria-label="Refresh"
        title="Refresh (R)"
        onClick={refreshAll}
      >
        <RefreshCw className={refsLoading || diffLoading ? "animate-spin" : ""} />
      </Button>
      <ThemeToggle />
    </div>
  );

  const diffContent = (
    <div className="min-h-0 flex-1 overflow-hidden">
      {diffError ? (
        <CenterNote
          title="Couldn't load this diff"
          detail={diffError instanceof Error ? diffError.message : String(diffError)}
        />
      ) : !base || !compare ? (
        // On a repo switch base/compare are null until refs land, and both
        // pickers are disabled meanwhile — so the "pick two refs" instruction
        // would be un-actionable. Show the pending shape instead.
        refsLoading ? (
          <DiffSkeleton compact={compact} />
        ) : (
          <CenterNote title="Pick two refs to compare." />
        )
      ) : diffLoading && !diff ? (
        <DiffSkeleton compact={compact} />
      ) : diff ? (
        <DiffViewer
          result={diff}
          allowlist={preflight}
          comments={comments}
          repoId={selectedId}
          selectedPath={selectedFilePath}
          onSelectPath={setSelectedFilePath}
          nextReview={nextReview}
        />
      ) : null}
    </div>
  );

  const notARepo = (
    <div className="min-h-0 flex-1 overflow-hidden">
      <CenterNote
        title="This path isn't a git repository"
        detail={selected?.error ?? selected?.path}
      />
    </div>
  );

  const repoSidebar = (onSelectExtra?: () => void) => (
    <RepoSidebar
      repos={repos}
      selectedId={selectedId}
      onSelect={(id) => {
        selectRepo(id);
        onSelectExtra?.();
      }}
      onAdd={handleAdd}
      onRemove={handleRemove}
      loading={reposLoading && repos.length === 0}
      onHome={() => {
        selectRepo(null);
        onSelectExtra?.();
      }}
      homeActive={selectedId === null}
    />
  );

  // ⌘K palette + "?" help — rendered once, shared by both layouts.
  const overlays = (
    <>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        repos={repos}
        selectedRepoId={selectedId}
        files={selected?.ok && diff ? diff.files : []}
        patch={diff?.patch}
        refs={selected?.ok ? refs : undefined}
        base={base}
        compare={compare}
        onSetCompare={setCompare}
        onSwap={() => {
          setBase(compare);
          setCompare(base);
        }}
        recentComparisons={
          selectedId ? (comparisons[selectedId]?.recent ?? []) : []
        }
        onApplyComparison={(c) => {
          setBase(c.base);
          setCompare(c.compare);
          setMode(c.mode);
        }}
        onSelectRepo={(id) => selectRepo(id)}
        onGoOverview={() => selectRepo(null)}
        onSelectFile={setSelectedFilePath}
        onRefresh={refreshAll}
        onToggleSidebar={
          compact
            ? () => setSidebarDrawerOpen((o) => !o)
            : () => setSidebarCollapsed((c) => !c)
        }
        onShowShortcuts={() => setShortcutsOpen(true)}
      />
      <ShortcutsHelp open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );

  // The cross-repo Overview dashboard — the landing view when no repo is
  // selected. Self-contained: owns its toolbar (sort + view + Add) and its
  // own loading / empty states, so it drops into both layouts unchanged.
  const dashboard = (
    <RepoDashboard
      repos={repos}
      onSelect={(id) => selectRepo(id)}
      onReview={(id) => selectRepo(id, { review: true })}
      onRemove={handleRemove}
      onAdd={handleAdd}
      loading={reposLoading && repos.length === 0}
      sort={dashboardSort}
      onSortChange={setDashboardSort}
      view={dashboardView}
      onViewChange={setDashboardView}
    />
  );

  // ── Compact / touch: one merged top bar (menu + comparison) + diff ────────

  if (compact) {
    return (
      <div className="flex h-full w-full flex-col overflow-hidden">
        {/* One slim bar: menu · comparison (or title) · overflow. Palette,
            refresh, theme and shortcuts fold into the overflow so the
            comparison keeps the width it needs to stay readable. */}
        <header className="flex h-14 shrink-0 select-none items-center gap-1 border-b px-1.5">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 pointer-coarse:size-10"
            aria-label="Open repositories"
            onClick={() => setSidebarDrawerOpen(true)}
          >
            <Menu />
          </Button>

          {selected?.ok ? (
            <CompareTrigger
              className="min-w-0 flex-1"
              title={selected.name}
              live={live}
              {...compareProps}
            />
          ) : (
            <div className="min-w-0 flex-1 px-1">
              <h1 className="truncate text-sm font-medium leading-tight">
                {selected?.name ?? "Overview"}
              </h1>
              <div className="truncate text-[11px] leading-tight text-muted-foreground">
                {selected
                  ? selected.path
                  : `${repos.length} ${repos.length === 1 ? "repository" : "repositories"}`}
              </div>
            </div>
          )}

          <AppMenu
            onOpenPalette={() => setPaletteOpen(true)}
            onRefresh={refreshAll}
            refreshing={refsLoading || diffLoading}
            onShowShortcuts={() => setShortcutsOpen(true)}
          />
        </header>

        {selected ? (
          selected.ok ? (
            diffContent
          ) : (
            notARepo
          )
        ) : (
          dashboard
        )}

        <Sheet open={sidebarDrawerOpen} onOpenChange={setSidebarDrawerOpen}>
          <SheetContent
            side="left"
            showCloseButton={false}
            className="w-[86%] max-w-sm gap-0 p-0"
          >
            <SheetTitle className="sr-only">Repositories</SheetTitle>
            {repoSidebar(() => setSidebarDrawerOpen(false))}
          </SheetContent>
        </Sheet>

        {overlays}
      </div>
    );
  }

  // ── Desktop: collapsible sidebar column + main ────────────────────────────

  return (
    <div className="flex h-full w-full overflow-hidden">
      <aside
        className={cn(
          // Plain background, not bg-sidebar: in light mode a tinted column
          // leaves the rows' bg-accent selection almost invisible against it.
          "flex shrink-0 flex-col overflow-hidden transition-[width] duration-200 ease-out",
          showSidebar ? "w-[300px] border-r" : "w-0",
        )}
      >
        <div className="flex w-[300px] flex-1 flex-col">{repoSidebar()}</div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <>
            <header className="flex h-12 shrink-0 select-none items-center gap-3 border-b px-3">
              <Button
                variant="ghost"
                size="icon"
                aria-label="Toggle sidebar"
                title={`Toggle sidebar (${mod}B)`}
                onClick={() => setSidebarCollapsed((c) => !c)}
                className="shrink-0"
              >
                {showSidebar ? <PanelLeftClose /> : <PanelLeftOpen />}
              </Button>
              <FolderGit2 className="size-4 shrink-0 text-muted-foreground" />
              {/* Two lines, not three: name over a single meta line. The path
                  is the only part allowed to truncate; the branch counts are
                  short and fixed, so they hold their width on the right. */}
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-sm font-medium leading-tight">
                  {selected.name}
                </h1>
                <div className="flex min-w-0 items-baseline gap-1.5 text-[11px] leading-tight text-muted-foreground">
                  <span className="truncate font-mono" title={selected.path}>
                    {selected.path}
                  </span>
                  {selected.ok && branchCount > 0 ? (
                    <span className="shrink-0 tabular-nums">
                      · {branchCount}{" "}
                      {branchCount === 1 ? "branch" : "branches"}
                      {mergedCount > 0 ? ` · ${mergedCount} merged` : ""}
                    </span>
                  ) : null}
                </div>
              </div>
              {headerActions}
            </header>
            {selected.ok ? (
              <>
                <CompareBar
                  {...compareProps}
                  stats={diff?.stats}
                  // Keep the placeholder up until the numbers exist, otherwise
                  // the slot empties between refs landing and the diff arriving.
                  loading={refsLoading || (diffLoading && !diff?.stats)}
                  live={live}
                />
                {diffContent}
              </>
            ) : (
              notARepo
            )}
          </>
        ) : (
          <>
            <header className="flex h-12 shrink-0 select-none items-center gap-3 border-b px-3">
              <LayoutDashboard className="size-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <h1 className="truncate text-sm font-medium leading-tight">
                  Overview
                </h1>
                <div className="truncate text-[11px] leading-tight text-muted-foreground">
                  {repos.length} {repos.length === 1 ? "repository" : "repositories"}
                </div>
              </div>
              {headerActions}
            </header>
            {dashboard}
          </>
        )}
      </main>

      {overlays}
    </div>
  );
}

function CenterNote({ title, detail }: { title: string; detail?: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-1.5 p-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {detail ? (
        <p className="max-w-md font-mono text-xs text-muted-foreground">{detail}</p>
      ) : null}
    </div>
  );
}

// Mirrors DiffViewer's shape (toolbar strip + file panel + diff pane) so the
// hand-off to the real viewer doesn't re-lay-out the whole pane.
function DiffSkeleton({ compact }: { compact: boolean }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Toolbar strip — same padding the real toolbar picks for this layout. */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-3 border-b",
          compact ? "px-3 py-1.5" : "px-4 py-2.5",
        )}
      >
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-4 w-10" />
        <Skeleton className="ml-auto h-7 w-40" />
      </div>
      <div className="flex min-h-0 flex-1">
        {/* File panel — only the desktop layout has one; compact uses a sheet. */}
        <div
          className={cn(
            "w-[26%] shrink-0 flex-col gap-2 border-r p-3",
            compact ? "hidden" : "flex",
          )}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-4" style={{ width: `${50 + ((i * 29) % 45)}%` }} />
          ))}
        </div>
        <div className="min-w-0 flex-1 space-y-2 p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-5" style={{ width: `${40 + ((i * 37) % 55)}%` }} />
          ))}
        </div>
      </div>
    </div>
  );
}
