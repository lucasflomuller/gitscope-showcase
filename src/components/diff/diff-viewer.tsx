"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlignJustify,
  ArrowRight,
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  CircleCheckBig,
  Columns2,
  Copy,
  FileCog,
  FileDiff,
  Flag,
  ListTree,
  MoreVertical,
  PanelLeftOpen,
  Search,
  SlidersHorizontal,
  TriangleAlert,
  X,
} from "lucide-react"
import { toast } from "sonner"

import type { DiffFileSummary, DiffResult, PreflightFinding } from "@/lib/types"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { useCheckpoint } from "@/hooks/use-checkpoint"
import { useCompactUI } from "@/hooks/use-compact-ui"
import { useGuide } from "@/hooks/use-guide"
import { useLocalStorage } from "@/hooks/use-local-storage"
import { usePrereview } from "@/hooks/use-prereview"
import { useBlame } from "@/hooks/use-blame"
import { useReferences } from "@/hooks/use-references"
import { useSymbols } from "@/hooks/use-symbols"
import { digestChanges, lineHash, useViewedFiles } from "@/hooks/use-viewed"
import { formatRelativeTime } from "@/lib/format-time"
import type { PreflightController } from "@/hooks/use-preflight"
import type { CommentsController } from "@/hooks/use-comments"
import { cn } from "@/lib/utils"

import { isFileLevel, type ResolvedComment } from "./comment-meta"
import { CommentsPanel } from "./comments-panel"
import { CommentsSummary } from "./comments-summary"
import { DiffFile } from "./diff-file"
import { DiffFileTree } from "./diff-file-tree"
import { GuidePanel, GuideSectionBanner } from "./guide-panel"
import { chunkAnchorLine, filePath } from "./file-meta"
import { classifyFile, type FileClass } from "./noise"
import { buildFindingIndex } from "./preflight-meta"
import { PreflightPanel } from "./preflight-panel"
import { PreflightSummary } from "./preflight-summary"
import { ReferencesPanel } from "./references-panel"
import { DiffSearch } from "./diff-search"
import { searchFiles, type SearchMatch } from "./search-meta"
import parseDiff from "parse-diff"

const noopIgnored = () => false

type ReadabilityPrefs = {
  syntax: boolean
  setSyntax: (v: boolean) => void
  wrap: boolean
  setWrap: (v: boolean) => void
  /** Wrap only applies to the unified layout; split alignment requires no-wrap. */
  splitActive: boolean
  showGenerated: boolean
  setShowGenerated: (v: boolean) => void
  showWhitespace: boolean
  setShowWhitespace: (v: boolean) => void
  ignoreWhitespace: boolean
  setIgnoreWhitespace: (v: boolean) => void
  compactDensity: boolean
  setCompactDensity: (v: boolean) => void
  noiseCount: number
}

/** A labelled switch row inside the readability popover. */
function ToggleRow({
  label,
  hint,
  checked,
  onCheckedChange,
  disabled,
}: {
  label: string
  hint?: string
  checked: boolean
  onCheckedChange: (v: boolean) => void
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        "flex cursor-default items-center justify-between gap-3 text-sm select-none pointer-coarse:py-1",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="min-w-0">
        <span className="block">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
      </span>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} />
    </label>
  )
}

/** Popover holding the syntax / show-generated / show-whitespace switches. */
function ReadabilityMenu({
  prefs,
  align = "end",
}: {
  prefs: ReadabilityPrefs
  align?: "start" | "end"
}) {
  return (
    <Popover>
      <PopoverTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            className="gap-1.5 pointer-coarse:h-9"
            title="Display options"
            aria-label="Display options"
          />
        }
      >
        <SlidersHorizontal />
        <span className="max-sm:sr-only">Display</span>
      </PopoverTrigger>
      <PopoverContent align={align} className="w-64 gap-3">
        <ToggleRow
          label="Syntax highlighting"
          checked={prefs.syntax}
          onCheckedChange={prefs.setSyntax}
        />
        <ToggleRow
          label="Wrap long lines"
          hint={prefs.splitActive ? "Unified view only" : undefined}
          checked={prefs.wrap}
          onCheckedChange={prefs.setWrap}
          disabled={prefs.splitActive}
        />
        <ToggleRow
          label="Show generated files"
          hint={prefs.noiseCount > 0 ? undefined : "No generated/noise files"}
          checked={prefs.showGenerated}
          onCheckedChange={prefs.setShowGenerated}
        />
        <ToggleRow
          label="Show whitespace-only"
          checked={prefs.showWhitespace}
          onCheckedChange={prefs.setShowWhitespace}
        />
        <ToggleRow
          label="Ignore whitespace (-w)"
          hint="Hides indentation/whitespace-only diffs at the git level"
          checked={prefs.ignoreWhitespace}
          onCheckedChange={prefs.setIgnoreWhitespace}
        />
        <ToggleRow
          label="Compact density"
          hint="Tighter code rows, smaller text"
          checked={prefs.compactDensity}
          onCheckedChange={prefs.setCompactDensity}
        />
      </PopoverContent>
    </Popover>
  )
}

/** Pane shown when every changed file is generated/whitespace noise. */
function NoiseEmptyState({
  total,
  onReveal,
}: {
  total: number
  onReveal: () => void
}) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-10 text-center">
      <FileCog className="size-6 text-muted-foreground opacity-70" />
      <div className="text-sm font-medium">0 of {total} files meaningful</div>
      <p className="max-w-xs text-xs text-muted-foreground">
        All changes are in generated, lockfile, or whitespace-only files —
        collapsed to reduce noise.
      </p>
      <Button size="sm" variant="secondary" className="pointer-coarse:h-9" onClick={onReveal}>
        Show generated files
      </Button>
    </div>
  )
}

/** Pane shown when the comparison produces no patch at all. */
function EmptyDiffState({
  mode,
  compare,
}: {
  mode: DiffResult["mode"]
  compare: string
}) {
  // `mode` stays "merge-base" even for the local sentinels, so branch on the
  // compare slot first: WORKING/STAGED aren't real refs, and swapping them into
  // the base slot isn't handled by getDiff — that advice would break the pair.
  const local = compare === "WORKING" || compare === "STAGED"
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-10 text-center">
      <FileDiff className="size-6 text-muted-foreground opacity-70" />
      <div className="text-sm font-medium">
        {local ? "Nothing to review yet" : "No changes between these refs"}
      </div>
      <p className="max-w-xs text-xs text-muted-foreground">
        {local
          ? compare === "STAGED"
            ? "Nothing is staged on top of the base. Stage some changes, or pick a different pair above."
            : "Your working tree matches the base — nothing uncommitted to show. Pick a different pair above."
          : mode === "merge-base"
            ? "The compare ref adds nothing on top of the base — it may already be merged. Swap the two refs, or pick a different pair above."
            : "Both refs point at identical content. Pick a different base or compare above."}
      </p>
    </div>
  )
}

export function DiffViewer({
  result,
  allowlist,
  comments,
  repoId,
  selectedPath,
  onSelectPath,
  nextReview,
}: {
  result: DiffResult
  allowlist?: PreflightController
  comments?: CommentsController
  /** Repo id — enables the lazy tree-sitter symbol outline for the selected file. */
  repoId?: string | null
  /** Lifted file selection (owned by the page so the ⌘K palette can drive it). */
  selectedPath: string | null
  onSelectPath: (path: string) => void
  /** Review-inbox hand-off: shown once every file is viewed (optional / additive). */
  nextReview?: { name: string; onGo: () => void } | null
}) {
  const compact = useCompactUI()
  const [view, setView] = useLocalStorage<"unified" | "split">(
    "gitscope.diffView",
    "unified",
  )
  const [panelCollapsed, setPanelCollapsed] = useLocalStorage(
    "gitscope.filePanelCollapsed",
    false,
  )
  const [filesSheetOpen, setFilesSheetOpen] = useState(false)

  // Readability pack prefs (same persistence pattern as diffView/filePanelCollapsed).
  const [syntax, setSyntax] = useLocalStorage("gitscope.syntax", true)
  const [wrap, setWrap] = useLocalStorage("gitscope.wrapLines", false)
  const [density, setDensity] = useLocalStorage<"comfortable" | "compact">(
    "gitscope.density",
    "comfortable",
  )
  const [showGenerated, setShowGenerated] = useLocalStorage(
    "gitscope.showGenerated",
    false,
  )
  const [showWhitespace, setShowWhitespace] = useLocalStorage(
    "gitscope.showWhitespace",
    false,
  )
  // Server-level `git diff -w` toggle; a stage-2 agent reads this same key in
  // page.tsx (useLocalStorage syncs cross-instance) — until then it only persists.
  const [ignoreWhitespace, setIgnoreWhitespace] = useLocalStorage(
    "gitscope.ignoreWhitespace",
    false,
  )
  // Checkpoint review filter: narrow navigation to files with new-since-
  // checkpoint changes. Inert until a checkpoint exists.
  const [onlyNew, setOnlyNew] = useLocalStorage("gitscope.onlyNew", false)

  // In-diff search: bar open + raw / debounced query.
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [debouncedQuery, setDebouncedQuery] = useState("")

  // Pre-flight: panel open + the finding to scroll/pulse on jump.
  const [preflightOpen, setPreflightOpen] = useState(false)
  const [focus, setFocus] = useState<{ line: number; nonce: number } | null>(null)

  // Review comments: panel open state (jump reuses the shared `focus`).
  const [commentsOpen, setCommentsOpen] = useState(false)

  // Blame gutter: session-only toggle (survives file switches, off by default);
  // the fetch stays lazy — nothing loads until blame is turned on.
  const [blameOn, setBlameOn] = useState(false)

  const files = useMemo(() => parseDiff(result.patch ?? ""), [result.patch])

  // Debounce the query so large diffs aren't re-scanned on every keystroke.
  // setState in the timeout callback is allowed; never sync in the effect body.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(searchQuery), 150)
    return () => clearTimeout(t)
  }, [searchQuery])

  const searchResults = useMemo(
    () => searchFiles(files, debouncedQuery),
    [files, debouncedQuery],
  )

  // ── Noise classification (generated / lockfile / whitespace-only) ──────────
  // The optional server `generated` flag rides along on result.files[]; absent
  // → undefined → the classifier falls back to its built-in glob list.
  const summaryByPath = useMemo(() => {
    const m = new Map<string, DiffFileSummary>()
    for (const f of result.files) m.set(f.path, f)
    return m
  }, [result.files])

  const classByPath = useMemo(() => {
    const m = new Map<string, FileClass>()
    for (const f of files) {
      const p = filePath(f)
      m.set(
        p,
        classifyFile(p, f, { generatedFromServer: summaryByPath.get(p)?.generated }),
      )
    }
    return m
  }, [files, summaryByPath])

  const meaningfulCount = useMemo(() => {
    let n = 0
    for (const c of classByPath.values()) if (c === "meaningful") n++
    return n
  }, [classByPath])

  const noiseCount = files.length - meaningfulCount

  // A file is part of the navigable set (default selection + j/k) when it is
  // meaningful, or its noise kind has been revealed via the toggles.
  const isVisible = useCallback(
    (path: string): boolean => {
      const c = classByPath.get(path) ?? "meaningful"
      if (c === "meaningful") return true
      if (c === "generated") return showGenerated
      return showWhitespace
    },
    [classByPath, showGenerated, showWhitespace],
  )
  const navigablePaths = useMemo(
    () => files.map(filePath).filter(isVisible),
    [files, isVisible],
  )

  // ── Viewed tracking (GitHub-style, digest-invalidated) ─────────────────────
  const digestByPath = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of files) {
      m.set(
        filePath(f),
        digestChanges(
          (function* () {
            for (const chunk of f.chunks)
              for (const ch of chunk.changes) yield ch.content
          })(),
        ),
      )
    }
    return m
  }, [files])

  const viewed = useViewedFiles(
    repoId,
    result.base,
    result.compare,
    result.mode,
    digestByPath,
  )
  const viewedCount = viewed.countIn(navigablePaths)

  // ── Review checkpoint ("new since checkpoint" markers) ─────────────────────
  // Content-hashes of every added line, path-salted so identical lines in
  // different files stay distinct. The checkpoint snapshots `all`; anything
  // hashed later that isn't in the snapshot reads as new.
  const addedHashes = useMemo(() => {
    const all: string[] = []
    const byPath = new Map<string, string[]>()
    for (const f of files) {
      const p = filePath(f)
      for (const chunk of f.chunks) {
        for (const ch of chunk.changes) {
          if (ch.type !== "add") continue
          const h = lineHash(p, ch.content)
          all.push(h)
          const arr = byPath.get(p)
          if (arr) arr.push(h)
          else byPath.set(p, [h])
        }
      }
    }
    return { all, byPath }
  }, [files])

  const checkpoint = useCheckpoint(
    repoId,
    result.base,
    result.compare,
    result.mode,
    addedHashes,
  )

  // "Only new" narrows the review set (selection fallback, j/k, stepper,
  // progress). navigablePaths stays the full set — allNoise and the inbox
  // "all viewed" contract key off the unfiltered list.
  const filterActive = onlyNew && checkpoint.hasCheckpoint
  const reviewPaths = useMemo(
    () =>
      filterActive
        ? navigablePaths.filter((p) => checkpoint.newCountFor(p) > 0)
        : navigablePaths,
    [filterActive, navigablePaths, checkpoint],
  )

  // ── Review guide + AI pre-review (the MCP loop's UI surface) ──────────────
  const guideCtl = useGuide(repoId, result.base, result.compare, result.mode)
  const prereviewCtl = usePrereview(repoId ?? null)
  const [panelTab, setPanelTab] = useLocalStorage<"files" | "guide">(
    "gitscope.panelTab",
    "files",
  )
  // When a guide lands while we're mounted (an agent submitted over MCP, or
  // generation finished), switch to it — the live hand-off moment. Render-phase
  // adjust; the initial mount only records what's already there.
  const guideId = guideCtl.guide?.id ?? null
  const [seenGuideId, setSeenGuideId] = useState<string | null | undefined>(undefined)
  if (seenGuideId === undefined) {
    setSeenGuideId(guideId)
  } else if (guideId !== seenGuideId) {
    setSeenGuideId(guideId)
    if (guideId) setPanelTab("guide")
  }

  // The guide's sections restricted to files actually visible in this diff —
  // the panel, the section banner, and guided navigation all share this view.
  const guideActive = panelTab === "guide" && Boolean(guideCtl.guide)
  const guideSections = useMemo(() => {
    if (!guideCtl.guide) return []
    const visible = new Set(navigablePaths)
    return guideCtl.guide.sections
      .map((s) => ({ ...s, paths: s.paths.filter((p) => visible.has(p)) }))
      .filter((s) => s.paths.length > 0)
  }, [guideCtl.guide, navigablePaths])

  // While the Guide tab is active, the guide's reading order becomes the review
  // spine: j/k, the stepper, v-advance, and the footer walk sections top to
  // bottom. Files the guide doesn't mention sort last, so nothing is unreachable.
  const navPaths = useMemo(() => {
    if (!guideActive || guideSections.length === 0) return reviewPaths
    const order = new Map<string, number>()
    let i = 0
    for (const s of guideSections)
      for (const p of s.paths) if (!order.has(p)) order.set(p, i++)
    return [...reviewPaths].sort(
      (a, b) =>
        (order.get(a) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b) ?? Number.MAX_SAFE_INTEGER),
    )
  }, [guideActive, guideSections, reviewPaths])

  // Per-file new-line counts for the tree/list badges (only once a checkpoint exists).
  const newCountByPath = useMemo(() => {
    if (!checkpoint.hasCheckpoint) return undefined
    const m = new Map<string, number>()
    for (const p of addedHashes.byPath.keys()) {
      const n = checkpoint.newCountFor(p)
      if (n > 0) m.set(p, n)
    }
    return m
  }, [checkpoint, addedHashes])

  // Resolve the active file: explicit selection, else (while filtering) the
  // first file with new changes, else the first MEANINGFUL file (avoids landing
  // on .env/.gitignore/lockfiles), else first visible, else first.
  const selectedFile =
    files.find((f) => filePath(f) === selectedPath) ??
    (filterActive
      ? files.find((f) => navPaths.includes(filePath(f)))
      : (files.find((f) => classByPath.get(filePath(f)) === "meaningful") ??
        files.find((f) => isVisible(filePath(f))))) ??
    files[0] ??
    null
  const effectiveSelected = selectedFile ? filePath(selectedFile) : null

  // The guide section the selected file belongs to — drives the section banner
  // above the diff and the "next section" pacing hint in the footer.
  const sectionIdx = guideActive && effectiveSelected
    ? guideSections.findIndex((s) => s.paths.includes(effectiveSelected))
    : -1
  const currentGuideSection = sectionIdx >= 0 ? guideSections[sectionIdx] : null

  // Lazy, ref-correct tree-sitter symbols for the SELECTED file only — parsed
  // from the compare-side blob, so they line up with exactly this diff. Best
  // effort: empty (unsupported / loading / failure) → no breadcrumb, no outline.
  const { symbols: selectedSymbols } = useSymbols(
    repoId ?? null,
    result.compare,
    effectiveSelected,
  )

  // Lazy per-line blame for the SELECTED file (compare-side), fetched only once
  // the gutter is toggled on. Empty on failure/untracked → the column no-ops.
  const { blame, isLoading: blamePending } = useBlame(
    repoId ?? null,
    result.compare,
    effectiveSelected,
    blameOn,
  )

  // ── Hunk navigation (n / p) ─────────────────────────────────────────────────
  // Anchor new-side line per hunk; drives the same focus→scroll+pulse primitive
  // as the panel jumps. Index resets on file change via the render-phase pattern.
  const hunkAnchors = useMemo(
    () =>
      selectedFile
        ? selectedFile.chunks
            .map(chunkAnchorLine)
            .filter((n): n is number => n != null)
        : [],
    [selectedFile],
  )
  const [hunkIdx, setHunkIdx] = useState(-1)
  const [hunkFile, setHunkFile] = useState(effectiveSelected)
  if (hunkFile !== effectiveSelected) {
    setHunkFile(effectiveSelected)
    setHunkIdx(-1)
  }

  // Blast radius: on-demand "who references this symbol" at the compare ref,
  // launched from the outline's per-row action. Keyed by the clicked NAME (not
  // the selected file). Best effort — unavailable references never affect the diff.
  const references = useReferences(repoId ?? null, result.compare)

  // Every changed-file path (new-side + rename old-side) — the membership set
  // the references panel partitions hits by ("in this diff" vs "not updated").
  const changedPaths = useMemo(() => {
    const s = new Set<string>()
    for (const f of result.files) {
      if (f.path) s.add(f.path)
      if (f.oldPath) s.add(f.oldPath)
    }
    return s
  }, [result.files])

  const empty = files.length === 0
  // Every changed file is noise and nothing is revealed → show a CTA, not a pane.
  const allNoise = !empty && navigablePaths.length === 0
  // Split view is unusable on narrow / touch screens — always unified there.
  const effectiveView = compact ? "unified" : view

  // ── Pre-flight findings (optional / additive) ─────────────────────────────
  const preflight = result.preflight
  const showPreflight = Boolean(preflight && allowlist)
  const isIgnored = allowlist?.isIgnored ?? noopIgnored
  const index = useMemo(
    () => buildFindingIndex(preflight?.findings ?? [], isIgnored),
    [preflight?.findings, isIgnored],
  )

  function jumpToFinding(finding: PreflightFinding) {
    onSelectPath(finding.path)
    setFocus({ line: finding.line, nonce: Date.now() })
    setPreflightOpen(false)
  }

  function jumpToComment(comment: ResolvedComment) {
    onSelectPath(comment.path)
    // Resolved, line-anchored notes scroll+pulse; orphaned/file notes just open.
    if (!comment.orphaned && !isFileLevel(comment)) {
      setFocus({ line: comment.endLine, nonce: Date.now() })
    }
    setCommentsOpen(false)
  }

  // In-diff reference hits select their file + scroll/pulse the line, then close
  // the panel (same focusLine/focusNonce primitive as the other jumps).
  function jumpToReference(path: string, line: number) {
    onSelectPath(path)
    setFocus({ line, nonce: Date.now() })
    references.setOpen(false)
  }

  // Search hit → select its file; line-anchored hits scroll/pulse, del-only hits
  // (no new-side line) just select. Same focus/pulse primitive as the other jumps.
  function jumpToSearch(m: SearchMatch) {
    onSelectPath(m.path)
    if (m.line != null) setFocus({ line: m.line, nonce: Date.now() })
    setSearchOpen(false)
  }

  // Per-selected-file comment maps: inline cards keyed by anchor (end) line,
  // plus whole-file notes. Orphaned notes have no inline anchor (panel only).
  const commentsForSelected = useMemo(() => {
    const byLine = new Map<number, ResolvedComment[]>()
    const file: ResolvedComment[] = []
    if (!comments || !effectiveSelected) return { byLine: undefined, file }
    for (const c of comments.comments) {
      if (c.path !== effectiveSelected) continue
      if (isFileLevel(c)) {
        file.push(c)
        continue
      }
      if (c.orphaned) continue
      const arr = byLine.get(c.endLine) ?? []
      arr.push(c)
      byLine.set(c.endLine, arr)
    }
    return { byLine: byLine.size > 0 ? byLine : undefined, file }
  }, [comments, effectiveSelected])

  // Step to the adjacent visible file (j/k keys and the toolbar arrows).
  const currentIndex = effectiveSelected
    ? navPaths.indexOf(effectiveSelected)
    : -1

  const stepFile = useCallback(
    (delta: 1 | -1) => {
      const paths = navPaths
      if (paths.length === 0) return
      const cur = effectiveSelected ? paths.indexOf(effectiveSelected) : -1
      const base = cur === -1 ? (delta === 1 ? -1 : 0) : cur
      const next = Math.min(paths.length - 1, Math.max(0, base + delta))
      onSelectPath(paths[next])
    },
    [navPaths, effectiveSelected, onSelectPath],
  )

  // Toggle viewed on the current file; marking viewed advances to the next
  // unviewed file (GitHub's review flow), staying put when none remain.
  const toggleViewed = useCallback(() => {
    if (!effectiveSelected) return
    const wasViewed = viewed.isViewed(effectiveSelected)
    viewed.toggle(effectiveSelected)
    if (wasViewed) return
    const cur = navPaths.indexOf(effectiveSelected)
    for (let i = cur + 1; i < navPaths.length; i++) {
      if (!viewed.isViewed(navPaths[i])) {
        onSelectPath(navPaths[i])
        return
      }
    }
  }, [effectiveSelected, viewed, navPaths, onSelectPath])

  // j / k step through files, v toggles viewed (GitHub-style); ignored while typing.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      if (
        e.key !== "j" &&
        e.key !== "k" &&
        e.key !== "v" &&
        e.key !== "/" &&
        e.key !== "n" &&
        e.key !== "p"
      )
        return
      const t = e.target as HTMLElement | null
      if (
        t &&
        (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)
      )
        return
      // '/' opens search — available even on all-noise diffs (before the guard).
      if (e.key === "/") {
        e.preventDefault()
        setSearchOpen(true)
        return
      }
      // n / p walk this file's hunks (scroll + pulse); clamp at the ends. Both
      // land on hunk 0 from the reset (-1) state. Independent of the file set.
      if (e.key === "n" || e.key === "p") {
        if (hunkAnchors.length === 0) return
        e.preventDefault()
        const next =
          e.key === "n"
            ? Math.min(hunkAnchors.length - 1, hunkIdx + 1)
            : Math.max(0, hunkIdx - 1)
        setHunkIdx(next)
        setFocus({ line: hunkAnchors[next], nonce: Date.now() })
        return
      }
      if (navPaths.length === 0) return
      e.preventDefault()
      if (e.key === "v") toggleViewed()
      else stepFile(e.key === "j" ? 1 : -1)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [navPaths, stepFile, toggleViewed, hunkAnchors, hunkIdx])

  async function copyPatch() {
    try {
      await navigator.clipboard.writeText(result.patch ?? "")
      toast.success("Patch copied to clipboard")
    } catch {
      toast.error("Couldn't copy the patch")
    }
  }

  const findingsForSelected = effectiveSelected
    ? index.byPathLine.get(effectiveSelected)
    : undefined

  function revealNoise() {
    setShowGenerated(true)
    setShowWhitespace(true)
  }

  const prefs: ReadabilityPrefs = {
    syntax,
    setSyntax,
    wrap,
    setWrap,
    splitActive: effectiveView === "split",
    showGenerated,
    setShowGenerated,
    showWhitespace,
    setShowWhitespace,
    ignoreWhitespace,
    setIgnoreWhitespace,
    compactDensity: density === "compact",
    setCompactDensity: (v) => setDensity(v ? "compact" : "comfortable"),
    noiseCount,
  }

  // "Next section" pacing hint: shown in the end-of-file footer when advancing
  // would cross a guide section boundary.
  const nextNavPath =
    currentIndex >= 0 && currentIndex < navPaths.length - 1
      ? navPaths[currentIndex + 1]
      : null
  const nextSectionTitle =
    guideActive && nextNavPath && currentGuideSection
      ? currentGuideSection.paths.includes(nextNavPath)
        ? null
        : (guideSections.find((s) => s.paths.includes(nextNavPath))?.title ?? null)
      : null

  const diffPane = (
    <div key={effectiveSelected ?? "none"} className="h-full overflow-auto">
      {guideActive && currentGuideSection && effectiveSelected && (
        <GuideSectionBanner
          section={currentGuideSection}
          index={sectionIdx}
          total={guideSections.length}
          pos={currentGuideSection.paths.indexOf(effectiveSelected) + 1}
        />
      )}
      {allNoise ? (
        <NoiseEmptyState total={files.length} onReveal={revealNoise} />
      ) : selectedFile ? (
        <DiffFile
          file={selectedFile}
          view={effectiveView}
          fileClass={classByPath.get(effectiveSelected ?? "") ?? "meaningful"}
          isBinary={summaryByPath.get(effectiveSelected ?? "")?.binary}
          syntax={syntax}
          wrap={wrap}
          findingsByLine={findingsForSelected}
          controller={allowlist}
          focusLine={focus?.line ?? null}
          focusNonce={focus?.nonce}
          comments={comments}
          commentsByLine={commentsForSelected.byLine}
          fileComments={commentsForSelected.file}
          symbols={selectedSymbols}
          onFindReferences={repoId ? references.find : undefined}
          compact={compact}
          repoId={repoId}
          baseRef={result.base}
          compareRef={result.compare}
          isNewAddedLine={
            checkpoint.hasCheckpoint
              ? (p, c) => checkpoint.isNew(lineHash(p, c))
              : undefined
          }
          blame={blame}
          blameOn={blameOn}
          blamePending={blamePending}
          onToggleBlame={() => setBlameOn((v) => !v)}
          density={density}
          review={
            !allNoise && effectiveSelected
              ? {
                  isViewed: viewed.isViewed(effectiveSelected),
                  onToggleViewed: toggleViewed,
                  hasNext: currentIndex < navPaths.length - 1,
                  onNext: () => stepFile(1),
                  nextHint: nextSectionTitle,
                }
              : undefined
          }
        />
      ) : null}
    </div>
  )

  const fileTree = (
    <DiffFileTree
      files={files}
      selectedPath={effectiveSelected}
      onSelect={(p) => {
        onSelectPath(p)
        setFilesSheetOpen(false)
      }}
      onCollapsePanel={compact ? undefined : () => setPanelCollapsed(true)}
      findingByPath={index.byPath}
      commentByPath={comments?.byPath}
      classByPath={classByPath}
      meaningfulCount={meaningfulCount}
      showGenerated={showGenerated}
      showWhitespace={showWhitespace}
      viewed={viewed}
      newCountByPath={newCountByPath}
      headerControls={compact ? <ReadabilityMenu prefs={prefs} align="start" /> : undefined}
    />
  )

  const guidePanel = (
    <GuidePanel
      repoId={repoId ?? null}
      controller={guideCtl}
      sections={guideSections}
      files={result.files}
      selectedPath={effectiveSelected}
      onSelectPath={(p) => {
        onSelectPath(p)
        setFilesSheetOpen(false)
      }}
      viewed={viewed}
    />
  )

  // A stored guide the reviewer hasn't opened yet — the MCP hand-off moment.
  // Annotates the tab itself so the dot isn't the only carrier of the news.
  const guideReady = Boolean(guideCtl.guide) && panelTab !== "guide"

  // Left pane hosts two tabs: the file tree and the AI review guide.
  const leftPanel = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-0.5 border-b p-1">
        <Button
          size="xs"
          variant={panelTab === "files" ? "secondary" : "ghost"}
          className={cn(
            "h-6 flex-1 gap-1.5 pointer-coarse:h-9",
            panelTab !== "files" && "text-muted-foreground",
          )}
          aria-pressed={panelTab === "files"}
          onClick={() => setPanelTab("files")}
        >
          <ListTree />
          Files
        </Button>
        <Button
          size="xs"
          variant={panelTab === "guide" ? "secondary" : "ghost"}
          className={cn(
            "h-6 flex-1 gap-1.5 pointer-coarse:h-9",
            panelTab !== "guide" && "text-muted-foreground",
          )}
          aria-pressed={panelTab === "guide"}
          title={guideReady ? "A review guide is ready" : undefined}
          aria-label={guideReady ? "Guide: a review guide is ready" : undefined}
          onClick={() => setPanelTab("guide")}
        >
          <BookOpen />
          Guide
          {guideReady ? (
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-[var(--diff-add-marker)]"
            />
          ) : null}
        </Button>
      </div>
      <div className="min-h-0 flex-1">
        {panelTab === "guide" ? guidePanel : fileTree}
      </div>
    </div>
  )

  // "Viewed" toggle for the current file + n/m progress, shared by both toolbars.
  const isCurrentViewed = Boolean(
    effectiveSelected && viewed.isViewed(effectiveSelected),
  )
  const viewedButton = !allNoise && effectiveSelected && (
    <Button
      size="xs"
      variant={isCurrentViewed ? "secondary" : "ghost"}
      className={cn("gap-1.5 pointer-coarse:h-9", !isCurrentViewed && "text-muted-foreground")}
      aria-pressed={isCurrentViewed}
      title="Mark this file viewed (v)"
      onClick={toggleViewed}
    >
      <CircleCheckBig className={cn(isCurrentViewed && "text-[var(--diff-add-marker)]")} />
      Viewed
    </Button>
  )
  const reviewedCount = viewed.countIn(reviewPaths)
  const viewedProgress = reviewPaths.length > 0 && (
    <span
      className="flex items-center gap-2"
      title={`${reviewedCount} of ${reviewPaths.length} files marked viewed`}
    >
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-muted max-lg:hidden">
        <span
          className="block h-full rounded-full bg-[var(--diff-add-marker)] transition-[width] duration-300"
          style={{ width: `${(reviewedCount / reviewPaths.length) * 100}%` }}
        />
      </span>
      <span className="text-xs tabular-nums text-muted-foreground">
        {reviewedCount}/{reviewPaths.length} viewed
      </span>
    </span>
  )

  // ── Checkpoint toolbar cluster (snapshot button + age label + filter) ──────
  const checkpointButton = !allNoise && !empty && (
    <Button
      size="xs"
      variant="ghost"
      className="gap-1.5 pointer-coarse:h-9 text-muted-foreground"
      title="Snapshot current changes as reviewed baseline"
      onClick={checkpoint.record}
    >
      <Flag />
      <span className="max-sm:sr-only">Checkpoint</span>
    </Button>
  )
  const onlyNewButton = !allNoise && !empty && (
    <Button
      size="xs"
      variant={filterActive ? "secondary" : "ghost"}
      className={cn("pointer-coarse:h-9", !filterActive && "text-muted-foreground")}
      aria-pressed={filterActive}
      disabled={!checkpoint.hasCheckpoint}
      title="Show only files with changes since the checkpoint"
      onClick={() => setOnlyNew(!onlyNew)}
    >
      Only new
    </Button>
  )
  const checkpointLabel = checkpoint.hasCheckpoint && (
    <span
      className="text-xs text-muted-foreground"
      title="Added lines not present at the checkpoint are marked as new"
    >
      checkpoint {formatRelativeTime(checkpoint.at)}
      {checkpoint.totalNew > 0 && (
        <>
          {" · "}
          <span className="tabular-nums text-amber-600 dark:text-amber-500">
            {checkpoint.totalNew} new
          </span>
        </>
      )}
    </span>
  )

  // Review-inbox hand-off: appears only once EVERY navigable file (unfiltered)
  // is marked viewed and the page supplied a next repo to review.
  const allViewed =
    navigablePaths.length > 0 && viewedCount === navigablePaths.length
  const nextRepoButton =
    nextReview && allViewed ? (
      <Button
        size="xs"
        variant="default"
        className="gap-1.5 pointer-coarse:h-9"
        title={`Review ${nextReview.name}`}
        onClick={nextReview.onGo}
      >
        Next repo to review <ArrowRight />
      </Button>
    ) : null

  // Toggle button + the inline search bar (bar renders null while closed).
  const searchButton = (
    <Button
      size="xs"
      variant={searchOpen ? "secondary" : "ghost"}
      className="pointer-coarse:h-9"
      aria-pressed={searchOpen}
      title="Search diff (/)"
      aria-label="Search diff"
      onClick={() => setSearchOpen((v) => !v)}
    >
      <Search />
    </Button>
  )
  const searchBar = (
    <DiffSearch
      open={searchOpen}
      query={searchQuery}
      onQueryChange={setSearchQuery}
      onClose={() => {
        setSearchOpen(false)
        setSearchQuery("")
      }}
      results={searchResults}
      onJump={jumpToSearch}
    />
  )

  const fileStepper = navPaths.length > 1 && (
    <div className="flex items-center gap-0.5">
      <Button
        size="icon-xs"
        variant="ghost"
        className="pointer-coarse:size-9"
        title="Previous file (k)"
        aria-label="Previous file"
        disabled={currentIndex <= 0}
        onClick={() => stepFile(-1)}
      >
        <ChevronUp />
      </Button>
      <span className="min-w-10 text-center font-mono text-[11px] tabular-nums text-muted-foreground">
        {currentIndex + 1} / {navPaths.length}
      </span>
      <Button
        size="icon-xs"
        variant="ghost"
        className="pointer-coarse:size-9"
        title="Next file (j)"
        aria-label="Next file"
        disabled={currentIndex >= reviewPaths.length - 1}
        onClick={() => stepFile(1)}
      >
        <ChevronDown />
      </Button>
    </div>
  )

  const summaryChip = (
    <>
      {showPreflight && (
        <PreflightSummary
          secrets={index.secrets}
          leftovers={index.leftovers}
          ignoredCount={index.ignored.length}
          onOpen={() => setPreflightOpen(true)}
        />
      )}
      {comments && (
        <CommentsSummary
          count={comments.count}
          openCount={comments.openCount}
          onOpen={() => setCommentsOpen(true)}
        />
      )}
    </>
  )

  const preflightPanel =
    showPreflight && allowlist ? (
      <PreflightPanel
        open={preflightOpen}
        onOpenChange={setPreflightOpen}
        index={index}
        summary={preflight?.summary}
        controller={allowlist}
        onJump={jumpToFinding}
        compact={compact}
      />
    ) : null

  const commentsPanel = comments ? (
    <CommentsPanel
      open={commentsOpen}
      onOpenChange={setCommentsOpen}
      controller={comments}
      onJump={jumpToComment}
      compact={compact}
      prereview={
        repoId
          ? {
              run: async () => {
                const filed = await prereviewCtl.run({
                  base: result.base,
                  compare: result.compare,
                  mode: result.mode,
                })
                comments.refresh()
                return filed
              },
              running: prereviewCtl.running,
            }
          : undefined
      }
    />
  ) : null

  // Launched contextually from the outline (no toolbar chip — keeps the toolbar
  // uncluttered). Mounted whenever a repo id is present; renders nothing until
  // a symbol is searched.
  const referencesPanel = repoId ? (
    <ReferencesPanel
      controller={references}
      changedPaths={changedPaths}
      onJump={jumpToReference}
      compact={compact}
    />
  ) : null

  const statCounts = (
    <div className="flex shrink-0 items-center gap-2 font-mono text-xs tabular-nums">
      <span className="text-[var(--diff-add-marker)]">+{result.stats.additions}</span>
      <span className="text-[var(--diff-del-marker)]">−{result.stats.deletions}</span>
    </div>
  )

  // ── Compact: one slim status row up top, file navigation at the bottom ────
  // Top: Files · stats · status chips, with search and an overflow for the
  // rarer actions (checkpoint, only-new, copy patch). Bottom: prev · progress ·
  // viewed · next, where the thumb already is. Nothing wraps at phone widths.
  if (compact) {
    const showReviewBar = !empty && !allNoise && Boolean(effectiveSelected)
    return (
      <div className="flex h-full min-h-0 flex-col">
        {!empty && (
          <div className="flex shrink-0 select-none items-center gap-1 border-b px-2 py-1">
            <Button
              size="sm"
              variant="outline"
              className="h-8 shrink-0 gap-1.5 pointer-coarse:h-9"
              onClick={() => setFilesSheetOpen(true)}
            >
              <ListTree />
              {/* 320px phones: the count alone keeps the +/− stats unclipped. */}
              <span className="max-[359px]:sr-only">Files</span>
              <span className="text-muted-foreground tabular-nums">{result.stats.files}</span>
            </Button>

            <div className="ml-1 min-w-0 shrink overflow-hidden">{statCounts}</div>

            {result.truncated && (
              <span
                title="Diff truncated — some files or lines aren't shown"
                className="flex shrink-0 items-center px-1 text-amber-600 dark:text-amber-500"
              >
                <TriangleAlert className="size-4" />
              </span>
            )}

            <div className="ml-auto flex shrink-0 items-center">
              {summaryChip}
              <Button
                size="icon-sm"
                variant={searchOpen ? "secondary" : "ghost"}
                className="pointer-coarse:size-9"
                aria-pressed={searchOpen}
                aria-label="Search diff"
                onClick={() => {
                  if (searchOpen) setSearchQuery("")
                  setSearchOpen((v) => !v)
                }}
              >
                {searchOpen ? <X /> : <Search />}
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      size="icon-sm"
                      variant="ghost"
                      className="pointer-coarse:size-9"
                      aria-label="More diff actions"
                    />
                  }
                >
                  <MoreVertical />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-56">
                  {checkpoint.hasCheckpoint ? (
                    <DropdownMenuGroup>
                      <DropdownMenuLabel className="font-normal">
                        Checkpoint {formatRelativeTime(checkpoint.at)}
                        {checkpoint.totalNew > 0 ? (
                          <span className="text-amber-600 dark:text-amber-500">
                            {" · "}
                            {checkpoint.totalNew} new
                          </span>
                        ) : null}
                      </DropdownMenuLabel>
                    </DropdownMenuGroup>
                  ) : null}
                  {!allNoise && (
                    <DropdownMenuItem className="pointer-coarse:py-2.5" onClick={checkpoint.record}>
                      <Flag />
                      {checkpoint.hasCheckpoint ? "Move checkpoint here" : "Set checkpoint"}
                    </DropdownMenuItem>
                  )}
                  {!allNoise && (
                    <DropdownMenuCheckboxItem
                      className="pointer-coarse:py-2.5"
                      checked={filterActive}
                      disabled={!checkpoint.hasCheckpoint}
                      onCheckedChange={(v) => setOnlyNew(Boolean(v))}
                    >
                      Only files new since checkpoint
                    </DropdownMenuCheckboxItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem className="pointer-coarse:py-2.5" onClick={copyPatch}>
                    <Copy />
                    Copy raw patch
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        )}

        {!empty && searchOpen && (
          <div className="shrink-0 border-b px-2 py-1.5">
            <DiffSearch
              fill
              open={searchOpen}
              query={searchQuery}
              onQueryChange={setSearchQuery}
              onClose={() => {
                setSearchOpen(false)
                setSearchQuery("")
              }}
              results={searchResults}
              onJump={(m) => {
                jumpToSearch(m)
                setSearchOpen(false)
              }}
            />
          </div>
        )}

        {empty ? (
          <EmptyDiffState mode={result.mode} compare={result.compare} />
        ) : (
          <>
            <div className="min-h-0 flex-1">{diffPane}</div>
            <Sheet open={filesSheetOpen} onOpenChange={setFilesSheetOpen}>
              <SheetContent
                side="left"
                showCloseButton={false}
                className="w-[88%] max-w-sm gap-0 p-0"
              >
                <SheetTitle className="sr-only">Changed files</SheetTitle>
                {leftPanel}
              </SheetContent>
            </Sheet>
          </>
        )}

        {showReviewBar && (
          <div className="flex shrink-0 select-none items-center gap-1 border-t bg-background px-2 py-1.5">
            <Button
              size="icon"
              variant="ghost"
              className="size-10 shrink-0"
              aria-label="Previous file"
              disabled={currentIndex <= 0}
              onClick={() => stepFile(-1)}
            >
              <ChevronLeft />
            </Button>

            {nextRepoButton ?? (
              <button
                type="button"
                onClick={() => setFilesSheetOpen(true)}
                className="flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-md px-2 py-1 hover:bg-muted"
                aria-label={`File ${currentIndex + 1} of ${navPaths.length}, ${reviewedCount} of ${reviewPaths.length} viewed. Open file list`}
              >
                <span className="text-xs tabular-nums">
                  <span className="font-medium">{currentIndex + 1}</span>
                  <span className="text-muted-foreground"> / {navPaths.length}</span>
                  {reviewPaths.length > 0 && (
                    <span className="text-muted-foreground">
                      {" · "}
                      {reviewedCount} viewed
                    </span>
                  )}
                </span>
                {reviewPaths.length > 0 && (
                  <span className="h-1 w-full max-w-40 overflow-hidden rounded-full bg-muted">
                    <span
                      className="block h-full rounded-full bg-[var(--diff-add-marker)] transition-[width] duration-300"
                      style={{ width: `${(reviewedCount / reviewPaths.length) * 100}%` }}
                    />
                  </span>
                )}
              </button>
            )}

            <Button
              size="sm"
              variant={isCurrentViewed ? "secondary" : "outline"}
              className="h-10 shrink-0 gap-1.5 px-3"
              aria-pressed={isCurrentViewed}
              onClick={toggleViewed}
            >
              <CircleCheckBig className={cn(isCurrentViewed && "text-[var(--diff-add-marker)]")} />
              Viewed
            </Button>

            <Button
              size="icon"
              variant="ghost"
              className="size-10 shrink-0"
              aria-label="Next file"
              disabled={currentIndex >= navPaths.length - 1}
              onClick={() => stepFile(1)}
            >
              <ChevronRight />
            </Button>
          </div>
        )}

        {preflightPanel}
        {commentsPanel}
        {referencesPanel}
      </div>
    )
  }

  // ── Desktop: file panel + resizable diff, full toolbar + truncation banner ─
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex select-none flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
        {panelCollapsed && !empty ? (
          <Button
            size="icon-xs"
            variant="ghost"
            title="Show file panel"
            aria-label="Show file panel"
            onClick={() => setPanelCollapsed(false)}
          >
            <PanelLeftOpen />
          </Button>
        ) : null}

        <div className="flex items-center gap-3 text-xs">
          <span
            className="text-[13px] font-medium tabular-nums"
            title={
              noiseCount > 0
                ? `${meaningfulCount} of ${files.length} meaningful (rest is generated/lockfile/whitespace noise)`
                : undefined
            }
          >
            {result.stats.files} {result.stats.files === 1 ? "file" : "files"}
          </span>
          <span className="font-mono tabular-nums text-[var(--diff-add-marker)]">
            +{result.stats.additions}
          </span>
          <span className="font-mono tabular-nums text-[var(--diff-del-marker)]">
            −{result.stats.deletions}
          </span>
          {viewedProgress}
          {checkpointLabel}
          {summaryChip}
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {searchBar}
          {searchButton}
          {nextRepoButton}
          {fileStepper}
          <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
          {viewedButton}
          {checkpointButton}
          {onlyNewButton}
          <span aria-hidden className="mx-0.5 h-4 w-px shrink-0 bg-border" />
          <ReadabilityMenu prefs={prefs} />
          <Button
            size="icon-xs"
            variant="ghost"
            className="text-muted-foreground"
            title="Copy raw patch"
            aria-label="Copy raw patch"
            onClick={copyPatch}
            disabled={empty}
          >
            <Copy />
          </Button>
          <div className="inline-flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5">
            <Button
              size="xs"
              variant={view === "unified" ? "secondary" : "ghost"}
              aria-pressed={view === "unified"}
              onClick={() => setView("unified")}
            >
              <AlignJustify /> Unified
            </Button>
            <Button
              size="xs"
              variant={view === "split" ? "secondary" : "ghost"}
              aria-pressed={view === "split"}
              onClick={() => setView("split")}
            >
              <Columns2 /> Split
            </Button>
          </div>
        </div>
      </div>

      {result.truncated && !empty && (
        <div className="flex items-center gap-2 border-b bg-amber-500/10 px-3 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          <TriangleAlert className="size-3.5 shrink-0" />
          This diff was truncated because it exceeds the size limit — some files
          or lines are not shown.
        </div>
      )}

      {empty ? (
        <EmptyDiffState mode={result.mode} compare={result.compare} />
      ) : panelCollapsed ? (
        diffPane
      ) : (
        <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
          <ResizablePanel defaultSize="26%" minSize="15%" maxSize="50%">
            {leftPanel}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize="74%" className="min-w-0">
            {diffPane}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}

      {preflightPanel}
      {commentsPanel}
      {referencesPanel}
    </div>
  )
}
