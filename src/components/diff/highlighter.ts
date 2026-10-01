"use client"

/**
 * Client-only Shiki singleton + dual-theme tokenizer.
 *
 * Shiki is loaded via dynamic import the first time a diff is highlighted, so it
 * never weighs on first paint. Languages are loaded lazily and cached. We emit
 * BOTH theme colors per token (`codeToTokensWithThemes`) so switching light/dark
 * is instant (a CSS var swap) with no re-tokenize and no flash.
 *
 * MUST NOT import any server-only/git module — this runs in the browser.
 */

import type { ThemedTokenWithVariants } from "@shikijs/types"

/** Bundled Shiki theme ids used for the light / dark variants. */
const LIGHT = "github-light"
const DARK = "github-dark"

/** A token carrying both theme foreground colors (empty string = inherit). */
export interface ThemedToken {
  content: string
  light: string
  dark: string
}

// File extension → Shiki bundled language id. Unknown extensions render plain.
const EXT_LANG: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  styl: "stylus",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  py: "python",
  pyi: "python",
  go: "go",
  rs: "rust",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  rb: "ruby",
  php: "php",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  cs: "csharp",
  swift: "swift",
  scala: "scala",
  dart: "dart",
  sh: "shellscript",
  bash: "shellscript",
  zsh: "shellscript",
  fish: "fish",
  ps1: "powershell",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  ini: "ini",
  cfg: "ini",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  prisma: "prisma",
  proto: "proto",
  lua: "lua",
  r: "r",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  clj: "clojure",
  elm: "elm",
  vim: "viml",
  tf: "terraform",
  hcl: "hcl",
  nix: "nix",
  zig: "zig",
  diff: "diff",
  patch: "diff",
}

// Extension-less filenames that still have a known grammar.
const FILENAME_LANG: Record<string, string> = {
  dockerfile: "docker",
  makefile: "make",
  gnumakefile: "make",
  cmakelists: "cmake",
}

/** Map a file path to a Shiki language id, or null when it should render plain. */
export function detectLang(path: string): string | null {
  const base = path.slice(path.lastIndexOf("/") + 1).toLowerCase()

  // Dotfiles / extension-less names.
  const named = FILENAME_LANG[base]
  if (named) return named
  if (base.startsWith("dockerfile")) return "docker"

  const dot = base.lastIndexOf(".")
  if (dot === -1) return null
  const ext = base.slice(dot + 1)
  return EXT_LANG[ext] ?? null
}

// ── Singleton + lazy language loading ─────────────────────────────────────────

type ShikiHighlighter = {
  loadLanguage: (lang: string) => Promise<void>
  codeToTokensWithThemes: (
    code: string,
    options: {
      lang: string
      themes: { light: string; dark: string }
      tokenizeMaxLineLength?: number
    },
  ) => ThemedTokenWithVariants[][]
}

let highlighterPromise: Promise<ShikiHighlighter> | null = null
const loadedLangs = new Set<string>()

async function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki").then((mod) =>
      mod.getSingletonHighlighter({ themes: [LIGHT, DARK], langs: [] }),
    ) as Promise<ShikiHighlighter>
  }
  return highlighterPromise
}

async function ensureLang(hl: ShikiHighlighter, lang: string): Promise<boolean> {
  if (loadedLangs.has(lang)) return true
  try {
    await hl.loadLanguage(lang)
    loadedLangs.add(lang)
    return true
  } catch {
    return false
  }
}

/**
 * Tokenize `code` for both themes. Returns per-line token arrays, or null when
 * the input is empty, the language can't be loaded, or tokenizing throws — in
 * every failure case the caller falls back to plain text.
 */
export async function tokenizeDualTheme(
  code: string,
  lang: string,
): Promise<ThemedToken[][] | null> {
  if (!code) return null
  let hl: ShikiHighlighter
  try {
    hl = await getHighlighter()
  } catch {
    return null
  }
  if (!(await ensureLang(hl, lang))) return null

  let lines: ThemedTokenWithVariants[][]
  try {
    lines = hl.codeToTokensWithThemes(code, {
      lang,
      themes: { light: LIGHT, dark: DARK },
      // Skip pathologically long lines (minified blobs) for responsiveness.
      tokenizeMaxLineLength: 2000,
    })
  } catch {
    return null
  }

  return lines.map((line) =>
    line.map((t) => ({
      content: t.content,
      light: t.variants.light?.color ?? "",
      dark: t.variants.dark?.color ?? "",
    })),
  )
}
