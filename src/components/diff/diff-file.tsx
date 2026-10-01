"use client"

import {
  Fragment,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  ArrowRight,
  Binary,
  Braces,
  Check,
  ChevronDown,
  ChevronsDown,
  ChevronUp,
  CircleCheckBig,
  Copy,
  EllipsisVertical,
  Eye,
  EyeOff,
  FileText,
  FilterX,
  History,
  Loader2,
  MessageSquare,
  MessageSquarePlus,
  Pencil,
  RotateCcw,
  ShieldAlert,
  Sparkles,
  Trash2,
  TriangleAlert,
} from "lucide-react"
import { toast } from "sonner"

import type {
  BlameLine,
  PreflightFinding,
  PreflightSeverity,
  SymbolNode,
} from "@/lib/types"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Textarea } from "@/components/ui/textarea"
import type { PreflightController } from "@/hooks/use-preflight"
import { useBlob } from "@/hooks/use-blob"
import type { CommentsController } from "@/hooks/use-comments"
import { useIsMac } from "@/hooks/use-is-mac"

import {
  commentState,
  isAi,
  lineLabel,
  type ResolvedComment,
} from "./comment-meta"
import { LineTokens } from "./diff-tokens"
import { ImageDiff } from "./image-diff"
import {
  FileStatusIcon,
  NoiseBadge,
  chunkAnchorLine,
  fileStatus,
  filePath,
  type ParsedChange,
  type ParsedFile,
} from "./file-meta"
import { AGE_TINT, ageBucket, relativeDate } from "./blame-meta"
import type { FileClass } from "./noise"
import { SEVERITY_BG, SEVERITY_BORDER, SEVERITY_TEXT } from "./preflight-meta"
import { computeTouched, enclosingPath, type SymbolTouch } from "./symbol-meta"
import { SymbolOutline } from "./symbol-outline"
import {
  useBlobHighlight,
  useDiffHighlight,
  type DiffHighlight,
} from "./use-diff-highlight"

/** Static severity glyph (ShieldAlert for blockers, TriangleAlert for warnings). */
function SeverityIcon({
  severity,
  className,
}: {
  severity: PreflightSeverity
  className?: string
}) {
  return severity === "blocker" ? (
    <ShieldAlert className={className} />
  ) : (
    <TriangleAlert className={className} />
  )
}

const gutterCls =
  "w-[1%] select-none whitespace-nowrap px-2 text-right align-top tabular-nums text-muted-foreground"
// transition-shadow so the jump-to-line pulse fades the same way the inline
// finding/comment cards do instead of hard-snapping on and off.
const contentCls = "whitespace-pre px-2 align-top [tab-size:2] transition-shadow"

/** parse-diff re-emits git's no-newline marker as a duplicate add/del change on
 *  the SAME ln — it is a note, not a code line. */
const NO_NEWLINE = "\\ No newline at end of file"
function isNoNewline(c: ParsedChange | null | undefined): boolean {
  return c != null && c.content === NO_NEWLINE
}

// ── Incremental rendering ─────────────────────────────────────────────────────
// Very large single-file diffs render only a leading slice; the rest reveals in
// whole-hunk steps. Reveal boundaries always fall on hunk boundaries — a hidden
// hunk can't be partially shown.
const INCREMENTAL_ROW_THRESHOLD = 1500
const INITIAL_HUNK_LIMIT = 30
const INITIAL_ROW_LIMIT = 1200
const REVEAL_CHUNK_ROWS = 1200

/**
 * Pure per-file plan of how many whole chunks are visible at each reveal step.
 * Index 0 is the initial slice (largest k whose first-k rows ≤ INITIAL_ROW_LIMIT,
 * clamped to [1, INITIAL_HUNK_LIMIT]); each later step adds chunks until roughly
 * REVEAL_CHUNK_ROWS more rows show or all hunks are revealed. The final entry is
 * always file.chunks.length.
 */
function chunkCutoffs(file: ParsedFile): number[] {
  const counts = file.chunks.map((c) => c.changes.length)
  const total = counts.length
  let initial = 0
  let rows = 0
  for (let i = 0; i < total && i < INITIAL_HUNK_LIMIT; i++) {
    if (initial > 0 && rows + counts[i] > INITIAL_ROW_LIMIT) break
    rows += counts[i]
    initial = i + 1
  }
  initial = Math.max(1, Math.min(initial, INITIAL_HUNK_LIMIT))
  const cutoffs = [initial]
  let visible = initial
  while (visible < total) {
    let added = 0
    while (visible < total && added < REVEAL_CHUNK_ROWS) {
      added += counts[visible]
      visible++
    }
    cutoffs.push(visible)
  }
  return cutoffs
}

// ── Context expansion (GitHub-style) ──────────────────────────────────────────
// Gap g addresses the pure-context gap BEFORE chunk g; g === chunks.length is
// the gap after the last hunk. Each expander click reveals EXPAND_STEP more
// lines from one edge of a gap, synthesized from the compare-side blob.
const EXPAND_STEP = 20

type NormalRow = Extract<ParsedChange, { type: "normal" }>

/** Per-gap render plan: synthesized context rows plus the separator's state. */
type GapView = {
  /** Revealed rows adjacent to the previous hunk / file start (top edge). */
  topRows: NormalRow[]
  /** Revealed rows adjacent to the next hunk / EOF (bottom edge). */
  bottomRows: NormalRow[]
  /** Hidden middle line count; null = unknown until the blob loads (trail). */
  hidden: number | null
  kind: "lead" | "mid" | "trail"
  state: "ready" | "loading" | "unavailable"
}

type ExpansionLayer = {
  gaps: Map<number, GapView>
  onExpand: (g: number, edge: "top" | "bottom" | "all") => void
}

/**
 * Gap geometry + revealed rows for the RENDERED chunk slice. In a pure-context
 * gap old and new line numbers advance in lockstep, so the old number of
 * synthesized new line N is oldFrom + (N − newFrom). `suppressTrailing` is set
 * while incremental rendering hides trailing hunks — the C5 "Show more lines"
 * control owns that boundary, so no after-last expander may render.
 */
function computeGaps(
  file: ParsedFile,
  expansions: Map<number, { top: number; bottom: number }>,
  blob: { lines: string[]; error: boolean; isLoading: boolean; loaded: boolean },
  suppressTrailing: boolean,
): Map<number, GapView> {
  const chunks = file.chunks
  const gaps = new Map<number, GapView>()
  // Trailing newline: "a\nb\n" splits to ["a","b",""] — two real lines.
  const totalNew = blob.loaded
    ? blob.lines.length > 0 && blob.lines[blob.lines.length - 1] === ""
      ? blob.lines.length - 1
      : blob.lines.length
    : null
  for (let g = 0; g <= chunks.length; g++) {
    const kind: GapView["kind"] = g === 0 ? "lead" : g === chunks.length ? "trail" : "mid"
    if (kind === "trail" && suppressTrailing) continue
    let newFrom: number
    let oldFrom: number
    let newTo: number
    if (g === 0) {
      newFrom = 1
      oldFrom = 1
      newTo = chunks[0].newStart - 1
    } else {
      const prev = chunks[g - 1]
      newFrom = prev.newStart + prev.newLines
      oldFrom = prev.oldStart + prev.oldLines
      newTo = g < chunks.length ? chunks[g].newStart - 1 : (totalNew ?? newFrom - 1)
    }
    if (kind === "trail" && totalNew == null) {
      // EOF unknown until the blob loads — offer the separator optimistically;
      // the first click triggers the fetch, and an empty gap then disappears.
      if (!blob.error) {
        gaps.set(g, {
          topRows: [],
          bottomRows: [],
          hidden: null,
          kind,
          state: blob.isLoading ? "loading" : "ready",
        })
      }
      continue
    }
    if (newTo < newFrom) continue
    const size = newTo - newFrom + 1
    const exp = expansions.get(g) ?? { top: 0, bottom: 0 }
    // Blob shorter than the diff claims (truncated / mismatch) → no context.
    const unavailable = blob.error || (totalNew != null && newTo > totalNew)
    const state: GapView["state"] = unavailable
      ? "unavailable"
      : blob.isLoading
        ? "loading"
        : "ready"
    let top = Math.min(exp.top, size)
    let bottom = Math.min(exp.bottom, size - top)
    if (top + bottom >= size) {
      top = size
      bottom = 0
    }
    const canShow = blob.loaded && !unavailable
    const makeRows = (from: number, count: number): NormalRow[] => {
      const rows: NormalRow[] = []
      for (let i = 0; i < count; i++) {
        const ln2 = from + i
        rows.push({
          type: "normal",
          normal: true,
          ln1: oldFrom + (ln2 - newFrom),
          ln2,
          content: " " + (blob.lines[ln2 - 1] ?? ""),
        })
      }
      return rows
    }
    gaps.set(g, {
      topRows: canShow ? makeRows(newFrom, top) : [],
      bottomRows: canShow ? makeRows(newTo - bottom + 1, bottom) : [],
      hidden: canShow ? size - top - bottom : size,
      kind,
      state,
    })
  }
  return gaps
}

/**
 * The clickable gap separator row. `colSpan` is a literal at each call site
 * (3 unified, 2 per split side). In split view only the LEFT side hosts the
 * interactive controls; the right renders an invisible mirror for alignment.
 */
function ExpanderRow({
  g,
  gap,
  colSpan,
  onExpand,
  mirror,
}: {
  g: number
  gap: GapView
  colSpan: number
  onExpand: ExpansionLayer["onExpand"]
  mirror?: boolean
}) {
  const { kind, hidden, state } = gap
  const btnCls =
    "flex items-center justify-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none pointer-coarse:min-h-9 pointer-coarse:min-w-9 pointer-coarse:px-2.5 pointer-coarse:py-1.5"
  const edgeButton = (
    edge: "top" | "bottom",
    Icon: typeof ChevronUp,
    title: string,
  ) => (
    <button
      type="button"
      className={btnCls}
      title={title}
      aria-label={title}
      disabled={mirror}
      tabIndex={mirror ? -1 : undefined}
      onClick={() => onExpand(g, edge)}
    >
      <Icon className="size-3 shrink-0" />
    </button>
  )
  return (
    <tr className="diff-hunk-header">
      <td
        colSpan={colSpan}
        className="select-none border-y border-dashed px-2 py-0 text-[11px]"
      >
        <div
          aria-hidden={mirror}
          className={cn("flex min-h-6 items-center gap-1", mirror && "invisible")}
        >
          {state === "loading" ? (
            <span className="flex items-center gap-1.5 py-0.5 text-muted-foreground">
              <Loader2 className="size-3 shrink-0 animate-spin" />
              Loading context…
            </span>
          ) : state === "unavailable" ? (
            <span className="py-0.5 text-muted-foreground" title="Context unavailable">
              Context unavailable
            </span>
          ) : (
            <>
              {kind === "mid" ? (
                <>
                  {edgeButton("top", ChevronDown, "Expand down from top")}
                  {edgeButton("bottom", ChevronUp, "Expand up from bottom")}
                </>
              ) : kind === "lead" ? (
                edgeButton("bottom", ChevronUp, "Expand up")
              ) : (
                edgeButton("top", ChevronDown, "Expand down")
              )}
              {hidden != null && hidden <= EXPAND_STEP ? (
                <button
                  type="button"
                  className={btnCls}
                  disabled={mirror}
                  tabIndex={mirror ? -1 : undefined}
                  onClick={() => onExpand(g, "all")}
                >
                  {hidden === 1
                    ? "Expand 1 line"
                    : `Expand all ${hidden.toLocaleString()} lines`}
                </button>
              ) : hidden != null ? (
                <span className="py-0.5 text-muted-foreground">
                  {hidden.toLocaleString()} hidden lines
                </span>
              ) : null}
            </>
          )}
        </div>
      </td>
    </tr>
  )
}

// ── Image diff (binary image files) ───────────────────────────────────────────
const IMAGE_EXT = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "bmp",
  "avif",
])

function isImagePath(p: string): boolean {
  const dot = p.lastIndexOf(".")
  return dot !== -1 && IMAGE_EXT.has(p.slice(dot + 1).toLowerCase())
}

/** Highest severity present among a line's findings. */
function topSeverity(findings: PreflightFinding[]): PreflightSeverity {
  return findings.some((f) => f.severity === "blocker") ? "blocker" : "warning"
}

/** Muted "DiffViewer › copyPatch" enclosing-symbol breadcrumb for a hunk. */
function HunkCrumb({ path }: { path: string[] }) {
  if (path.length === 0) return null
  return (
    <span className="ml-2 inline-flex items-center gap-1 align-middle font-sans text-muted-foreground/80">
      <Braces className="size-3 shrink-0 opacity-70" />
      {path.map((name, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="opacity-50">›</span>}
          <span className="max-w-[16ch] truncate">{name}</span>
        </Fragment>
      ))}
    </span>
  )
}

// ── Pre-flight inline finding rendering ───────────────────────────────────────
function FindingSnippet({ finding }: { finding: PreflightFinding }) {
  const hl = finding.severity === "blocker" ? "bg-destructive/20" : "bg-amber-500/25"
  if (!finding.match) return <code className="break-all">{finding.snippet}</code>
  const { start, end } = finding.match
  return (
    <code className="break-all">
      {finding.snippet.slice(0, start)}
      <span className={cn("rounded-sm px-0.5", hl)}>
        {finding.snippet.slice(start, end)}
      </span>
      {finding.snippet.slice(end)}
    </code>
  )
}

function FindingActions({
  finding,
  controller,
}: {
  finding: PreflightFinding
  controller: PreflightController
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="shrink-0 pointer-coarse:size-9"
            aria-label="Finding actions"
          />
        }
      >
        <EllipsisVertical />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => controller.ignore(finding)}>
          <EyeOff />
          Ignore this finding
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => controller.ignoreRule(finding)}>
          <FilterX />
          Ignore this rule in this repo
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The inline finding card(s) shown directly beneath a flagged added line
 * (GitHub review-thread pattern). `mirror` renders an invisible, equal-height
 * copy so the split view's two tables stay vertically aligned.
 */
function InlineFindings({
  findings,
  controller,
  pulse,
  innerRef,
  mirror,
}: {
  findings: PreflightFinding[]
  controller?: PreflightController
  pulse?: boolean
  innerRef?: (el: HTMLDivElement | null) => void
  mirror?: boolean
}) {
  return (
    <div
      ref={innerRef}
      aria-hidden={mirror}
      className={cn(
        // Sticky + container-width cap: keeps the cards inside the visible pane
        // even when long code lines stretch the table far past the viewport.
        "sticky left-0 flex max-w-[100cqw] flex-col gap-1 px-2 py-1.5 font-sans whitespace-normal",
        mirror && "invisible",
      )}
    >
      {findings.map((f) => {
        return (
          <div
            key={f.id}
            className={cn(
              "flex items-start gap-2 rounded-md border-l-2 bg-card px-2 py-1.5 text-xs shadow-sm ring-1 ring-border transition-shadow",
              SEVERITY_BORDER[f.severity],
              pulse && "ring-2 ring-ring",
            )}
          >
            <SeverityIcon
              severity={f.severity}
              className={cn("mt-0.5 size-3.5 shrink-0", SEVERITY_TEXT[f.severity])}
            />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{f.title}</div>
              <div className="text-muted-foreground">{f.detail}</div>
              <div
                className={cn(
                  "mt-1 overflow-hidden rounded px-1.5 py-0.5 font-mono leading-snug",
                  SEVERITY_BG[f.severity],
                )}
              >
                <FindingSnippet finding={f} />
              </div>
            </div>
            {controller && !mirror && (
              <FindingActions finding={f} controller={controller} />
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Review-comment inline rendering ───────────────────────────────────────────

/** A draft comment being composed inline (single line or a selected range). */
type CommentDraft = { anchor: number; startLine: number; endLine: number }

/**
 * Lifted "which saved note is open for editing" state. Split view mounts every
 * comment card twice (the left copy mirrored), so a card-local editor toggle
 * makes one column taller than the other — the same reason the draft composer's
 * state lives up here rather than inside the editor.
 */
type EditLayer = {
  /** The note currently open for editing, with its in-progress body. */
  open: { id: string; body: string } | null
  onStart: (c: ResolvedComment) => void
  onBody: (body: string) => void
  onSave: () => void
  onCancel: () => void
}

/** Everything the row renderers need to host the comment affordances. */
type CommentLayer = {
  controller: CommentsController
  /** Resolved comments to render inline, keyed by their (end) anchor line. */
  byLine?: Map<number, ResolvedComment[]>
  draft: CommentDraft | null
  /**
   * True while the pointer is still down (click-drag range selection). The
   * range highlight shows immediately; the composer mounts only on release,
   * so mid-drag nothing pops in or shifts the rows under the cursor.
   */
  selecting: boolean
  draftBody: string
  onSelectStart: (line: number, shift: boolean) => void
  onSelectMove: (line: number) => void
  /** Keyboard-only entry point: open a single-line draft with no drag to wait on. */
  onComposeAt: (line: number) => void
  onDraftBody: (body: string) => void
  onSaveDraft: () => void
  onCancelDraft: () => void
  pulseLine: number | null
  registerRow: (line: number, el: HTMLDivElement | null) => void
  edit: EditLayer
}

function draftLabel(draft: CommentDraft): string {
  return draft.endLine > draft.startLine
    ? `New note · L${draft.startLine}–${draft.endLine}`
    : `New note · L${draft.startLine}`
}

/** Controlled note composer (textarea + Save/Cancel). Used for new + edit. */
function NoteEditor({
  label,
  value,
  onChange,
  onSave,
  onCancel,
  mirror,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  onSave: () => void
  onCancel: () => void
  mirror?: boolean
}) {
  const mod = useIsMac() ? "⌘" : "Ctrl"
  return (
    <div className="flex flex-col gap-2 rounded-md border bg-card px-2.5 py-2 text-xs shadow-sm ring-1 ring-border">
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <MessageSquarePlus className="size-3.5 shrink-0" />
        <span className="text-[11px] font-medium">{label}</span>
      </div>
      <Textarea
        autoFocus={!mirror}
        tabIndex={mirror ? -1 : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Leave a note for the AI agent…"
        rows={2}
        className="min-h-14 text-sm"
        onKeyDown={(e) => {
          if (mirror) return
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            if (value.trim()) onSave()
          } else if (e.key === "Escape") {
            e.preventDefault()
            onCancel()
          }
        }}
      />
      <div className="flex items-center justify-end gap-1.5">
        <span className="mr-auto text-[10px] text-muted-foreground/80 max-sm:hidden">
          {mod}↵ save · Esc cancel
        </span>
        <Button
          size="xs"
          variant="ghost"
          className="pointer-coarse:h-9"
          onClick={onCancel}
          tabIndex={mirror ? -1 : undefined}
        >
          Cancel
        </Button>
        <Button
          size="xs"
          className="gap-1 pointer-coarse:h-9"
          disabled={!value.trim()}
          onClick={onSave}
          tabIndex={mirror ? -1 : undefined}
        >
          <Check />
          Save
        </Button>
      </div>
    </div>
  )
}

/** Edit composer that owns its own draft state (existing notes + file notes). */
function LocalNoteEditor({
  label,
  initialBody,
  onSave,
  onCancel,
}: {
  label: string
  initialBody?: string
  onSave: (body: string) => void
  onCancel: () => void
}) {
  const [body, setBody] = useState(initialBody ?? "")
  return (
    <NoteEditor
      label={label}
      value={body}
      onChange={setBody}
      onSave={() => {
        if (body.trim()) onSave(body)
      }}
      onCancel={onCancel}
    />
  )
}

/** A single saved comment card (body + edit/delete; toggles to an editor). */
function InlineCommentCard({
  comment,
  controller,
  edit,
  pulse,
  mirror,
}: {
  comment: ResolvedComment
  controller: CommentsController
  edit: EditLayer
  pulse?: boolean
  mirror?: boolean
}) {
  // Both sides render the editor with the SAME value, so the field-sizing
  // textarea grows identically and the split columns never drift.
  const open = edit.open
  if (open && open.id === comment.id) {
    return (
      <NoteEditor
        label={`Edit note · ${lineLabel(comment)}`}
        value={open.body}
        onChange={mirror ? () => {} : edit.onBody}
        onSave={mirror ? () => {} : edit.onSave}
        onCancel={mirror ? () => {} : edit.onCancel}
        mirror={mirror}
      />
    )
  }

  const state = commentState(comment)
  const resolved = state === "resolved"

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border-l-2 border-primary/50 bg-card px-2 py-1.5 text-xs shadow-sm ring-1 ring-border transition-shadow",
        pulse && "ring-2 ring-ring",
        resolved && "opacity-80",
      )}
    >
      <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="mb-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <span className="font-mono">{lineLabel(comment)}</span>
          {state !== "open" && (
            <span
              className={cn(
                "shrink-0 rounded-full px-1.5 text-[10px] font-medium capitalize",
                resolved
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
              )}
            >
              {state}
            </span>
          )}
          {isAi(comment) && (
            <span className="flex items-center gap-0.5 text-[10px]">
              <Sparkles className="size-2.5" />
              AI
            </span>
          )}
          {comment.updatedAt && <span>· edited</span>}
        </div>
        <p
          className={cn(
            "whitespace-pre-wrap break-words text-foreground",
            resolved && "text-muted-foreground opacity-75",
          )}
        >
          {comment.body}
        </p>
        {comment.stateNote && (
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] italic text-muted-foreground">
            agent: {comment.stateNote}
          </p>
        )}
      </div>
      {!mirror && (
        <div className="flex shrink-0">
          {resolved ? (
            <Button
              size="icon-xs"
              variant="ghost"
              className="pointer-coarse:size-9"
              title="Reopen"
              aria-label="Reopen note"
              onClick={() => controller.setState(comment.id, "open")}
            >
              <RotateCcw />
            </Button>
          ) : (
            <Button
              size="icon-xs"
              variant="ghost"
              className="pointer-coarse:size-9"
              title="Mark resolved"
              aria-label="Mark resolved"
              onClick={() => controller.setState(comment.id, "resolved")}
            >
              <Check />
            </Button>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            className="pointer-coarse:size-9"
            title="Edit note"
            aria-label="Edit note"
            onClick={() => edit.onStart(comment)}
          >
            <Pencil />
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            className="pointer-coarse:size-9"
            title="Delete note"
            aria-label="Delete note"
            onClick={() => controller.remove(comment.id)}
          >
            <Trash2 />
          </Button>
        </div>
      )}
    </div>
  )
}

/** Wrapper around a line's comment cards (mirror-aware for split alignment). */
function InlineComments({
  comments,
  controller,
  edit,
  pulse,
  innerRef,
  mirror,
}: {
  comments: ResolvedComment[]
  controller: CommentsController
  edit: EditLayer
  pulse?: boolean
  innerRef?: (el: HTMLDivElement | null) => void
  mirror?: boolean
}) {
  return (
    <div
      ref={innerRef}
      aria-hidden={mirror}
      className={cn(
        // Sticky + container-width cap: keeps the cards inside the visible pane
        // even when long code lines stretch the table far past the viewport.
        "sticky left-0 flex max-w-[100cqw] flex-col gap-1 px-2 py-1.5 font-sans whitespace-normal",
        mirror && "invisible",
      )}
    >
      {comments.map((c) => (
        <InlineCommentCard
          key={c.id}
          comment={c}
          controller={controller}
          edit={edit}
          pulse={pulse}
          mirror={mirror}
        />
      ))}
    </div>
  )
}

/**
 * A single "add comment" cue pinned to the new-side gutter, shown only on the
 * row currently hovered or focused (never persistently — the selection range is
 * conveyed by the row highlight). Pointer input is still owned by the
 * line-number cell (click / shift-click / drag); this exists so the keyboard has
 * any path at all to a line note.
 */
function CommentButton({
  line,
  onComposeAt,
}: {
  line: number
  onComposeAt: (line: number) => void
}) {
  return (
    <button
      type="button"
      aria-label={`Comment on line ${line}`}
      // Keyboard only — a mouse press is already served by the cell's pointerdown
      // drag path, so there is deliberately no onClick to fire twice.
      onKeyDown={(e) => {
        if (e.key !== "Enter" && e.key !== " ") return
        e.preventDefault()
        e.stopPropagation()
        onComposeAt(line)
      }}
      className={cn(
        "absolute top-1/2 right-0 z-10 flex size-4 -translate-y-1/2 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm",
        "opacity-0 transition-opacity group-hover/cmrow:opacity-100",
        "outline-none focus-visible:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50",
      )}
    >
      <MessageSquarePlus className="size-3" />
    </button>
  )
}

/** Pair del/add runs side-by-side for the split view. */
function pairChanges(
  changes: ParsedChange[]
): { left: ParsedChange | null; right: ParsedChange | null }[] {
  const rows: { left: ParsedChange | null; right: ParsedChange | null }[] = []
  let i = 0
  while (i < changes.length) {
    const c = changes[i]
    if (c.type === "normal") {
      rows.push({ left: c, right: c })
      i++
      continue
    }
    const dels: ParsedChange[] = []
    const adds: ParsedChange[] = []
    while (i < changes.length && changes[i].type === "del") {
      dels.push(changes[i])
      i++
    }
    while (i < changes.length && changes[i].type === "add") {
      adds.push(changes[i])
      i++
    }
    const n = Math.max(dels.length, adds.length)
    for (let k = 0; k < n; k++) {
      rows.push({ left: dels[k] ?? null, right: adds[k] ?? null })
    }
  }
  return rows
}

type PreflightProps = {
  findingsByLine?: Map<number, PreflightFinding[]>
  controller?: PreflightController
  pulseLine?: number | null
  registerRow?: (line: number, el: HTMLDivElement | null) => void
  /** Register a new-side line's content cell so the outline can scroll to it. */
  registerLine?: (line: number, el: HTMLElement | null) => void
  /** Per-chunk enclosing-symbol breadcrumb path (parallel to file.chunks). */
  crumbs?: string[][]
  /** Syntax tokens + word-diff ranges for the visible file (null = plain). */
  highlight?: DiffHighlight
  /** Optional review-comment layer (add affordance + inline notes). */
  comment?: CommentLayer
  /** Optional context-expansion layer (gap separators + synthesized rows). */
  expansion?: ExpansionLayer
  /** Soft-wrap long lines instead of horizontal scrolling. */
  wrap?: boolean
  /** File path — pairs with isNewAddedLine for checkpoint "new" markers. */
  path?: string
  /** True when an added line is new since the review checkpoint (display only). */
  isNewAddedLine?: (path: string, content: string) => boolean
  /** Optional NEW-side blame gutter: sha column + recency tint (display only). */
  blame?: { active: boolean; lineFor: (n: number) => BlameLine | undefined }
  /** Code row density: comfortable (13px/leading-6) vs compact (12px/leading-5). */
  density?: "comfortable" | "compact"
}

/** Shared table typography per density; touch always gets the roomy variant. */
function tableCls(density?: "comfortable" | "compact"): string {
  return cn(
    "w-full border-collapse font-mono pointer-coarse:text-[13px] pointer-coarse:leading-6",
    density === "compact" ? "text-xs leading-5" : "text-[13px] leading-6",
  )
}

/** Column class for the blame gutter (shared by unified + the right split side). */
const blameCls =
  "w-[1%] select-none whitespace-nowrap px-1.5 align-top font-mono text-[10px] text-muted-foreground pointer-coarse:text-[11px]"

/**
 * The NEW-side blame gutter cell. `showSha` is decided by the row loop so runs
 * of the same commit collapse to one visible short-sha (grouped); the tint still
 * paints every row. A row with no blame data → empty untinted cell.
 */
function BlameCell({
  line,
  showSha,
}: {
  line: BlameLine | undefined
  showSha: boolean
}) {
  return (
    <td
      className={cn(blameCls, line && AGE_TINT[ageBucket(line.dateIso)])}
      title={
        line
          ? `${line.author} · ${relativeDate(line.dateIso)} · ${line.summary}`
          : undefined
      }
    >
      {line && showSha ? line.shortSha : ""}
    </td>
  )
}

/** New-side line number for a change, or null for deletions. */
function newSideLine(change: ParsedChange | null): number | null {
  if (!change) return null
  if (change.type === "add") return change.ln
  if (change.type === "normal") return change.ln2
  return null
}

type BlameLayer = NonNullable<PreflightProps["blame"]>

/**
 * Pre-render NEW-side blame cells for a run of rows, collapsing same-sha runs to
 * a single visible short-sha. Index-aligned to `changes`; a row with no new-side
 * line / no blame gets an empty untinted cell. Module-level (not a component) so
 * the grouping accumulator can be reassigned without the render-scope lint rule.
 */
function blameCellsFor(
  changes: (ParsedChange | null)[],
  blame: PreflightProps["blame"],
): (ReactNode | undefined)[] {
  if (!blame?.active) return changes.map(() => undefined)
  const lineFor = blame.lineFor
  let prevSha: string | undefined
  return changes.map((change, i) => {
    const n = change ? newSideLine(change) : null
    const bl = n != null ? lineFor(n) : undefined
    const showSha = bl != null && bl.sha !== prevSha
    if (bl != null) prevSha = bl.sha
    return <BlameCell key={i} line={bl} showSha={showSha} />
  })
}

/**
 * One unified-view diff row (plus its inline finding/comment/draft rows).
 * `synthetic` marks expanded-context rows: display-only — comment affordances
 * are stripped, and findings/word-diff can never match a synthesized 'normal'.
 */
function UnifiedChangeRow({
  change,
  synthetic,
  blameCell,
  findingsByLine,
  controller,
  pulseLine,
  registerRow,
  registerLine,
  highlight,
  comment: commentProp,
  wrap,
  path,
  isNewAddedLine,
}: {
  change: ParsedChange
  synthetic?: boolean
  /** Pre-rendered NEW-side blame gutter cell (grouping decided by the caller). */
  blameCell?: ReactNode
} & PreflightProps) {
  const comment = synthetic ? undefined : commentProp
  const draft = comment?.draft
  const isAdd = change.type === "add"
  const isDel = change.type === "del"
  // The no-newline marker duplicates the previous change's type and ln — render
  // it as an unnumbered note so it can't re-anchor comments or re-tint a row.
  if (isNoNewline(change)) {
    return (
      <tr>
        {blameCell}
        <td className={gutterCls} />
        <td className={cn(gutterCls, "border-r")} />
        <td className={cn(contentCls, "w-full text-muted-foreground/70")}>
          {"  No newline at end of file"}
        </td>
      </tr>
    )
  }
  const oldLn =
    change.type === "normal"
      ? change.ln1
      : change.type === "del"
        ? change.ln
        : ""
  const newLn =
    change.type === "normal"
      ? change.ln2
      : change.type === "add"
        ? change.ln
        : ""
  const findings =
    isAdd && typeof newLn === "number"
      ? findingsByLine?.get(newLn)
      : undefined
  const sev = findings && findings.length ? topSeverity(findings) : null
  // Checkpoint marker — REAL added lines only (synthetic context is display-only
  // and can never carry it; its rows are type 'normal' anyway).
  const isNew =
    isAdd && !synthetic && path != null && isNewAddedLine != null
      ? isNewAddedLine(path, change.content)
      : false
  const newLnNum = typeof newLn === "number" ? newLn : null
  const lineComments =
    newLnNum != null ? comment?.byLine?.get(newLnNum) : undefined
  const inDraft =
    draft != null &&
    newLnNum != null &&
    newLnNum >= draft.startLine &&
    newLnNum <= draft.endLine
  const showDraftHere =
    draft != null && !comment?.selecting && newLnNum === draft.endLine
  return (
    <Fragment>
      <tr
        className={cn(
          isAdd && "diff-line-add",
          isDel && "diff-line-del",
          comment && newLnNum != null && "group/cmrow",
        )}
      >
        {blameCell}
        <td
          className={cn(
            gutterCls,
            isAdd && "diff-gutter-add",
            isDel && "diff-gutter-del",
            sev && cn("border-l-2", SEVERITY_BORDER[sev]),
          )}
        >
          {oldLn}
        </td>
        <td
          className={cn(
            gutterCls,
            "relative border-r",
            isAdd && "diff-gutter-add",
            isDel && "diff-gutter-del",
            // Findings own border-l-2; with both, only the dot marks "new".
            isNew && !sev && "border-l-2 border-amber-500/70",
            comment && newLnNum != null && "cursor-pointer hover:text-foreground",
          )}
          onPointerDown={
            comment && newLnNum != null
              ? (e) => {
                  if (e.button !== 0) return
                  e.preventDefault()
                  comment.onSelectStart(newLnNum, e.shiftKey)
                }
              : undefined
          }
          onPointerEnter={
            comment && newLnNum != null
              ? () => comment.onSelectMove(newLnNum)
              : undefined
          }
          title={
            comment && newLnNum != null
              ? "Click, shift-click, or drag the line numbers to comment"
              : undefined
          }
        >
          {newLn}
          {isNew && (
            <span
              aria-hidden
              title="New since checkpoint"
              className="absolute left-0.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-amber-500"
            />
          )}
          {comment && newLnNum != null && (
            <CommentButton line={newLnNum} onComposeAt={comment.onComposeAt} />
          )}
        </td>
        <td
          ref={
            newLnNum != null
              ? (el) => registerLine?.(newLnNum, el)
              : undefined
          }
          className={cn(
            contentCls,
            "w-full",
            wrap && "whitespace-pre-wrap [overflow-wrap:anywhere]",
            inDraft && "bg-primary/10",
            pulseLine === newLnNum &&
              newLnNum != null &&
              "bg-ring/10 ring-2 ring-inset ring-ring",
          )}
        >
          <LineTokens
            change={change}
            tokens={highlight?.tokensFor(change)}
            wordRanges={highlight?.wordRangesFor(change)}
          />
        </td>
      </tr>
      {findings && findings.length > 0 && typeof newLn === "number" && (
        <tr>
          <td colSpan={blameCell ? 4 : 3} className="p-0">
            <InlineFindings
              findings={findings}
              controller={controller}
              pulse={pulseLine === newLn}
              innerRef={(el) => registerRow?.(newLn, el)}
            />
          </td>
        </tr>
      )}
      {comment && lineComments && lineComments.length > 0 && newLnNum != null && (
        <tr>
          <td colSpan={blameCell ? 4 : 3} className="p-0">
            <InlineComments
              comments={lineComments}
              controller={comment.controller}
              edit={comment.edit}
              pulse={comment.pulseLine === newLnNum}
              innerRef={(el) => comment.registerRow(newLnNum, el)}
            />
          </td>
        </tr>
      )}
      {comment && showDraftHere && draft && (
        <tr>
          <td colSpan={blameCell ? 4 : 3} className="p-0">
            <div className="sticky left-0 max-w-[100cqw] px-2 py-1.5 font-sans whitespace-normal">
              <NoteEditor
                label={draftLabel(draft)}
                value={comment.draftBody}
                onChange={comment.onDraftBody}
                onSave={comment.onSaveDraft}
                onCancel={comment.onCancelDraft}
              />
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

/** One gap's tbody in the unified view: top rows, then separator, then bottom rows. */
function UnifiedGap({
  g,
  expansion,
  blame,
  pulseLine,
  registerLine,
  wrap,
}: {
  g: number
  expansion: ExpansionLayer
} & Pick<PreflightProps, "blame" | "pulseLine" | "registerLine" | "wrap">) {
  const gap = expansion.gaps.get(g)
  if (!gap) return null
  const showExpander = gap.hidden == null || gap.hidden > 0
  if (!showExpander && gap.topRows.length === 0 && gap.bottomRows.length === 0)
    return null
  // Synthetic context rows carry real new-side numbers, so blame lookups work;
  // grouping is scoped per edge (the expander is a natural break).
  const topCells = blameCellsFor(gap.topRows, blame)
  const bottomCells = blameCellsFor(gap.bottomRows, blame)
  return (
    <tbody>
      {gap.topRows.map((c, idx) => (
        <UnifiedChangeRow
          key={c.ln2}
          change={c}
          synthetic
          blameCell={topCells[idx]}
          pulseLine={pulseLine}
          registerLine={registerLine}
          wrap={wrap}
        />
      ))}
      {showExpander && (
        <ExpanderRow
          g={g}
          gap={gap}
          colSpan={blame?.active ? 4 : 3}
          onExpand={expansion.onExpand}
        />
      )}
      {gap.bottomRows.map((c, idx) => (
        <UnifiedChangeRow
          key={c.ln2}
          change={c}
          synthetic
          blameCell={bottomCells[idx]}
          pulseLine={pulseLine}
          registerLine={registerLine}
          wrap={wrap}
        />
      ))}
    </tbody>
  )
}

function UnifiedTable({
  file,
  findingsByLine,
  controller,
  pulseLine,
  registerRow,
  registerLine,
  crumbs,
  highlight,
  comment,
  expansion,
  wrap,
  path,
  isNewAddedLine,
  blame,
  density,
}: { file: ParsedFile } & PreflightProps) {
  const blameActive = Boolean(blame?.active)
  return (
    <table className={tableCls(density)}>
      {file.chunks.map((chunk, ci) => {
        // Same-sha grouping restarts at each hunk so runs never bleed across gaps.
        const cells = blameCellsFor(chunk.changes, blame)
        return (
          <Fragment key={ci}>
            {expansion && (
              <UnifiedGap
                g={ci}
                expansion={expansion}
                blame={blame}
                pulseLine={pulseLine}
                registerLine={registerLine}
                wrap={wrap}
              />
            )}
            <tbody>
              {/* A fully-expanded gap makes the code contiguous with the rows
                  above — drop the @@ header, GitHub-style (0 = fully expanded;
                  size-0 gaps never get an entry, so their headers stay). */}
              {expansion?.gaps.get(ci)?.hidden === 0 ? null : (
                <tr className="diff-hunk-header">
                  <td
                    colSpan={blameActive ? 4 : 3}
                    className="select-none px-2 py-0.5 text-[11px]"
                  >
                    <span className="whitespace-pre">{chunk.content}</span>
                    <HunkCrumb path={crumbs?.[ci] ?? []} />
                  </td>
                </tr>
              )}
              {chunk.changes.map((change, li) => (
                <UnifiedChangeRow
                  key={li}
                  change={change}
                  blameCell={cells[li]}
                  findingsByLine={findingsByLine}
                  controller={controller}
                  pulseLine={pulseLine}
                  registerRow={registerRow}
                  registerLine={registerLine}
                  highlight={highlight}
                  comment={comment}
                  wrap={wrap}
                  path={path}
                  isNewAddedLine={isNewAddedLine}
                />
              ))}
            </tbody>
          </Fragment>
        )
      })}
      {expansion && (
        <UnifiedGap
          g={file.chunks.length}
          expansion={expansion}
          blame={blame}
          pulseLine={pulseLine}
          registerLine={registerLine}
          wrap={wrap}
        />
      )}
    </table>
  )
}

type SplitRow =
  | { kind: "hunk"; content: string; crumb: string[] }
  | {
      kind: "pair"
      left: ParsedChange | null
      right: ParsedChange | null
      /** Expanded-context row — display only, no comment affordances. */
      synthetic?: boolean
    }
  | { kind: "expander"; g: number; gap: GapView }
  | { kind: "finding"; line: number; findings: PreflightFinding[] }
  | { kind: "comment"; line: number; comments: ResolvedComment[] }
  | { kind: "draft"; line: number }

/** Flatten a file into aligned split rows (hunk headers + paired changes). */
function buildSplitRows(
  file: ParsedFile,
  findingsByLine?: Map<number, PreflightFinding[]>,
  comment?: CommentLayer,
  crumbs?: string[][],
  expansion?: ExpansionLayer,
): SplitRow[] {
  const out: SplitRow[] = []
  // Synthetic context lines render as normal pairs (left = right = the same
  // synthesized change), so pairChanges' alignment rules stay untouched.
  const pushGap = (g: number) => {
    const gap = expansion?.gaps.get(g)
    if (!gap) return
    for (const c of gap.topRows)
      out.push({ kind: "pair", left: c, right: c, synthetic: true })
    if (gap.hidden == null || gap.hidden > 0)
      out.push({ kind: "expander", g, gap })
    for (const c of gap.bottomRows)
      out.push({ kind: "pair", left: c, right: c, synthetic: true })
  }
  file.chunks.forEach((chunk, ci) => {
    pushGap(ci)
    // Fully-expanded gap above → code is contiguous; drop the @@ header row
    // (mirrors the unified renderer; both split sides share this row list).
    if (expansion?.gaps.get(ci)?.hidden !== 0)
      out.push({ kind: "hunk", content: chunk.content, crumb: crumbs?.[ci] ?? [] })
    for (const pair of pairChanges(chunk.changes)) {
      out.push({ kind: "pair", left: pair.left, right: pair.right })
      // The no-newline marker carries the previous line's ln — treat it as
      // anchorless so it can't duplicate that line's finding/comment/draft rows.
      const rNew = isNoNewline(pair.right) ? null : newSideLine(pair.right)
      if (rNew == null) continue
      const findings = findingsByLine?.get(rNew)
      if (findings && findings.length > 0) {
        out.push({ kind: "finding", line: rNew, findings })
      }
      const comments = comment?.byLine?.get(rNew)
      if (comments && comments.length > 0) {
        out.push({ kind: "comment", line: rNew, comments })
      }
      if (comment?.draft && !comment.selecting && comment.draft.endLine === rNew) {
        out.push({ kind: "draft", line: rNew })
      }
    }
  })
  pushGap(file.chunks.length)
  return out
}

/**
 * NEW-side blame cells for the flat split row list, index-aligned to `rows`.
 * Same-sha grouping restarts at each hunk / expander (a natural visual break);
 * non-pair rows and del-only pairs get an empty cell. Module-level so the
 * accumulator escapes the render-scope reassignment lint rule.
 */
function splitBlameCells(rows: SplitRow[], blame: BlameLayer): ReactNode[] {
  const cells: ReactNode[] = new Array(rows.length).fill(undefined)
  const lineFor = blame.lineFor
  let prevSha: string | undefined
  rows.forEach((row, i) => {
    if (row.kind === "hunk" || row.kind === "expander") {
      prevSha = undefined
      return
    }
    if (row.kind !== "pair") return
    const change = row.right
    const n = change ? newSideLine(change) : null
    const bl = n != null ? lineFor(n) : undefined
    const showSha = bl != null && bl.sha !== prevSha
    if (bl != null) prevSha = bl.sha
    cells[i] = <BlameCell line={bl} showSha={showSha} />
  })
  return cells
}

/**
 * One side of the split view. Both sides render the identical row list so they
 * stay vertically aligned; each side scrolls horizontally on its own.
 */
function SplitSide({
  rows,
  side,
  findingsByLine,
  controller,
  pulseLine,
  registerRow,
  registerLine,
  highlight,
  comment,
  expansion,
  path,
  isNewAddedLine,
  blame,
  density,
}: { rows: SplitRow[]; side: "left" | "right" } & PreflightProps) {
  const draft = comment?.draft
  // Blame column rides on the RIGHT side only (new-side); the left stays 2 cols
  // and the two tables align by row height, not column count.
  const blameActive = side === "right" && Boolean(blame?.active)
  const blameCells =
    blameActive && blame ? splitBlameCells(rows, blame) : undefined
  return (
    <table className={tableCls(density)}>
      <tbody>
        {rows.map((row, i) => {
          if (row.kind === "hunk") {
            return (
              <tr key={i} className="diff-hunk-header">
                <td
                  colSpan={blameActive ? 3 : 2}
                  className="select-none px-2 py-0.5 text-[11px]"
                >
                  {/* Right side mirrors the same content invisibly (the pattern
                      every other row type uses) so a crumb's taller line box
                      can't push the two tables out of alignment. */}
                  <span
                    aria-hidden={side === "right"}
                    className={cn(side === "right" && "invisible")}
                  >
                    <span className="whitespace-pre">{row.content}</span>
                    <HunkCrumb path={row.crumb} />
                  </span>
                </td>
              </tr>
            )
          }
          if (row.kind === "expander") {
            // Left side hosts the controls; right renders an invisible mirror
            // (same pattern as findings) so the two tables stay row-aligned.
            if (!expansion) return null
            return (
              <ExpanderRow
                key={i}
                g={row.g}
                gap={row.gap}
                colSpan={blameActive ? 3 : 2}
                onExpand={expansion.onExpand}
                mirror={side === "right"}
              />
            )
          }
          if (row.kind === "finding") {
            // Right side shows the card; left renders an invisible, equal-height
            // mirror so the two tables stay row-aligned.
            return (
              <tr key={i}>
                <td colSpan={blameActive ? 3 : 2} className="p-0">
                  <InlineFindings
                    findings={row.findings}
                    controller={controller}
                    pulse={pulseLine === row.line}
                    innerRef={
                      side === "right"
                        ? (el) => registerRow?.(row.line, el)
                        : undefined
                    }
                    mirror={side === "left"}
                  />
                </td>
              </tr>
            )
          }
          if (row.kind === "comment" && comment) {
            return (
              <tr key={i}>
                <td colSpan={blameActive ? 3 : 2} className="p-0">
                  <InlineComments
                    comments={row.comments}
                    controller={comment.controller}
                    edit={comment.edit}
                    pulse={comment.pulseLine === row.line}
                    innerRef={
                      side === "right"
                        ? (el) => comment.registerRow(row.line, el)
                        : undefined
                    }
                    mirror={side === "left"}
                  />
                </td>
              </tr>
            )
          }
          if (row.kind === "draft" && comment && draft) {
            const editor = (
              <div
                aria-hidden={side === "left"}
                className={cn(
                  "sticky left-0 max-w-[100cqw] px-2 py-1.5 font-sans whitespace-normal",
                  side === "left" && "invisible",
                )}
              >
                <NoteEditor
                  label={draftLabel(draft)}
                  value={comment.draftBody}
                  onChange={side === "right" ? comment.onDraftBody : () => {}}
                  onSave={side === "right" ? comment.onSaveDraft : () => {}}
                  onCancel={side === "right" ? comment.onCancelDraft : () => {}}
                  mirror={side === "left"}
                />
              </div>
            )
            return (
              <tr key={i}>
                <td colSpan={blameActive ? 3 : 2} className="p-0">
                  {editor}
                </td>
              </tr>
            )
          }
          if (row.kind !== "pair") return null
          const change = side === "left" ? row.left : row.right
          // The no-newline marker duplicates the previous change's type and ln;
          // it renders as an unnumbered, untinted note on whichever side owns it.
          const noNl = isNoNewline(change)
          // Blame cell (right side only) — precomputed with same-sha grouping.
          const blameCell = blameCells?.[i]
          const isDel = side === "left" && !noNl && change?.type === "del"
          const isAdd = side === "right" && !noNl && change?.type === "add"
          const newLn =
            side === "right" && !noNl && change?.type === "add"
              ? change.ln
              : undefined
          const sev =
            typeof newLn === "number" && findingsByLine?.get(newLn)?.length
              ? topSeverity(findingsByLine.get(newLn)!)
              : null
          // Checkpoint marker — REAL added lines only (synthetic pair rows are
          // 'normal' pairs, so isAdd already excludes them; keep the guard).
          const isNew =
            isAdd &&
            !row.synthetic &&
            change?.type === "add" &&
            path != null &&
            isNewAddedLine != null
              ? isNewAddedLine(path, change.content)
              : false
          // Synthetic context rows expose no new-side anchor for COMMENTS: null
          // rightNew strips the comment affordances entirely.
          const rightNew =
            side === "right" && !row.synthetic && !noNl
              ? newSideLine(change)
              : null
          // Focus/scroll registration + pulse anchor. Unlike rightNew this is
          // NOT gated on `synthetic`, so expanded-context rows are registered
          // and can be jumped-to + pulsed, matching the unified view (which
          // registers synthetic rows via newLnNum). It IS gated on the marker,
          // which would otherwise clobber the real line's registration.
          const rightAnchor =
            side === "right" && !noNl ? newSideLine(change) : null
          const inDraft =
            draft != null &&
            rightNew != null &&
            rightNew >= draft.startLine &&
            rightNew <= draft.endLine
          const ln =
            change && !noNl
              ? change.type === "normal"
                ? side === "left"
                  ? change.ln1
                  : change.ln2
                : change.type === "del" || change.type === "add"
                  ? change.ln
                  : ""
              : ""
          return (
            <tr key={i} className={cn(comment && rightNew != null && "group/cmrow")}>
              {blameCell}
              <td
                className={cn(
                  gutterCls,
                  // Same number/code rule the unified view draws.
                  "border-r",
                  side === "right" && "relative",
                  isDel && "diff-gutter-del",
                  isAdd && "diff-gutter-add",
                  sev && cn("border-l-2", SEVERITY_BORDER[sev]),
                  // Findings own border-l-2; with both, only the dot marks "new".
                  isNew && !sev && "border-l-2 border-amber-500/70",
                  !change && "diff-split-empty",
                  comment && rightNew != null && "cursor-pointer hover:text-foreground",
                )}
                onPointerDown={
                  comment && rightNew != null
                    ? (e) => {
                        if (e.button !== 0) return
                        e.preventDefault()
                        comment.onSelectStart(rightNew, e.shiftKey)
                      }
                    : undefined
                }
                onPointerEnter={
                  comment && rightNew != null
                    ? () => comment.onSelectMove(rightNew)
                    : undefined
                }
                title={
                  comment && rightNew != null
                    ? "Click, shift-click, or drag the line numbers to comment"
                    : undefined
                }
              >
                {ln}
                {isNew && (
                  <span
                    aria-hidden
                    title="New since checkpoint"
                    className="absolute left-0.5 top-1/2 size-1.5 -translate-y-1/2 rounded-full bg-amber-500"
                  />
                )}
                {comment && rightNew != null && (
                  <CommentButton
                    line={rightNew}
                    onComposeAt={comment.onComposeAt}
                  />
                )}
              </td>
              <td
                ref={
                  rightAnchor != null
                    ? (el) => registerLine?.(rightAnchor, el)
                    : undefined
                }
                className={cn(
                  contentCls,
                  "w-full",
                  isDel && "diff-line-del",
                  isAdd && "diff-line-add",
                  noNl && "text-muted-foreground/70",
                  inDraft && "bg-primary/10",
                  rightAnchor != null &&
                    pulseLine === rightAnchor &&
                    "bg-ring/10 ring-2 ring-inset ring-ring",
                  !change && "diff-split-empty"
                )}
              >
                {noNl ? (
                  "  No newline at end of file"
                ) : change ? (
                  <LineTokens
                    change={change}
                    tokens={highlight?.tokensFor(change)}
                    wordRanges={highlight?.wordRangesFor(change)}
                  />
                ) : (
                  // Zero-width char so the empty side holds one line of height —
                  // keeps the two split tables aligned and lets the hatch show.
                  "​"
                )}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function SplitTable({
  file,
  findingsByLine,
  controller,
  pulseLine,
  registerRow,
  registerLine,
  crumbs,
  highlight,
  comment,
  expansion,
  path,
  isNewAddedLine,
  blame,
  density,
}: { file: ParsedFile } & PreflightProps) {
  const rows = buildSplitRows(file, findingsByLine, comment, crumbs, expansion)
  return (
    <div className="flex w-full items-stretch">
      <div className="@container w-1/2 min-w-0 overflow-x-auto">
        <SplitSide
          rows={rows}
          side="left"
          findingsByLine={findingsByLine}
          highlight={highlight}
          comment={comment}
          expansion={expansion}
          density={density}
        />
      </div>
      <div className="@container w-1/2 min-w-0 overflow-x-auto border-l">
        <SplitSide
          rows={rows}
          side="right"
          findingsByLine={findingsByLine}
          controller={controller}
          pulseLine={pulseLine}
          registerRow={registerRow}
          registerLine={registerLine}
          highlight={highlight}
          comment={comment}
          expansion={expansion}
          path={path}
          isNewAddedLine={isNewAddedLine}
          blame={blame}
          density={density}
        />
      </div>
    </div>
  )
}

function HeaderBadge({
  count,
  severity,
}: {
  count: number
  severity: PreflightSeverity
}) {
  return (
    <span
      className={cn(
        "flex items-center gap-0.5 rounded px-1 py-0.5 text-[11px] tabular-nums",
        SEVERITY_BG[severity],
        SEVERITY_TEXT[severity],
      )}
    >
      <SeverityIcon severity={severity} className="size-3" />
      {count}
    </span>
  )
}

export function DiffFile({
  file,
  view,
  fileClass = "meaningful",
  syntax = true,
  wrap = false,
  findingsByLine,
  controller,
  focusLine,
  focusNonce,
  comments,
  commentsByLine,
  fileComments,
  symbols,
  onFindReferences,
  compact = false,
  repoId,
  baseRef,
  compareRef,
  isBinary,
  isNewAddedLine,
  blame,
  blameOn,
  blamePending = false,
  onToggleBlame,
  density = "comfortable",
  review,
}: {
  file: ParsedFile
  view: "unified" | "split"
  /** Noise classification — drives the collapsed placeholder for generated/whitespace files. */
  fileClass?: FileClass
  /** Whether Shiki syntax highlighting is enabled (word-diff is always on). */
  syntax?: boolean
  /** Soft-wrap long lines (unified view only — split alignment needs no-wrap). */
  wrap?: boolean
  findingsByLine?: Map<number, PreflightFinding[]>
  controller?: PreflightController
  focusLine?: number | null
  focusNonce?: number
  /** Review-comment controller (optional / additive). */
  comments?: CommentsController
  /** Resolved comments for this file, keyed by their anchor (end) line. */
  commentsByLine?: Map<number, ResolvedComment[]>
  /** Whole-file comments for this file. */
  fileComments?: ResolvedComment[]
  /**
   * Tree-sitter symbols for this file's compare-side content (optional /
   * additive). Empty/absent → no breadcrumb, no outline; the diff is unchanged.
   */
  symbols?: SymbolNode[]
  /**
   * Launch the blast-radius search for a touched symbol (optional / additive).
   * Threaded into the outline's per-row "find references" action. Absent → the
   * action is hidden and the outline behaves exactly as before.
   */
  onFindReferences?: (name: string) => void
  /** Compact/touch layout — the outline opens as a Sheet rather than a popover. */
  compact?: boolean
  /**
   * Repo id + resolved ref tokens (optional / additive). Together they enable
   * blob-backed features: context expansion and the binary image viewer.
   */
  repoId?: string | null
  baseRef?: string
  compareRef?: string
  /**
   * Authoritative `git diff --numstat` binary flag (`-\t-`). Undefined → unknown,
   * fall back to "no hunks" so the copy is exactly what it was before.
   */
  isBinary?: boolean
  /**
   * Checkpoint "new since checkpoint" test for real added lines (optional /
   * additive). Absent → no amber markers; display only, never alters layout.
   */
  isNewAddedLine?: (path: string, content: string) => boolean
  /**
   * Per-line blame for this file's compare-side content (optional / additive).
   * Index i = new-side line i+1; empty/absent → no blame column, diff unchanged.
   */
  blame?: BlameLine[]
  /** Whether the blame gutter is toggled on (session-only, owned by DiffViewer). */
  blameOn?: boolean
  /** Blame is toggled on but still in flight — the header button shows a spinner. */
  blamePending?: boolean
  /** Toggle the blame gutter; when absent the header button is not rendered. */
  onToggleBlame?: () => void
  /** Code row density: comfortable (default) or the tighter classic look. */
  density?: "comfortable" | "compact"
  /**
   * End-of-file review flow (optional / additive): a footer with "mark viewed
   * & continue" so finishing a file never means scrolling back to the toolbar.
   */
  review?: {
    isViewed: boolean
    onToggleViewed: () => void
    hasNext: boolean
    onNext: () => void
    /** Guide pacing: set when advancing crosses into a new guide section. */
    nextHint?: string | null
  }
}) {
  const path = filePath(file)
  const status = fileStatus(file)
  const renamed = status === "renamed"
  // Three things produce zero hunks: a real binary, a mode-only change, and an
  // empty added/deleted file. `noRows` drives layout; `binary` drives the copy.
  const noRows = file.chunks.length === 0
  // Trust the numstat flag only to demote — a textconv'd binary (`*.jpg diff=exif`)
  // reports `-\t-` yet still emits a real patch, and that patch must keep rendering.
  const binary = noRows && (isBinary ?? true)

  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const lineRefs = useRef<Map<number, HTMLElement>>(new Map())
  const [pulseLine, setPulseLine] = useState<number | null>(null)

  // ── Symbol outline + hunk breadcrumb (tree-sitter; additive, graceful) ──────
  const syms = useMemo(() => symbols ?? [], [symbols])
  // Added new-side line numbers drive the touched-symbol classification, and the
  // per-chunk enclosing-symbol breadcrumb is keyed off each hunk's first change.
  const addedLines = useMemo(() => {
    const s = new Set<number>()
    for (const chunk of file.chunks) {
      for (const ch of chunk.changes) if (ch.type === "add") s.add(ch.ln)
    }
    return s
  }, [file])
  const touch: SymbolTouch = useMemo(
    () => computeTouched(syms, addedLines),
    [syms, addedLines],
  )
  const crumbs = useMemo(
    () =>
      syms.length === 0
        ? []
        : file.chunks.map((chunk) => {
            const line = chunkAnchorLine(chunk)
            return line == null ? [] : enclosingPath(syms, line)
          }),
    [syms, file],
  )

  // Review-comment composer state (single line or a shift-selected range).
  // `selecting` is true from pointerdown until release; the composer only
  // mounts once selecting ends, so dragging a range never fights the editor.
  const [draft, setDraft] = useState<CommentDraft | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [draftBody, setDraftBody] = useState("")
  const [fileDraftOpen, setFileDraftOpen] = useState(false)
  // Which saved note is open for editing, lifted out of the card so split view's
  // two mirrored copies stay exactly the same height (one editor at a time).
  const [editing, setEditing] = useState<{ id: string; body: string } | null>(
    null,
  )

  // Raw new-side line contents (markers included) → content-hash anchoring.
  const newSideContent = useMemo(() => {
    const m = new Map<number, string>()
    for (const chunk of file.chunks) {
      for (const ch of chunk.changes) {
        // The no-newline marker repeats the previous change's ln — letting it in
        // would overwrite that line's real source in every saved note.
        if (isNoNewline(ch)) continue
        if (ch.type === "add") m.set(ch.ln, ch.content)
        else if (ch.type === "normal") m.set(ch.ln2, ch.content)
      }
    }
    return m
  }, [file])

  const startComment = useCallback(
    (line: number, shift: boolean) => {
      setDraft((prev) => {
        if (shift && prev) {
          // Grow contiguously from the anchor toward the shift-clicked line,
          // stopping at the first new-side gap (hunk boundary) so the block
          // stays gap-free — keeping its length == endLine − startLine + 1.
          const anchor = prev.anchor
          const lo = Math.min(anchor, line)
          const hi = Math.max(anchor, line)
          let startLine = anchor
          for (let n = anchor - 1; n >= lo && newSideContent.has(n); n--) {
            startLine = n
          }
          let endLine = anchor
          for (let n = anchor + 1; n <= hi && newSideContent.has(n); n++) {
            endLine = n
          }
          return { anchor, startLine, endLine }
        }
        return { anchor: line, startLine: line, endLine: line }
      })
    },
    [newSideContent],
  )

  const cancelDraft = useCallback(() => {
    setDraft(null)
    setSelecting(false)
    setDraftBody("")
  }, [])

  const saveDraft = useCallback(() => {
    if (!comments || !draft) return
    const body = draftBody.trim()
    if (!body) return
    const code: string[] = []
    for (let n = draft.startLine; n <= draft.endLine; n++) {
      const content = newSideContent.get(n)
      if (content !== undefined) code.push(content)
    }
    comments.add({
      path,
      startLine: draft.startLine,
      endLine: draft.endLine,
      body,
      code,
    })
    setDraft(null)
    setDraftBody("")
  }, [comments, draft, draftBody, newSideContent, path])

  // Click / shift-click / drag selection driven by the new-side line numbers.
  const dragging = useRef(false)
  useEffect(() => {
    function stop() {
      dragging.current = false
      // Pointer released → the selection is final; mount the composer.
      setSelecting(false)
    }
    window.addEventListener("pointerup", stop)
    window.addEventListener("pointercancel", stop)
    return () => {
      window.removeEventListener("pointerup", stop)
      window.removeEventListener("pointercancel", stop)
    }
  }, [])

  // Press a line number: shift extends the current block from its anchor; a plain
  // press starts a fresh single-line draft and arms a drag. The composer stays
  // hidden until release so a drag can grow the range undisturbed.
  const onSelectStart = useCallback(
    (line: number, shift: boolean) => {
      startComment(line, shift)
      dragging.current = true
      setSelecting(true)
    },
    [startComment],
  )

  // Dragging over more line numbers grows the block (gap-aware) from the anchor.
  const onSelectMove = useCallback(
    (line: number) => {
      if (!dragging.current) return
      startComment(line, true)
    },
    [startComment],
  )

  // Keyboard entry point: a single-line draft with the composer mounted at once,
  // since there is no pointer release to wait on.
  const onComposeAt = useCallback(
    (line: number) => {
      startComment(line, false)
      dragging.current = false
      setSelecting(false)
    },
    [startComment],
  )

  function registerRow(line: number, el: HTMLDivElement | null) {
    if (el) rowRefs.current.set(line, el)
    else rowRefs.current.delete(line)
  }

  function registerLine(line: number, el: HTMLElement | null) {
    if (el) lineRefs.current.set(line, el)
    else lineRefs.current.delete(line)
  }

  // Unified scroll-and-pulse target. Panel jumps arrive via the focusLine prop;
  // the outline jumps in-component via jumpToLine. Both flow through one effect.
  const [focus, setFocus] = useState<{ line: number; nonce: number } | null>(
    focusLine == null ? null : { line: focusLine, nonce: focusNonce ?? 0 },
  )
  const jumpToLine = useCallback((line: number) => {
    setFocus({ line, nonce: Date.now() })
  }, [])

  // Reconcile a new panel request during render; local outline jumps remain
  // independent until the panel sends a different line or nonce.
  const [panelFocus, setPanelFocus] = useState({ line: focusLine, nonce: focusNonce })
  if (panelFocus.line !== focusLine || panelFocus.nonce !== focusNonce) {
    setPanelFocus({ line: focusLine, nonce: focusNonce })
    if (focusLine != null) setFocus({ line: focusLine, nonce: focusNonce ?? 0 })
  }

  // Scroll + pulse the target line — its inline finding/comment card if one is
  // registered there, otherwise the line's own content cell (symbol jumps).
  useEffect(() => {
    if (!focus) return
    const el = rowRefs.current.get(focus.line) ?? lineRefs.current.get(focus.line)
    if (el) el.scrollIntoView({ block: "center", behavior: "smooth" })
    const frame = requestAnimationFrame(() => setPulseLine(focus.line))
    const t = setTimeout(() => setPulseLine(null), 1300)
    return () => { cancelAnimationFrame(frame); clearTimeout(t) }
  }, [focus])

  // Generated / whitespace-only files start collapsed (placeholder + "Show diff")
  // so we never highlight an 800-line lockfile until asked.
  const isNoise = fileClass === "generated" || fileClass === "whitespace"
  const [revealed, setRevealed] = useState(false)
  const collapsed = isNoise && !revealed

  const patchHighlight = useDiffHighlight(file, !noRows && !collapsed, syntax)

  // ── Incremental rendering of very large diffs ───────────────────────────────
  // Above the threshold we render only a leading slice of whole hunks and reveal
  // the rest in chunks. revealCount is the number of extra "Show more" clicks;
  // visibleChunkCount is derived (never mid-hunk). Per-file state resets on file
  // change automatically because DiffFile remounts per selected file.
  const { incremental, totalChanges, cutoffs } = useMemo(() => {
    const totalChanges = file.chunks.reduce((n, c) => n + c.changes.length, 0)
    const incremental =
      !collapsed && !noRows && totalChanges > INCREMENTAL_ROW_THRESHOLD
    return {
      incremental,
      totalChanges,
      cutoffs: incremental ? chunkCutoffs(file) : [],
    }
  }, [file, collapsed, noRows])
  const [revealCount, setRevealCount] = useState(0)
  // Incremental render hides trailing hunks, but n/p hunk nav, search, reference
  // and symbol jumps all target lines across the FULL file. Map the current
  // focus line to the hunk whose new-side range contains it and reveal at least
  // through that hunk, so the target row exists in the DOM before the
  // scroll-and-pulse effect runs. Pure derivation (folded into visibleChunkCount
  // below) — no reveal-in-effect. focus stays set, so the region stays revealed.
  const focusChunkReveal = useMemo(() => {
    if (!incremental || focus == null) return 0
    const line = focus.line
    for (let i = 0; i < file.chunks.length; i++) {
      const c = file.chunks[i]
      if (line >= c.newStart && line <= c.newStart + c.newLines - 1) return i + 1
    }
    return 0
  }, [incremental, focus, file])
  const visibleChunkCount = incremental
    ? Math.max(cutoffs[Math.min(revealCount, cutoffs.length - 1)], focusChunkReveal)
    : file.chunks.length
  // Slice both the chunks and their parallel breadcrumb array identically; never
  // slice mid-chunk. shownFile.chunks.length < file.chunks.length means trailing
  // hunks are hidden (later context-expand features must suppress an
  // after-last-hunk expander in that case). addedLines/touch/newSideContent stay
  // on the FULL file so comment anchoring + symbol touch see everything.
  // Memoized so identity is stable for the expansion layer's gap recompute.
  const shownFile = useMemo(
    () =>
      incremental
        ? { ...file, chunks: file.chunks.slice(0, visibleChunkCount) }
        : file,
    [incremental, file, visibleChunkCount],
  )
  const shownCrumbs = incremental ? crumbs.slice(0, visibleChunkCount) : crumbs
  const hiddenRowCount =
    totalChanges -
    (incremental
      ? shownFile.chunks.reduce((n, c) => n + c.changes.length, 0)
      : totalChanges)
  const hasMoreHunks = incremental && visibleChunkCount < file.chunks.length

  // ── Context expansion (blob-backed synthesized context; graceful) ───────────
  // Per-gap {top, bottom} revealed-line counts, keyed by gap index. Reset when
  // the parent hands over a freshly parsed file (diff refetch) via the
  // render-phase adjust-state-on-prop-change pattern; file switches already
  // remount DiffFile (the diff pane is keyed by the selected path).
  const [expansions, setExpansions] = useState<
    Map<number, { top: number; bottom: number }>
  >(() => new Map())
  const [wantBlob, setWantBlob] = useState(false)
  const [expFile, setExpFile] = useState(file)
  if (expFile !== file) {
    setExpFile(file)
    setExpansions(new Map())
  }
  // Deleted files have no compare-side blob; binary/collapsed files never expand.
  const expandEnabled =
    Boolean(repoId && compareRef) && !noRows && !collapsed && status !== "deleted"
  const blob = useBlob(repoId ?? null, compareRef ?? null, path, wantBlob && expandEnabled)
  const { lines: blobLines, error: blobError, isLoading: blobIsLoading, loaded: blobLoaded } = blob

  // Expanded-context rows are synthesized from the blob, so they never appear in
  // the patch's per-change token map. Tokenize the blob too and fall back to it
  // by new-side line number, so revealed context is highlighted like everything
  // around it. `del` rows have no new-side line, so they never fall back — and
  // real patch rows only reach the fallback if the patch pass hasn't landed.
  const blobTokensFor = useBlobHighlight(
    path,
    blobLines,
    syntax && blobLoaded && !noRows && !collapsed,
  )
  const highlight = useMemo<DiffHighlight>(
    () => ({
      ...patchHighlight,
      tokensFor: (c) => {
        const own = patchHighlight.tokensFor(c)
        if (own) return own
        const ln = newSideLine(c)
        return ln != null ? blobTokensFor(ln) : null
      },
    }),
    [patchHighlight, blobTokensFor],
  )

  const onExpand = useCallback((g: number, edge: "top" | "bottom" | "all") => {
    // First interaction anywhere triggers the (lazy) blob fetch.
    setWantBlob(true)
    setExpansions((prev) => {
      const next = new Map(prev)
      const cur = next.get(g) ?? { top: 0, bottom: 0 }
      // 'all' over-asks on purpose; computeGaps clamps to the gap size.
      if (edge === "all") next.set(g, { top: Number.MAX_SAFE_INTEGER, bottom: 0 })
      else if (edge === "top") next.set(g, { ...cur, top: cur.top + EXPAND_STEP })
      else next.set(g, { ...cur, bottom: cur.bottom + EXPAND_STEP })
      return next
    })
  }, [])

  const expansionLayer = useMemo<ExpansionLayer | undefined>(() => {
    if (!expandEnabled || shownFile.chunks.length === 0) return undefined
    return {
      gaps: computeGaps(
        shownFile,
        expansions,
        { lines: blobLines, error: blobError, isLoading: blobIsLoading, loaded: blobLoaded },
        hasMoreHunks,
      ),
      onExpand,
    }
  }, [
    expandEnabled,
    shownFile,
    expansions,
    blobLines,
    blobError,
    blobIsLoading,
    blobLoaded,
    hasMoreHunks,
    onExpand,
  ])

  // ── Blame gutter (compare-side per-line authorship; additive, graceful) ─────
  // A slim NEW-side sha column, only once toggled on AND blame actually loaded.
  // Empty blame (untracked WORKING file, deleted file, parse failure) → inactive
  // → no column, the diff is byte-identical to blame-off.
  const blameActive = Boolean(blameOn && blame && blame.length)
  const blameLayer = useMemo(
    () =>
      blameActive && blame
        ? {
            active: true,
            lineFor: (n: number) =>
              n >= 1 && n <= blame.length ? blame[n - 1] : undefined,
          }
        : undefined,
    [blameActive, blame],
  )

  // Header roll-up counts (active findings only — caller pre-filters).
  let secretCount = 0
  let leftoverCount = 0
  if (findingsByLine) {
    for (const arr of findingsByLine.values()) {
      for (const f of arr) {
        if (f.category === "secret") secretCount++
        else leftoverCount++
      }
    }
  }

  // Shared by the inline line notes and the whole-file notes below.
  const editLayer: EditLayer = {
    open: editing,
    onStart: (c) => setEditing({ id: c.id, body: c.body }),
    onBody: (body) => setEditing((e) => (e ? { ...e, body } : e)),
    onSave: () => {
      if (!comments || !editing || !editing.body.trim()) return
      comments.update(editing.id, editing.body)
      setEditing(null)
    },
    onCancel: () => setEditing(null),
  }

  const commentLayer: CommentLayer | undefined = comments
    ? {
        controller: comments,
        byLine: commentsByLine,
        draft,
        selecting,
        draftBody,
        onSelectStart,
        onSelectMove,
        onComposeAt,
        onDraftBody: setDraftBody,
        onSaveDraft: saveDraft,
        onCancelDraft: cancelDraft,
        pulseLine,
        registerRow,
        edit: editLayer,
      }
    : undefined

  const fileNotes = fileComments ?? []
  const showFileSection =
    Boolean(comments) && (fileNotes.length > 0 || fileDraftOpen)

  return (
    <div className="border-b last:border-b-0">
      <div className="sticky top-0 z-10 flex items-center gap-2 border-b bg-card/95 px-4 py-2 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <FileStatusIcon status={status} />
        <div className="flex min-w-0 flex-1 items-center gap-1.5 font-mono text-xs">
          {renamed && file.from && file.to ? (
            <>
              <span className="truncate text-muted-foreground" title={file.from}>
                {file.from}
              </span>
              <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
              <span className="truncate font-medium" title={file.to}>
                {file.to}
              </span>
            </>
          ) : (
            // Truncate the directory, never the basename — the same split every
            // other path surface uses (DiffFileList, DiffSearch).
            <span className="flex min-w-0 items-baseline overflow-hidden" title={path}>
              <span className="min-w-0 truncate text-muted-foreground">
                {path.slice(0, path.lastIndexOf("/") + 1)}
              </span>
              <span className="shrink-0 font-medium">
                {path.slice(path.lastIndexOf("/") + 1)}
              </span>
            </span>
          )}
        </div>
        <Button
          size="icon-xs"
          variant="ghost"
          className="shrink-0 text-muted-foreground pointer-coarse:size-9"
          title="Copy file path"
          aria-label="Copy file path"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(path)
              toast.success("Path copied")
            } catch {
              toast.error("Couldn't copy the path")
            }
          }}
        >
          <Copy />
        </Button>
        {comments && (
          <Button
            size="icon-xs"
            variant="ghost"
            className="shrink-0 text-muted-foreground pointer-coarse:size-9"
            title="Comment on this file"
            aria-label="Comment on this file"
            onClick={() => setFileDraftOpen(true)}
          >
            <MessageSquarePlus />
          </Button>
        )}
        {(secretCount > 0 || leftoverCount > 0) && (
          <div className="flex shrink-0 items-center gap-1">
            {secretCount > 0 && <HeaderBadge count={secretCount} severity="blocker" />}
            {leftoverCount > 0 && (
              <HeaderBadge count={leftoverCount} severity="warning" />
            )}
          </div>
        )}
        {onToggleBlame && !noRows && !collapsed && (
          <Button
            size="icon-xs"
            variant="ghost"
            className={cn(
              "shrink-0 pointer-coarse:size-9",
              blameOn ? "text-foreground" : "text-muted-foreground",
            )}
            aria-pressed={blameOn}
            aria-busy={blamePending}
            title={blamePending ? "Loading blame…" : "Toggle blame"}
            aria-label="Toggle blame"
            onClick={onToggleBlame}
          >
            {blamePending ? <Loader2 className="animate-spin" /> : <History />}
          </Button>
        )}
        {syms.length > 0 && (
          <SymbolOutline
            symbols={syms}
            touch={touch}
            compact={compact}
            onJump={jumpToLine}
            onFindReferences={onFindReferences}
          />
        )}
        <div className="shrink-0 font-mono text-xs tabular-nums">
          <span className="text-[var(--diff-add-marker)]">+{file.additions}</span>{" "}
          <span className="text-[var(--diff-del-marker)]">−{file.deletions}</span>
        </div>
      </div>

      {showFileSection && comments && (
        <div className="flex flex-col gap-1.5 border-b bg-muted/20 px-4 py-2">
          {fileNotes.map((c) => (
            <InlineCommentCard
              key={c.id}
              comment={c}
              controller={comments}
              edit={editLayer}
            />
          ))}
          {fileDraftOpen && (
            <LocalNoteEditor
              label="New note · whole file"
              onSave={(b) => {
                comments.add({
                  path,
                  startLine: 0,
                  endLine: 0,
                  body: b,
                  code: [],
                })
                setFileDraftOpen(false)
              }}
              onCancel={() => setFileDraftOpen(false)}
            />
          )}
        </div>
      )}

      {noRows ? (
        binary && repoId && baseRef && compareRef && isImagePath(path) ? (
          <ImageDiff
            repoId={repoId}
            baseRef={baseRef}
            compareRef={compareRef}
            path={path}
            oldPath={file.from && file.from !== "/dev/null" ? file.from : undefined}
            status={status}
          />
        ) : (
          <div className="flex items-center gap-2 px-4 py-6 text-xs text-muted-foreground">
            {binary ? (
              <Binary className="size-4 shrink-0" />
            ) : (
              <FileText className="size-4 shrink-0" />
            )}
            {!binary
              ? file.oldMode && file.newMode && file.oldMode !== file.newMode
                ? `Mode changed ${file.oldMode} → ${file.newMode} — no content changes.`
                : "No content changes."
              : status === "deleted"
                ? "Binary file deleted."
                : status === "added"
                  ? "Binary file added."
                  : status === "renamed"
                    ? "File renamed (no textual changes)."
                    : "Binary file — no textual diff to display."}
          </div>
        )
      ) : collapsed ? (
        <NoisePlaceholder
          kind={fileClass as "generated" | "whitespace"}
          status={status}
          name={path.slice(path.lastIndexOf("/") + 1)}
          additions={file.additions}
          deletions={file.deletions}
          onReveal={() => setRevealed(true)}
        />
      ) : (
        <>
          {highlight.skippedLargeFile && (
            <div className="flex items-center gap-1.5 border-b bg-muted/40 px-4 py-1 text-[11px] text-muted-foreground">
              <Sparkles className="size-3 shrink-0" />
              Syntax highlighting skipped (large file).
            </div>
          )}
          {view === "unified" ? (
            <div className="@container overflow-x-auto">
              <UnifiedTable
                file={shownFile}
                findingsByLine={findingsByLine}
                controller={controller}
                pulseLine={pulseLine}
                registerRow={registerRow}
                registerLine={registerLine}
                crumbs={shownCrumbs}
                highlight={highlight}
                comment={commentLayer}
                expansion={expansionLayer}
                wrap={wrap}
                path={path}
                isNewAddedLine={isNewAddedLine}
                blame={blameLayer}
                density={density}
              />
            </div>
          ) : (
            <SplitTable
              file={shownFile}
              findingsByLine={findingsByLine}
              controller={controller}
              pulseLine={pulseLine}
              registerRow={registerRow}
              registerLine={registerLine}
              crumbs={shownCrumbs}
              highlight={highlight}
              comment={commentLayer}
              expansion={expansionLayer}
              path={path}
              isNewAddedLine={isNewAddedLine}
              blame={blameLayer}
              density={density}
            />
          )}
          {hasMoreHunks && (
            <div className="flex items-stretch border-t bg-muted/20 text-xs">
              <button
                type="button"
                onClick={() => setRevealCount((c) => c + 1)}
                className="flex flex-1 items-center justify-center gap-1.5 py-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground pointer-coarse:py-3"
              >
                <ChevronsDown className="size-3.5 shrink-0" />
                Show {hiddenRowCount.toLocaleString()} more lines
              </button>
              <button
                type="button"
                onClick={() => setRevealCount(cutoffs.length - 1)}
                className="border-l px-3 py-2 text-muted-foreground transition-colors hover:bg-muted/40 hover:text-foreground pointer-coarse:py-3"
              >
                Show all
              </button>
            </div>
          )}
          {review && !hasMoreHunks && (
            <div className="flex flex-col items-center gap-1.5 border-t bg-muted/20 px-4 py-5">
              <div className="flex items-center justify-center gap-3">
                {!review.isViewed ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="gap-1.5 pointer-coarse:h-10"
                    onClick={review.onToggleViewed}
                  >
                    <CircleCheckBig />
                    Mark viewed{review.hasNext ? " · next file" : ""}
                    <kbd className="rounded border bg-background px-1 font-mono text-[10px] text-muted-foreground">
                      v
                    </kbd>
                  </Button>
                ) : (
                  <>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CircleCheckBig className="size-3.5 text-[var(--diff-add-marker)]" />
                      Viewed
                    </span>
                    {review.hasNext && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="gap-1 text-muted-foreground pointer-coarse:h-10"
                        onClick={review.onNext}
                      >
                        Next file
                        <ChevronDown />
                      </Button>
                    )}
                  </>
                )}
              </div>
              {review.hasNext && review.nextHint && (
                <span className="text-[11px] text-muted-foreground/80">
                  Next section: {review.nextHint}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

/** Centered collapsed placeholder shown when a generated / whitespace file opens. */
function NoisePlaceholder({
  kind,
  status,
  name,
  additions,
  deletions,
  onReveal,
}: {
  kind: "generated" | "whitespace"
  status: ReturnType<typeof fileStatus>
  name: string
  additions: number
  deletions: number
  onReveal: () => void
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <FileStatusIcon status={status} className="size-6 opacity-70" />
      <div className="flex items-center gap-2">
        <span className="font-mono text-sm font-medium break-all">{name}</span>
        <NoiseBadge kind={kind} />
      </div>
      <p className="max-w-xs text-xs text-muted-foreground">
        {kind === "generated"
          ? "Generated file — collapsed to reduce noise."
          : "Whitespace-only changes — collapsed to reduce noise."}
      </p>
      <div className="font-mono text-xs tabular-nums">
        <span className="text-[var(--diff-add-marker)]">+{additions}</span>{" "}
        <span className="text-[var(--diff-del-marker)]">−{deletions}</span>
      </div>
      <Button size="sm" variant="secondary" className="gap-1.5 pointer-coarse:h-9" onClick={onReveal}>
        <Eye />
        Show diff
      </Button>
    </div>
  )
}
