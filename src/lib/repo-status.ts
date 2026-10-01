/**
 * Client-safe helpers for rendering a RepoStatus (no `server-only`). Shared by
 * the sidebar and the cross-repo dashboard so the dirtiness encoding stays in
 * one place.
 */

import type { RepoStatus } from "@/lib/types"

/**
 * The compact "+staged ~unstaged ?untracked !conflicted" tokens for a dirty
 * repo (empty when clean). Order is fixed so it reads consistently everywhere.
 */
export function dirtBits(status: RepoStatus): string[] {
  const bits: string[] = []
  if (status.staged) bits.push(`+${status.staged}`)
  if (status.unstaged) bits.push(`~${status.unstaged}`)
  if (status.untracked) bits.push(`?${status.untracked}`)
  if (status.conflicted) bits.push(`!${status.conflicted}`)
  return bits
}

/** Total number of changed entries (staged + unstaged + untracked + conflicted). */
export function dirtyCount(status: RepoStatus): number {
  return status.staged + status.unstaged + status.untracked + status.conflicted
}
