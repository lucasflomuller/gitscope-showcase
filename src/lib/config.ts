import "server-only"

import { createHash, randomUUID } from "node:crypto"
import { existsSync, statSync } from "node:fs"
import { mkdir, readFile, writeFile, rename } from "node:fs/promises"
import { homedir } from "node:os"
import path from "node:path"

import type { RepoConfig } from "@/lib/types"

/** Directory where GitScope persists its state: ~/.config/gitscope */
export const CONFIG_DIR = process.env.GITSCOPE_CONFIG_DIR || path.join(homedir(), ".config", "gitscope")

/** The repo list file: ~/.config/gitscope/repos.json */
export const CONFIG_PATH = path.join(CONFIG_DIR, "repos.json")

/** Stable, short id derived from the repo's absolute path. */
export function repoId(absPath: string): string {
  return createHash("sha1").update(absPath).digest("hex").slice(0, 12)
}

/** Expand a leading `~` / `~/` to the user's home directory. */
function expandTilde(p: string): string {
  if (p === "~") return homedir()
  if (p.startsWith("~/") || p.startsWith("~\\")) {
    return path.join(homedir(), p.slice(2))
  }
  return p
}

/** Narrow an arbitrary parsed value to a well-formed RepoConfig. */
function isRepoConfig(v: unknown): v is RepoConfig {
  if (!v || typeof v !== "object") return false
  const o = v as Record<string, unknown>
  return (
    typeof o.id === "string" &&
    typeof o.path === "string" &&
    typeof o.name === "string" &&
    typeof o.addedAt === "string"
  )
}

/** Read the registered repos. Returns [] when the file is missing or corrupt. */
export async function readConfig(): Promise<RepoConfig[]> {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isRepoConfig)
  } catch {
    return []
  }
}

/** Persist the repo list (creates the config dir, pretty-prints JSON). */
export async function writeConfig(repos: RepoConfig[]): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  const temporary = `${CONFIG_PATH}.${randomUUID()}.tmp`
  await writeFile(temporary, `${JSON.stringify(repos, null, 2)}\n`, { encoding: "utf8", mode: 0o600 })
  await rename(temporary, CONFIG_PATH)
}

/** Look up a single registered repo by its id. */
export async function getRepo(id: string): Promise<RepoConfig | undefined> {
  const repos = await readConfig()
  return repos.find((r) => r.id === id)
}

// Serialize registry mutations within the single-user server; atomic rename
// also keeps concurrent readers from seeing partially written JSON.
let registryQueue: Promise<unknown> = Promise.resolve()
function mutateRegistry<T>(action: () => Promise<T>): Promise<T> {
  const result = registryQueue.then(action)
  registryQueue = result.catch(() => {})
  return result
}

/**
 * Register a repository.
 * Expands `~`, resolves to an absolute path, validates it is a directory that
 * contains a `.git` entry (a dir for the main repo, a file for a linked
 * worktree), and de-duplicates by id. Throws on invalid input.
 */
async function addRepoUnlocked(input: {
  path: string
  name?: string
}): Promise<RepoConfig> {
  const raw = (input.path ?? "").trim()
  if (!raw) throw new Error("A repository path is required.")

  const abs = path.resolve(expandTilde(raw))

  if (!existsSync(abs)) {
    throw new Error(`Path does not exist: ${abs}`)
  }

  let isDir = false
  try {
    isDir = statSync(abs).isDirectory()
  } catch {
    throw new Error(`Cannot access path: ${abs}`)
  }
  if (!isDir) {
    throw new Error(`Not a directory: ${abs}`)
  }

  if (!existsSync(path.join(abs, ".git"))) {
    throw new Error(`Not a git repository (no .git found): ${abs}`)
  }

  const id = repoId(abs)
  const repos = await readConfig()

  const existing = repos.find((r) => r.id === id)
  if (existing) return existing

  const name = input.name?.trim() || path.basename(abs)
  const repo: RepoConfig = {
    id,
    path: abs,
    name,
    addedAt: new Date().toISOString(),
  }

  repos.push(repo)
  await writeConfig(repos)
  return repo
}

export function addRepo(input: { path: string; name?: string }): Promise<RepoConfig> {
  return mutateRegistry(() => addRepoUnlocked(input))
}

/** Unregister a repository by id (no-op when it is not present). */
export async function removeRepo(id: string): Promise<void> {
  return mutateRegistry(async () => {
  const repos = await readConfig()
  const next = repos.filter((r) => r.id !== id)
  if (next.length !== repos.length) {
    await writeConfig(next)
  }
  })
}
