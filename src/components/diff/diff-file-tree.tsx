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
  ChevronRight,
  CircleCheckBig,
  Eye,
  EyeOff,
  FileCog,
  FoldVertical,
  Folder,
  List,
  ListTree,
  MessageSquare,
  PanelLeftClose,
  Search,
  UnfoldVertical,
  X,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useLocalStorage } from "@/hooks/use-local-storage"
import type { ViewedController } from "@/hooks/use-viewed"
import { cn } from "@/lib/utils"

import { DiffFileList } from "./diff-file-list"
import {
  FileStatusIcon,
  ViewedCheck,
  fileStatus,
  filePath,
  type ParsedFile,
} from "./file-meta"
import type { FileClass } from "./noise"
import { CATEGORY_DOT, type FindingCounts } from "./preflight-meta"

type FileNode = {
  type: "file"
  name: string
  path: string
  file: ParsedFile
  additions: number
  deletions: number
  secrets: number
  leftovers: number
  comments: number
  newCount: number
}

type DirNode = {
  type: "dir"
  name: string
  path: string
  children: TreeNode[]
  additions: number
  deletions: number
  fileCount: number
  secrets: number
  leftovers: number
  comments: number
  newCount: number
}

type TreeNode = FileNode | DirNode

function rollUp(node: DirNode): void {
  let additions = 0
  let deletions = 0
  let fileCount = 0
  let secrets = 0
  let leftovers = 0
  let comments = 0
  let newCount = 0
  for (const child of node.children) {
    if (child.type === "dir") rollUp(child)
    additions += child.additions
    deletions += child.deletions
    secrets += child.secrets
    leftovers += child.leftovers
    comments += child.comments
    newCount += child.newCount
    fileCount += child.type === "dir" ? child.fileCount : 1
  }
  node.additions = additions
  node.deletions = deletions
  node.secrets = secrets
  node.leftovers = leftovers
  node.comments = comments
  node.newCount = newCount
  node.fileCount = fileCount
}

/** Tiny severity dot: red when any secret is present, else amber for leftovers. */
function FindingDot({ secrets, leftovers }: { secrets: number; leftovers: number }) {
  if (secrets === 0 && leftovers === 0) return null
  return (
    <span
      className={cn(
        "size-1.5 shrink-0 rounded-full pointer-coarse:size-2",
        secrets > 0 ? CATEGORY_DOT.secret : CATEGORY_DOT.leftover,
      )}
      title={
        secrets > 0
          ? `${secrets} secret${secrets === 1 ? "" : "s"}`
          : `${leftovers} leftover${leftovers === 1 ? "" : "s"}`
      }
    />
  )
}

/** Tiny "N notes" badge shown on file / folder rows that carry comments. */
function CommentBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      className="flex shrink-0 items-center gap-0.5 rounded bg-muted px-1 text-[10px] tabular-nums text-muted-foreground pointer-coarse:text-[11px]"
      title={`${count} note${count === 1 ? "" : "s"}`}
    >
      <MessageSquare className="size-3" />
      {count}
    </span>
  )
}

/** Amber "N new" badge for lines added since the review checkpoint. */
export function NewBadge({ count }: { count: number }) {
  if (count <= 0) return null
  return (
    <span
      className="shrink-0 rounded bg-amber-500/15 px-1 text-[10px] font-medium tabular-nums text-amber-600 dark:text-amber-400 pointer-coarse:text-[11px]"
      title={`${count} new line${count === 1 ? "" : "s"} since checkpoint`}
    >
      {count} new
    </span>
  )
}

/** Collapse chains of directories that contain a single subdirectory (VS Code style). */
function compress(node: TreeNode): TreeNode {
  if (node.type === "file") return node
  node.children = node.children.map(compress)
  while (node.children.length === 1 && node.children[0].type === "dir") {
    const only = node.children[0]
    node.name = node.name ? `${node.name}/${only.name}` : only.name
    node.path = only.path
    node.children = only.children
  }
  return node
}

function findingCounts(
  path: string,
  findingByPath?: Map<string, FindingCounts>,
): FindingCounts {
  return findingByPath?.get(path) ?? { secrets: 0, leftovers: 0 }
}

function sortTree(node: DirNode): void {
  node.children.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1
    return a.name.localeCompare(b.name)
  })
  for (const child of node.children) if (child.type === "dir") sortTree(child)
}

function buildTree(
  files: ParsedFile[],
  findingByPath?: Map<string, FindingCounts>,
  commentByPath?: Map<string, number>,
  newCountByPath?: Map<string, number>,
): DirNode {
  const root: DirNode = {
    type: "dir",
    name: "",
    path: "",
    children: [],
    additions: 0,
    deletions: 0,
    fileCount: 0,
    secrets: 0,
    leftovers: 0,
    comments: 0,
    newCount: 0,
  }

  for (const file of files) {
    const path = filePath(file)
    const parts = path.split("/")
    let cur = root
    for (let i = 0; i < parts.length - 1; i++) {
      const dirPath = parts.slice(0, i + 1).join("/")
      let next = cur.children.find(
        (c): c is DirNode => c.type === "dir" && c.path === dirPath,
      )
      if (!next) {
        next = {
          type: "dir",
          name: parts[i],
          path: dirPath,
          children: [],
          additions: 0,
          deletions: 0,
          fileCount: 0,
          secrets: 0,
          leftovers: 0,
          comments: 0,
          newCount: 0,
        }
        cur.children.push(next)
      }
      cur = next
    }
    const counts = findingCounts(path, findingByPath)
    cur.children.push({
      type: "file",
      name: parts[parts.length - 1],
      path,
      file,
      additions: file.additions,
      deletions: file.deletions,
      secrets: counts.secrets,
      leftovers: counts.leftovers,
      comments: commentByPath?.get(path) ?? 0,
      newCount: newCountByPath?.get(path) ?? 0,
    })
  }

  root.children = root.children.map(compress)
  rollUp(root)
  sortTree(root)
  return root
}

function collectDirPaths(node: DirNode, acc: string[]): void {
  for (const child of node.children) {
    if (child.type === "dir") {
      acc.push(child.path)
      collectDirPaths(child, acc)
    }
  }
}

// Touch devices get taller rows / bigger text via the pointer-coarse variant,
// regardless of viewport width (so it applies on a landscape tablet too).
// The focus ring is inset because rows run edge-to-edge inside the ScrollArea
// viewport, which would clip an outset ring on the left/right.
const rowBase =
  "flex w-full items-center pr-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50 py-1.5 text-xs pointer-coarse:min-h-11 pointer-coarse:py-2 pointer-coarse:text-sm"
const treeIconCls = "size-3.5 shrink-0 pointer-coarse:size-4"

function StatCounts({
  additions,
  deletions,
  muted,
}: {
  additions: number
  deletions: number
  muted?: boolean
}) {
  return (
    <span className="shrink-0 font-mono text-[11px] tabular-nums pointer-coarse:text-xs">
      {additions > 0 && (
        <span className={cn(muted ? "text-muted-foreground/70" : "text-[var(--diff-add-marker)]")}>
          +{additions}
        </span>
      )}
      {additions > 0 && deletions > 0 ? " " : ""}
      {deletions > 0 && (
        <span className={cn(muted ? "text-muted-foreground/70" : "text-[var(--diff-del-marker)]")}>
          −{deletions}
        </span>
      )}
    </span>
  )
}

function TreeRows({
  nodes,
  depth,
  collapsed,
  forceExpand,
  onToggle,
  selectedPath,
  onSelect,
  viewed,
}: {
  nodes: TreeNode[]
  depth: number
  collapsed: Set<string>
  forceExpand: boolean
  onToggle: (path: string) => void
  selectedPath: string | null
  onSelect: (path: string) => void
  viewed?: ViewedController
}) {
  return (
    <>
      {nodes.map((node) => {
        if (node.type === "file") {
          const selected = node.path === selectedPath
          const isViewed = viewed?.isViewed(node.path) ?? false
          return (
            <button
              key={node.path}
              type="button"
              onClick={() => onSelect(node.path)}
              title={node.path}
              data-path={node.path}
              style={{ paddingLeft: depth * 12 + 28 }}
              aria-current={selected || undefined}
              className={cn(rowBase, "gap-1.5", selected && "bg-accent hover:bg-accent")}
            >
              <FileStatusIcon status={fileStatus(node.file)} className={treeIconCls} />
              <span
                className={cn(
                  "min-w-0 flex-1 truncate font-mono",
                  isViewed && !selected && "text-muted-foreground/70",
                )}
              >
                {node.name}
              </span>
              <CommentBadge count={node.comments} />
              <NewBadge count={node.newCount} />
              <FindingDot secrets={node.secrets} leftovers={node.leftovers} />
              <StatCounts additions={node.additions} deletions={node.deletions} />
              <ViewedCheck viewed={viewed} path={node.path} />
            </button>
          )
        }

        const open = forceExpand || !collapsed.has(node.path)
        return (
          <Fragment key={node.path}>
            <button
              type="button"
              onClick={() => onToggle(node.path)}
              title={node.path}
              style={{ paddingLeft: depth * 12 + 8 }}
              aria-expanded={open}
              className={cn(rowBase, "gap-1")}
            >
              <ChevronRight
                className={cn(
                  treeIconCls,
                  "text-muted-foreground transition-transform",
                  open && "rotate-90",
                )}
              />
              <Folder className={cn(treeIconCls, "text-muted-foreground")} />
              <span className="min-w-0 flex-1 truncate font-medium text-muted-foreground">
                {node.name}
              </span>
              <CommentBadge count={node.comments} />
              <NewBadge count={node.newCount} />
              <FindingDot secrets={node.secrets} leftovers={node.leftovers} />
              <StatCounts additions={node.additions} deletions={node.deletions} muted />
            </button>
            {open && (
              <TreeRows
                nodes={node.children}
                depth={depth + 1}
                collapsed={collapsed}
                forceExpand={forceExpand}
                onToggle={onToggle}
                selectedPath={selectedPath}
                onSelect={onSelect}
                viewed={viewed}
              />
            )}
          </Fragment>
        )
      })}
    </>
  )
}

export function DiffFileTree({
  files,
  selectedPath,
  onSelect,
  onCollapsePanel,
  findingByPath,
  commentByPath,
  newCountByPath,
  classByPath,
  meaningfulCount,
  showGenerated,
  showWhitespace,
  viewed,
  headerControls,
}: {
  files: ParsedFile[]
  selectedPath: string | null
  onSelect: (path: string) => void
  onCollapsePanel?: () => void
  findingByPath?: Map<string, FindingCounts>
  /** Comment counts per path; drives the file/folder note badges. */
  commentByPath?: Map<string, number>
  /** New-since-checkpoint line counts per path; drives the "N new" badges. */
  newCountByPath?: Map<string, number>
  /** Noise classification per path; when present, noise files move to a group. */
  classByPath?: Map<string, FileClass>
  /** Count of meaningful files (for the "N of M files meaningful" header). */
  meaningfulCount?: number
  showGenerated?: boolean
  showWhitespace?: boolean
  /** Viewed-file tracking; when present, rows get a check toggle + dimming. */
  viewed?: ViewedController
  /** Extra controls rendered in the header (used to host the readability menu in compact mode). */
  headerControls?: ReactNode
}) {
  const [mode, setMode] = useLocalStorage<"tree" | "list">("gitscope.fileView", "tree")
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [filter, setFilter] = useState("")
  const [noiseOpen, setNoiseOpen] = useState(false)
  const [hideViewed, setHideViewed] = useLocalStorage("gitscope.hideViewed", false)
  const [viewedGroupOpen, setViewedGroupOpen] = useState(false)

  // Keep the selected row visible while j/k (or the palette) drives selection.
  const rootRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!selectedPath) return
    rootRef.current
      ?.querySelector(`[data-path="${CSS.escape(selectedPath)}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [selectedPath])

  const needle = filter.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      needle
        ? files.filter((f) => filePath(f).toLowerCase().includes(needle))
        : files,
    [files, needle],
  )

  // Partition into meaningful (main tree/list) and noise (bottom collapsible group).
  const isNoise = useCallback(
    (f: ParsedFile): boolean => {
      const c = classByPath?.get(filePath(f))
      return c === "generated" || c === "whitespace"
    },
    [classByPath],
  )
  const meaningfulFiles = useMemo(
    () => (classByPath ? filtered.filter((f) => !isNoise(f)) : filtered),
    [filtered, classByPath, isNoise],
  )
  const noiseFiles = useMemo(
    () => (classByPath ? filtered.filter(isNoise) : []),
    [filtered, classByPath, isNoise],
  )

  // Optionally partition meaningful files into unviewed (main tree/list) and a
  // collapsed "Viewed" group — mirrors the noiseGroup split, but keyed on the
  // viewed set (isViewed identity changes on toggle, so this stays fresh).
  const isViewedFn = viewed?.isViewed
  const hideActive = hideViewed && Boolean(viewed)
  const mainFiles = useMemo(
    () =>
      hideActive && isViewedFn
        ? meaningfulFiles.filter((f) => !isViewedFn(filePath(f)))
        : meaningfulFiles,
    [hideActive, isViewedFn, meaningfulFiles],
  )
  const viewedFiles = useMemo(
    () =>
      hideActive && isViewedFn
        ? meaningfulFiles.filter((f) => isViewedFn(filePath(f)))
        : [],
    [hideActive, isViewedFn, meaningfulFiles],
  )

  const tree = useMemo(
    () => buildTree(mainFiles, findingByPath, commentByPath, newCountByPath),
    [mainFiles, findingByPath, commentByPath, newCountByPath],
  )
  const allDirPaths = useMemo(() => {
    const acc: string[] = []
    collectDirPaths(tree, acc)
    return acc
  }, [tree])

  function toggleDir(path: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const headerBtn = "pointer-coarse:size-9"

  const hasNoiseOverall =
    typeof meaningfulCount === "number" && meaningfulCount < files.length

  const groupOpen =
    noiseOpen ||
    Boolean(showGenerated) ||
    Boolean(showWhitespace) ||
    needle.length > 0 ||
    mainFiles.length === 0

  // Default collapsed; force-open while a filter needle is active (mirrors noiseGroup).
  const viewedGroupForceOpen = viewedGroupOpen || needle.length > 0
  const viewedGroup =
    hideActive && viewedFiles.length > 0 ? (
      <div className={cn(mainFiles.length > 0 && "mt-1 border-t pt-1")}>
        <button
          type="button"
          onClick={() => setViewedGroupOpen((v) => !v)}
          style={{ paddingLeft: 8 }}
          title="Files you've marked viewed"
          aria-expanded={viewedGroupForceOpen}
          className={cn(rowBase, "gap-1 text-muted-foreground")}
        >
          <ChevronRight
            className={cn(
              treeIconCls,
              "transition-transform",
              viewedGroupForceOpen && "rotate-90",
            )}
          />
          <CircleCheckBig className={treeIconCls} />
          <span className="min-w-0 flex-1 truncate font-medium">Viewed</span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums pointer-coarse:text-xs">
            {viewedFiles.length}
          </span>
        </button>
        {viewedGroupForceOpen && (
          <DiffFileList
            files={viewedFiles}
            selectedPath={selectedPath}
            onSelect={onSelect}
            findingByPath={findingByPath}
            commentByPath={commentByPath}
            newCountByPath={newCountByPath}
            classByPath={classByPath}
            viewed={viewed}
          />
        )}
      </div>
    ) : null

  const noiseGroup =
    noiseFiles.length > 0 ? (
      <div
        className={cn(
          (mainFiles.length > 0 || viewedFiles.length > 0) && "mt-1 border-t pt-1",
        )}
      >
        <button
          type="button"
          onClick={() => setNoiseOpen((v) => !v)}
          style={{ paddingLeft: 8 }}
          title="Generated, lockfile & whitespace-only changes"
          aria-expanded={groupOpen}
          className={cn(rowBase, "gap-1 text-muted-foreground")}
        >
          <ChevronRight
            className={cn(treeIconCls, "transition-transform", groupOpen && "rotate-90")}
          />
          <FileCog className={treeIconCls} />
          <span className="min-w-0 flex-1 truncate font-medium">Generated &amp; noise</span>
          <span className="shrink-0 font-mono text-[11px] tabular-nums pointer-coarse:text-xs">
            {noiseFiles.length}
          </span>
        </button>
        {groupOpen && (
          <DiffFileList
            files={noiseFiles}
            selectedPath={selectedPath}
            onSelect={onSelect}
            findingByPath={findingByPath}
            commentByPath={commentByPath}
            newCountByPath={newCountByPath}
            classByPath={classByPath}
            viewed={viewed}
          />
        )}
      </div>
    ) : null

  return (
    <div ref={rootRef} className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-1 border-b px-2 py-1.5">
        <span
          role="status"
          aria-live="polite"
          className="truncate text-xs font-medium tabular-nums text-muted-foreground pointer-coarse:text-sm"
        >
          {needle
            ? `${filtered.length} of ${files.length}`
            : hasNoiseOverall
              ? `${meaningfulCount} of ${files.length} meaningful`
              : `${files.length} ${files.length === 1 ? "file" : "files"}`}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          {headerControls}
          {viewed && (
            <Button
              size="icon-xs"
              variant={hideViewed ? "secondary" : "ghost"}
              className={cn(headerBtn, !hideViewed && "text-muted-foreground")}
              title="Hide viewed files"
              aria-label="Hide viewed files"
              aria-pressed={hideViewed}
              onClick={() => setHideViewed(!hideViewed)}
            >
              {hideViewed ? <EyeOff /> : <Eye />}
            </Button>
          )}
          {mode === "tree" && (
            <>
              <Button
                size="icon-xs"
                variant="ghost"
                className={headerBtn}
                title="Expand all"
                aria-label="Expand all"
                onClick={() => setCollapsed(new Set())}
              >
                <UnfoldVertical />
              </Button>
              <Button
                size="icon-xs"
                variant="ghost"
                className={headerBtn}
                title="Collapse all"
                aria-label="Collapse all"
                onClick={() => setCollapsed(new Set(allDirPaths))}
              >
                <FoldVertical />
              </Button>
            </>
          )}
          <Button
            size="icon-xs"
            variant="ghost"
            className={headerBtn}
            title={mode === "tree" ? "List view" : "Tree view"}
            aria-label="Toggle file view"
            onClick={() => setMode(mode === "tree" ? "list" : "tree")}
          >
            {mode === "tree" ? <List /> : <ListTree />}
          </Button>
          {onCollapsePanel && (
            <Button
              size="icon-xs"
              variant="ghost"
              className={headerBtn}
              title="Hide file panel"
              aria-label="Hide file panel"
              onClick={onCollapsePanel}
            >
              <PanelLeftClose />
            </Button>
          )}
        </div>
      </div>

      <div className="border-b px-2 py-1.5">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter files…"
            aria-label="Filter files"
            className="h-7 pl-8 pr-8 text-xs pointer-coarse:h-10 pointer-coarse:pr-11 pointer-coarse:text-base"
          />
          {filter && (
            <Button
              size="icon-xs"
              variant="ghost"
              className={cn(
                headerBtn,
                // Auto margins, not -translate-y-1/2: the button's active press
                // nudge writes the same --tw-translate-y at higher specificity.
                "absolute inset-y-0 right-1 my-auto text-muted-foreground",
              )}
              title="Clear filter"
              aria-label="Clear filter"
              onClick={() => setFilter("")}
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        {filtered.length === 0 ? (
          <div className="p-4 text-center text-xs text-muted-foreground">
            No files match “{filter}”.
          </div>
        ) : (
          <>
            {mainFiles.length > 0 &&
              (mode === "list" ? (
                <DiffFileList
                  files={mainFiles}
                  selectedPath={selectedPath}
                  onSelect={onSelect}
                  findingByPath={findingByPath}
                  commentByPath={commentByPath}
                  newCountByPath={newCountByPath}
                  classByPath={classByPath}
                  viewed={viewed}
                />
              ) : (
                <div className="py-1">
                  <TreeRows
                    nodes={tree.children}
                    depth={0}
                    collapsed={collapsed}
                    forceExpand={needle.length > 0}
                    onToggle={toggleDir}
                    selectedPath={selectedPath}
                    onSelect={onSelect}
                    viewed={viewed}
                  />
                </div>
              ))}
            {viewedGroup}
            {noiseGroup}
          </>
        )}
      </ScrollArea>
    </div>
  )
}
