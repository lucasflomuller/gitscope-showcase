import "server-only"

import { mkdir, readFile, writeFile } from "node:fs/promises"
import { randomBytes } from "node:crypto"
import path from "node:path"

import { CONFIG_DIR } from "@/lib/config"
import type { GuideSection, ReviewGuide } from "@/lib/types"

/** The review-guides file: ~/.config/gitscope/guides.json */
export const GUIDES_PATH = path.join(CONFIG_DIR, "guides.json")

/** On-disk shape: repoId → compareKey → the latest guide for that comparison. */
type GuideStore = Record<string, Record<string, ReviewGuide>>

/** The shared comparison key format (matches viewed/checkpoint stores). */
export function compareKeyFor(mode: string, base: string, compare: string): string {
  return `${mode}:${base}...${compare}`
}

function isString(v: unknown): v is string {
  return typeof v === "string"
}

function guideId(): string {
  return randomBytes(6).toString("hex")
}

/**
 * Sanitise submitted sections (from MCP or the CLI generator): drop malformed
 * entries, coerce paths to non-empty strings, generate missing ids, cap sizes
 * so a runaway agent can't bloat the store.
 */
function normalizeSections(input: unknown): GuideSection[] {
  if (!Array.isArray(input)) return []
  const sections: GuideSection[] = []
  for (const raw of input.slice(0, 30)) {
    if (!raw || typeof raw !== "object") continue
    const o = raw as Record<string, unknown>
    const title = isString(o.title) ? o.title.trim().slice(0, 200) : ""
    if (!title) continue
    const explanation = isString(o.explanation)
      ? o.explanation.trim().slice(0, 4000)
      : ""
    const paths = Array.isArray(o.paths)
      ? o.paths.filter(isString).map((p) => p.trim()).filter(Boolean).slice(0, 200)
      : []
    sections.push({
      id: isString(o.id) && o.id ? o.id.slice(0, 32) : guideId(),
      title,
      explanation,
      paths,
    })
  }
  return sections
}

/** Read the whole store. Returns {} when the file is missing or corrupt. */
async function readStore(): Promise<GuideStore> {
  try {
    const raw = await readFile(GUIDES_PATH, "utf8")
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return parsed as GuideStore
  } catch {
    return {}
  }
}

async function writeStore(store: GuideStore): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(GUIDES_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8")
}

/** The latest guide for one comparison, or null. */
export async function readGuide(
  repoId: string,
  compareKey: string,
): Promise<ReviewGuide | null> {
  const store = await readStore()
  return store[repoId]?.[compareKey] ?? null
}

/**
 * Store a guide for a comparison (replacing any previous one). Sections are
 * normalized/validated here — callers pass raw agent output straight through.
 * Throws when no valid section survives.
 */
export async function saveGuide(
  repoId: string,
  input: {
    compareKey: string
    title?: unknown
    summary?: unknown
    sections: unknown
    generatedBy: "mcp" | "cli"
  },
): Promise<ReviewGuide> {
  const sections = normalizeSections(input.sections)
  if (sections.length === 0) {
    throw new Error("A guide needs at least one section with a title")
  }
  const guide: ReviewGuide = {
    id: guideId(),
    compareKey: input.compareKey,
    title: isString(input.title) && input.title.trim()
      ? input.title.trim().slice(0, 200)
      : "Review guide",
    ...(isString(input.summary) && input.summary.trim()
      ? { summary: input.summary.trim().slice(0, 4000) }
      : {}),
    sections,
    generatedBy: input.generatedBy,
    createdAt: new Date().toISOString(),
  }
  const store = await readStore()
  store[repoId] = { ...(store[repoId] ?? {}), [input.compareKey]: guide }
  await writeStore(store)
  return guide
}

/** Remove the guide for one comparison (no-op when absent). */
export async function removeGuide(
  repoId: string,
  compareKey: string,
): Promise<void> {
  const store = await readStore()
  if (store[repoId]?.[compareKey]) {
    delete store[repoId][compareKey]
    if (Object.keys(store[repoId]).length === 0) delete store[repoId]
    await writeStore(store)
  }
}
