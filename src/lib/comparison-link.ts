import "server-only"
import { git } from "@/lib/git"
import { serializeUrl, type RefRef } from "@/lib/url-state"
import type { DiffMode } from "@/lib/types"

export function publicUrl(): URL {
  const url = new URL(process.env.GITSCOPE_PUBLIC_URL || "http://127.0.0.1:3000")
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error("GITSCOPE_PUBLIC_URL must be an HTTP(S) origin without credentials, path, query or fragment")
  }
  return url
}

export async function resolveCommit(repoPath: string, ref: string): Promise<string> {
  if (!ref || ref.startsWith('-') || /[\x00-\x1f]/.test(ref)) throw new Error(`Invalid ref: ${ref}`)
  try {
    return (await git(repoPath).raw(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim()
  } catch {
    throw new Error(`Ref does not resolve to a commit: ${ref}`)
  }
}

export async function validateComparison(repoPath: string, base: string, compare: string, mode: DiffMode) {
  const baseCommit = await resolveCommit(repoPath, base)
  const compareCommit = ['WORKING', 'STAGED'].includes(compare) ? null : await resolveCommit(repoPath, compare)
  if (compareCommit && mode === 'merge-base') {
    try {
      const ancestor = await git(repoPath).raw(['merge-base', baseCommit, compareCommit])
      if (!ancestor.trim()) throw new Error('No common ancestor')
    }
    catch { throw new Error('Refs have no common ancestor; use direct mode') }
  }
  return { baseCommit, compareCommit }
}

async function refFor(repoPath: string, ref: string): Promise<RefRef> {
  if (ref === 'WORKING') return { kind: 'working', ref }
  if (ref === 'STAGED') return { kind: 'staged', ref }
  if (ref === 'HEAD') return { kind: 'head', ref }
  const symbolic = (await git(repoPath).raw(['rev-parse', '--symbolic-full-name', '--verify', '--end-of-options', ref])).trim()
  if (symbolic.startsWith('refs/heads/')) return { kind: 'branch', ref }
  if (symbolic.startsWith('refs/remotes/')) return { kind: 'remote', ref }
  if (symbolic.startsWith('refs/tags/')) return { kind: 'tag', ref }
  return { kind: 'commit', ref }
}

export async function comparisonLink(repo: { id: string; path: string }, cmp: { base: string; compare: string; mode: DiffMode }, pin: boolean, file?: string) {
  const resolved = await validateComparison(repo.path, cmp.base, cmp.compare, cmp.mode)
  if (pin && !resolved.compareCommit) throw new Error('Working tree and staged comparisons cannot be pinned; commit the changes first')
  const base = pin ? { kind: 'commit' as const, ref: resolved.baseCommit } : await refFor(repo.path, cmp.base)
  const compare = pin ? { kind: 'commit' as const, ref: resolved.compareCommit! } : await refFor(repo.path, cmp.compare)
  const url = new URL(publicUrl())
  url.search = serializeUrl({ repo: repo.id, base, compare, mode: cmp.mode, file: file || null })
  return { url: url.href, repoId: repo.id, ...cmp, ...resolved, pinned: pin, access: url.hostname.endsWith('.ts.net') ? 'tailnet' : 'configured-origin' }
}
