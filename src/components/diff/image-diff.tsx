"use client"

import { useState } from "react"

import type { DiffFileStatus } from "@/lib/types"

/**
 * Checkerboard behind transparent images so alpha edges stay visible. Tinted
 * off --foreground rather than a flat black: a black wash composites to within
 * a couple of steps of the dark surface, i.e. no checkerboard at all in dark.
 */
const CHECKER = "color-mix(in oklch, var(--foreground) 12%, transparent)"
const checkerStyle = {
  backgroundImage: `conic-gradient(${CHECKER} 25%, transparent 0 50%, ${CHECKER} 0 75%, transparent 0)`,
  backgroundSize: "16px 16px",
} as const

/** One labelled side ('Before'/'After'). Load failures degrade to a muted note. */
function ImageSide({ label, src, alt }: { label: string; src: string; alt: string }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground">{label}</span>
      {/* Both states carry the same min footprint so the frame holds its shape
          while the blob loads instead of snapping open when the bitmap decodes. */}
      {failed ? (
        <div className="flex min-h-32 min-w-32 items-center justify-center rounded-md border px-8 py-10 text-xs text-muted-foreground">
          Preview unavailable
        </div>
      ) : (
        <div
          className="flex min-h-32 min-w-32 items-center justify-center overflow-hidden rounded-md border"
          style={checkerStyle}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- dynamic blob endpoint, unknown dimensions */}
          <img
            src={src}
            alt={alt}
            className="max-h-[420px] max-w-full object-contain"
            loading="lazy"
            onError={() => setFailed(true)}
          />
        </div>
      )}
    </div>
  )
}

/**
 * Before/after viewer for binary image files, fed by the raw blob endpoint.
 * Sides follow the file status: added → after only, deleted → before only,
 * renamed → old path before / new path after.
 */
export function ImageDiff({
  repoId,
  baseRef,
  compareRef,
  path,
  oldPath,
  status,
}: {
  repoId: string | null
  baseRef: string
  compareRef: string
  path: string
  oldPath?: string
  status: DiffFileStatus
}) {
  const url = (ref: string, p: string) =>
    `/api/repos/${repoId}/blob?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(p)}&raw=1`
  const before =
    status === "added" ? null : url(baseRef, status === "renamed" ? (oldPath ?? path) : path)
  const after = status === "deleted" ? null : url(compareRef, path)

  return (
    <div className="flex flex-wrap items-start gap-4 p-4">
      {before && <ImageSide label="Before" src={before} alt={`${path} (before)`} />}
      {after && <ImageSide label="After" src={after} alt={`${path} (after)`} />}
    </div>
  )
}
