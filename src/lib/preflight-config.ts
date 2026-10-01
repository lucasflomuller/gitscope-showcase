import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import path from "node:path"

import { CONFIG_DIR } from "@/lib/config"
import type { PreflightAllowlist } from "@/lib/types"

/** The pre-flight allowlist file: ~/.config/gitscope/preflight.json */
export const PREFLIGHT_PATH = path.join(CONFIG_DIR, "preflight.json")

/** On-disk shape: per-repo suppression lists keyed by repo id. */
type PreflightStore = Record<string, PreflightAllowlist>

const EMPTY: PreflightAllowlist = { ignoredIds: [], ignoredRuleIds: [] }

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string")
}

/** Read the whole store. Returns {} when the file is missing or corrupt. */
async function readStore(): Promise<PreflightStore> {
  try {
    const raw = await readFile(PREFLIGHT_PATH, "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const store: PreflightStore = {}
    for (const [id, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue
      const o = entry as Record<string, unknown>
      store[id] = {
        ignoredIds: isStringArray(o.ignoredIds) ? o.ignoredIds : [],
        ignoredRuleIds: isStringArray(o.ignoredRuleIds) ? o.ignoredRuleIds : [],
      }
    }
    return store
  } catch {
    return {}
  }
}

/** Persist the whole store (creates the config dir, pretty-prints JSON). */
async function writeStore(store: PreflightStore): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(PREFLIGHT_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8")
}

function normalize(a?: PreflightAllowlist): PreflightAllowlist {
  return {
    ignoredIds: a?.ignoredIds ?? [],
    ignoredRuleIds: a?.ignoredRuleIds ?? [],
  }
}

/** The allowlist for one repo (empty when none persisted). */
export async function getAllowlist(repoId: string): Promise<PreflightAllowlist> {
  const store = await readStore()
  return normalize(store[repoId]) ?? EMPTY
}

/** Add a per-finding (`id`) and/or per-rule (`ruleId`) ignore for a repo. */
export async function addIgnore(
  repoId: string,
  input: { id?: string; ruleId?: string },
): Promise<PreflightAllowlist> {
  const store = await readStore()
  const current = normalize(store[repoId])
  const ids = new Set(current.ignoredIds)
  const ruleIds = new Set(current.ignoredRuleIds)
  if (input.id) ids.add(input.id)
  if (input.ruleId) ruleIds.add(input.ruleId)
  const next: PreflightAllowlist = {
    ignoredIds: [...ids],
    ignoredRuleIds: [...ruleIds],
  }
  store[repoId] = next
  await writeStore(store)
  return next
}

/** Remove a per-finding (`id`) and/or per-rule (`ruleId`) ignore for a repo. */
export async function removeIgnore(
  repoId: string,
  input: { id?: string; ruleId?: string },
): Promise<PreflightAllowlist> {
  const store = await readStore()
  const current = normalize(store[repoId])
  const next: PreflightAllowlist = {
    ignoredIds: current.ignoredIds.filter((x) => x !== input.id),
    ignoredRuleIds: current.ignoredRuleIds.filter((x) => x !== input.ruleId),
  }
  store[repoId] = next
  await writeStore(store)
  return next
}
