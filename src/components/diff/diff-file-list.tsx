"use client"

import { MessageSquare } from "lucide-react"

import type { ViewedController } from "@/hooks/use-viewed"
import { cn } from "@/lib/utils"

import { DiffStatBar } from "./diff-stat-bar"
import { NewBadge } from "./diff-file-tree"
import {
  FileStatusIcon,
  NoiseBadge,
  ViewedCheck,
  fileStatus,
  filePath,
  type ParsedFile,
} from "./file-meta"
import type { FileClass } from "./noise"
import { CATEGORY_DOT, type FindingCounts } from "./preflight-meta"

function splitPath(path: string): { dir: string; base: string } {
  const idx = path.lastIndexOf("/")
  if (idx === -1) return { dir: "", base: path }
  return { dir: path.slice(0, idx + 1), base: path.slice(idx + 1) }
}

export function DiffFileList({
  files,
  selectedPath,
  onSelect,
  findingByPath,
  commentByPath,
  newCountByPath,
  classByPath,
  viewed,
}: {
  files: ParsedFile[]
  selectedPath: string | null
  onSelect: (path: string) => void
  findingByPath?: Map<string, FindingCounts>
  /** Comment counts per path; drives the per-row note badge. */
  commentByPath?: Map<string, number>
  /** New-since-checkpoint line counts per path; drives the "N new" badge. */
  newCountByPath?: Map<string, number>
  /** Noise classification: noise rows render dimmed with a Generated/Whitespace pill. */
  classByPath?: Map<string, FileClass>
  /** Viewed-file tracking; when present, rows get a check toggle + dimming. */
  viewed?: ViewedController
}) {
  return (
    <div className="flex flex-col py-1">
      {files.map((file, i) => {
        const path = filePath(file)
        const status = fileStatus(file)
        const selected = path === selectedPath
        const { dir, base } = splitPath(path)
        const counts = findingByPath?.get(path)
        const commentCount = commentByPath?.get(path) ?? 0
        const cls = classByPath?.get(path) ?? "meaningful"
        const noise = cls === "generated" || cls === "whitespace"
        const isViewed = viewed?.isViewed(path) ?? false
        return (
          <button
            key={`${path}-${i}`}
            type="button"
            onClick={() => onSelect(path)}
            title={path}
            data-path={path}
            aria-current={selected || undefined}
            className={cn(
              "flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors hover:bg-accent/60",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50",
              // Match the tree rows' touch growth — these two lists sit in the same panel.
              "pointer-coarse:min-h-11 pointer-coarse:py-2 pointer-coarse:text-sm",
              selected && "bg-accent hover:bg-accent",
              noise && !selected && "opacity-60"
            )}
          >
            <FileStatusIcon status={status} />
            <span
              className={cn(
                "flex min-w-0 flex-1 items-baseline overflow-hidden font-mono",
                isViewed && !selected && "text-muted-foreground/70",
              )}
            >
              {dir && (
                <span className="min-w-0 truncate text-muted-foreground">{dir}</span>
              )}
              <span className="shrink-0 font-medium">{base}</span>
            </span>
            {noise && <NoiseBadge kind={cls as "generated" | "whitespace"} />}
            <NewBadge count={newCountByPath?.get(path) ?? 0} />
            {commentCount > 0 && (
              <span
                className="flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground pointer-coarse:text-[11px]"
                title={`${commentCount} note${commentCount === 1 ? "" : "s"}`}
              >
                <MessageSquare className="size-3" />
                {commentCount}
              </span>
            )}
            {counts && (counts.secrets > 0 || counts.leftovers > 0) && (
              <span
                className={cn(
                  "size-1.5 shrink-0 rounded-full pointer-coarse:size-2",
                  counts.secrets > 0 ? CATEGORY_DOT.secret : CATEGORY_DOT.leftover,
                )}
                title={
                  counts.secrets > 0
                    ? `${counts.secrets} secret${counts.secrets === 1 ? "" : "s"}`
                    : `${counts.leftovers} leftover${counts.leftovers === 1 ? "" : "s"}`
                }
              />
            )}
            <DiffStatBar additions={file.additions} deletions={file.deletions} />
            <span className="shrink-0 font-mono tabular-nums">
              <span className="text-[var(--diff-add-marker)]">+{file.additions}</span>{" "}
              <span className="text-[var(--diff-del-marker)]">−{file.deletions}</span>
            </span>
            <ViewedCheck viewed={viewed} path={path} />
          </button>
        )
      })}
    </div>
  )
}
