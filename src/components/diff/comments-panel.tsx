"use client"

import { useEffect, useRef, useState } from "react"
import {
  Check,
  Circle,
  Clipboard,
  Loader2,
  MessageSquare,
  Pencil,
  Sparkles,
  Trash2,
  Unlink,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import type { CommentsController } from "@/hooks/use-comments"
import type { CommentState } from "@/lib/types"

import {
  commentState,
  isAi,
  isFileLevel,
  lineLabel,
  type ResolvedComment,
} from "./comment-meta"
import { basename, dirname } from "./references-meta"

type StateFilter = "all" | CommentState

const STATE_ORDER: CommentState[] = ["open", "addressed", "resolved"]

const FILTERS: { key: StateFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "addressed", label: "Addressed" },
  { key: "resolved", label: "Resolved" },
]

// Trigger styling per state: open reads as a plain outline, addressed amber-soft,
// resolved green-soft (the same palette the inline diff cards use).
const STATE_TRIGGER: Record<CommentState, string> = {
  open: "border border-border text-muted-foreground hover:bg-muted",
  addressed:
    "border border-amber-500/40 bg-amber-500/10 text-amber-700 hover:bg-amber-500/20 dark:text-amber-400",
  resolved:
    "border border-emerald-500/40 bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-400",
}

function stateIcon(state: CommentState) {
  if (state === "resolved") return <Check />
  if (state === "addressed") return <Sparkles />
  return <Circle />
}

/** Compact badge-styled dropdown that reads and sets a note's lifecycle state. */
function StateControl({
  comment,
  controller,
}: {
  comment: ResolvedComment
  controller: CommentsController
}) {
  const state = commentState(comment)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            className={cn(
              "inline-flex h-5 shrink-0 items-center gap-0.5 rounded-full px-1.5 text-[10px] font-medium capitalize outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:h-7",
              STATE_TRIGGER[state],
            )}
            title="Change state"
            aria-label={`State: ${state}`}
          />
        }
      >
        {state === "resolved" && <Check className="size-2.5" />}
        {state}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {STATE_ORDER.map((s) => (
          <DropdownMenuItem
            key={s}
            onClick={() => controller.setState(comment.id, s)}
          >
            {stateIcon(s)}
            <span className="capitalize">{s}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function CommentRow({
  comment,
  controller,
  onJump,
}: {
  comment: ResolvedComment
  controller: CommentsController
  onJump: (c: ResolvedComment) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)

  function save() {
    const trimmed = draft.trim()
    if (trimmed && trimmed !== comment.body) controller.update(comment.id, trimmed)
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="flex flex-col gap-2 rounded-lg border bg-card px-2.5 py-2">
        <Textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={3}
          className="min-h-16 text-sm"
        />
        <div className="flex items-center justify-end gap-1.5">
          <Button
            size="xs"
            variant="ghost"
            className="pointer-coarse:h-9"
            onClick={() => {
              setDraft(comment.body)
              setEditing(false)
            }}
          >
            Cancel
          </Button>
          <Button
            size="xs"
            className="gap-1 pointer-coarse:h-9"
            disabled={!draft.trim()}
            onClick={save}
          >
            <Check />
            Save
          </Button>
        </div>
      </div>
    )
  }

  const state = commentState(comment)

  return (
    <div className="group/comment flex flex-col rounded-lg transition-colors hover:bg-muted/60">
      <div className="flex items-center gap-1.5 px-2.5 pt-2">
        <span className="shrink-0 rounded bg-muted px-1 font-mono text-[10px] tabular-nums text-muted-foreground">
          {lineLabel(comment)}
        </span>
        {isAi(comment) && (
          <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
            <Sparkles className="size-3" />
            AI
          </span>
        )}
        {comment.orphaned && !isFileLevel(comment) && (
          <span
            className="flex shrink-0 items-center gap-0.5 text-[10px] text-amber-600 dark:text-amber-500"
            title="The commented code changed since this note was written"
          >
            <Unlink className="size-3" />
            code changed · re-check
          </span>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <div className="flex opacity-0 transition-opacity group-hover/comment:opacity-100 focus-within:opacity-100 pointer-coarse:opacity-100">
            <Button
              size="icon-xs"
              variant="ghost"
              className="pointer-coarse:size-9"
              title="Edit note"
              aria-label="Edit note"
              onClick={() => {
                setDraft(comment.body)
                setEditing(true)
              }}
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
          <StateControl comment={comment} controller={controller} />
        </div>
      </div>

      <button
        type="button"
        onClick={() => onJump(comment)}
        className="flex w-full flex-col gap-1 rounded-b-lg px-2.5 pt-1 pb-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:pb-3"
        title={comment.orphaned ? "Original location may have moved" : "Jump to line"}
      >
        <p
          className={cn(
            "whitespace-pre-wrap break-words text-sm",
            state === "resolved" && "text-muted-foreground opacity-75",
          )}
        >
          {comment.body}
        </p>
        {comment.stateNote && (
          <p className="whitespace-pre-wrap break-words text-xs italic text-muted-foreground">
            agent: {comment.stateNote}
          </p>
        )}
      </button>
    </div>
  )
}

export function CommentsPanel({
  open,
  onOpenChange,
  controller,
  onJump,
  compact,
  prereview,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  controller: CommentsController
  onJump: (comment: ResolvedComment) => void
  compact: boolean
  /** When present, adds an "AI pre-review" action that files AI notes server-side. */
  prereview?: { run: () => Promise<number>; running: boolean }
}) {
  const { comments } = controller
  const [filter, setFilter] = useState<StateFilter>("all")

  // "Clear all" is destructive (every note in the repo) — require a second
  // click within a few seconds instead of firing immediately.
  const [confirmClear, setConfirmClear] = useState(false)
  const confirmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
    },
    [],
  )
  function onClearClick() {
    if (confirmClear) {
      if (confirmTimer.current) clearTimeout(confirmTimer.current)
      setConfirmClear(false)
      controller.clear()
      return
    }
    setConfirmClear(true)
    confirmTimer.current = setTimeout(() => setConfirmClear(false), 3000)
  }

  // State breakdown across all notes: drives both the header sub-line and the
  // per-filter counts.
  const counts: Record<StateFilter, number> = {
    all: comments.length,
    open: 0,
    addressed: 0,
    resolved: 0,
  }
  for (const c of comments) counts[commentState(c)]++

  const subline =
    comments.length === 0
      ? "Nothing yet"
      : STATE_ORDER.filter((s) => counts[s] > 0)
          .map((s) => `${counts[s]} ${s}`)
          .join(" · ")

  const filtered =
    filter === "all"
      ? comments
      : comments.filter((c) => commentState(c) === filter)

  // Group by file (alphabetical), comments within a file by start line.
  const byPath = new Map<string, ResolvedComment[]>()
  for (const c of filtered) {
    const arr = byPath.get(c.path) ?? []
    arr.push(c)
    byPath.set(c.path, arr)
  }
  const paths = [...byPath.keys()].sort((a, b) => a.localeCompare(b))

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={compact ? "left" : "right"}
        className={cn(
          "gap-0 p-0",
          compact ? "w-[92%] max-w-md" : "w-[26rem] sm:max-w-md",
        )}
      >
        <div className="flex items-center gap-2 border-b px-4 py-3 pr-12">
          <div className="min-w-0">
            <SheetTitle>Review notes</SheetTitle>
            <p className="truncate text-xs text-muted-foreground">{subline}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 border-b px-3 py-2">
          {prereview && (
            <Button
              size="sm"
              variant="secondary"
              className="gap-1.5 pointer-coarse:h-10"
              disabled={prereview.running}
              onClick={() => {
                prereview
                  .run()
                  .then((n) =>
                    toast.success(
                      n > 0
                        ? `Filed ${n} AI note${n === 1 ? "" : "s"}`
                        : "AI found nothing to flag",
                    ),
                  )
                  .catch((e) =>
                    toast.error(
                      e instanceof Error ? e.message : "Pre-review failed",
                    ),
                  )
              }}
            >
              {prereview.running ? (
                <Loader2 className="animate-spin" />
              ) : (
                <Sparkles />
              )}
              AI pre-review
            </Button>
          )}
          <Button
            size="sm"
            className="flex-1 gap-1.5 pointer-coarse:h-10"
            disabled={comments.length === 0}
            onClick={controller.copyForAI}
          >
            <Clipboard />
            Copy for AI
          </Button>
          <Button
            size="sm"
            variant={confirmClear ? "destructive" : "ghost"}
            className={cn(
              "gap-1.5 pointer-coarse:h-10",
              !confirmClear && "text-muted-foreground",
            )}
            disabled={comments.length === 0}
            onClick={onClearClick}
            title="Delete every note in this repo"
          >
            <Trash2 />
            {confirmClear ? "Really clear?" : "Clear all"}
          </Button>
        </div>

        {comments.length > 0 && (
          <div className="flex flex-wrap items-center gap-0.5 border-b px-2 py-2">
            {FILTERS.map((f) => (
              <Button
                key={f.key}
                size="xs"
                variant={filter === f.key ? "secondary" : "ghost"}
                className="gap-1 pointer-coarse:h-9"
                aria-pressed={filter === f.key}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span
                  className={cn(
                    "tabular-nums",
                    filter === f.key ? "" : "text-muted-foreground",
                  )}
                >
                  {counts[f.key]}
                </span>
              </Button>
            ))}
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {comments.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 p-10 text-center">
              <MessageSquare className="size-7 text-muted-foreground opacity-70" />
              <p className="text-sm font-medium">No notes yet</p>
              <p className="max-w-[16rem] text-xs text-muted-foreground">
                Click a line number in the diff — or drag across several — to
                attach a note. Then hand the whole list to an AI with{" "}
                <span className="font-medium text-foreground">Copy for AI</span>.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-1 p-10 text-center">
              <p className="text-sm text-muted-foreground">No {filter} notes.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1 px-1">
              {paths.map((path) => (
                <div key={path} className="flex flex-col">
                  <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-1">
                    <span
                      className="flex min-w-0 flex-1 items-baseline overflow-hidden font-mono text-xs font-medium text-muted-foreground"
                      title={path}
                    >
                      <span className="min-w-0 truncate">{dirname(path)}</span>
                      <span className="shrink-0 text-foreground">
                        {basename(path)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {byPath.get(path)!.length}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    {byPath.get(path)!.map((c) => (
                      <CommentRow
                        key={c.id}
                        comment={c}
                        controller={controller}
                        onJump={onJump}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
