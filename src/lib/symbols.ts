import "server-only"

import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { createRequire } from "node:module"
import path from "node:path"

import { Language, type Node, Parser } from "web-tree-sitter"

import { git } from "@/lib/git"
import type { SymbolKind, SymbolNode } from "@/lib/types"

/**
 * Server-only tree-sitter "touched symbols" parser.
 *
 * Why tree-sitter (not a language server): GitScope diffs ARBITRARY refs, but a
 * language server only knows files on disk. tree-sitter is content-addressed —
 * we parse the file content AT THE COMPARE REF, so the symbols are correct for
 * exactly the diff being shown, on every ref.
 *
 * Everything here is best-effort: an unknown extension, missing blob, or parse
 * failure yields `[]` and NEVER throws. The diff must render byte-identically
 * when symbols are unavailable (graceful like Shiki, not like preflight).
 */

// ── Grammar selection (JS/TS family first — the user's stack) ─────────────────
// Extension → @vscode/tree-sitter-wasm grammar file stem. Unknown → null (no-op).
const EXT_GRAMMAR: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  pyi: "python",
  go: "go",
  rs: "rust",
  java: "java",
}

/** The tree-sitter grammar name for a path, or null when unsupported. */
export function grammarForPath(filePath: string): string | null {
  const base = filePath.slice(filePath.lastIndexOf("/") + 1).toLowerCase()
  const dot = base.lastIndexOf(".")
  if (dot === -1) return null
  return EXT_GRAMMAR[base.slice(dot + 1)] ?? null
}

// ── Module-level, HMR-safe cache (pinned to globalThis) ───────────────────────
// The emscripten core is initialized once; each grammar `Language` is loaded
// once. Pinning to globalThis survives Next.js dev HMR (a naive module-scope
// singleton would re-init/leak on every save).
interface TSCache {
  init?: Promise<void>
  langs: Map<string, Promise<Language | null>>
}

const G = globalThis as typeof globalThis & { __gitscopeTreeSitter?: TSCache }

function cache(): TSCache {
  if (!G.__gitscopeTreeSitter) {
    G.__gitscopeTreeSitter = { langs: new Map() }
  }
  return G.__gitscopeTreeSitter
}

/** Resolve a package file via node's resolver, tolerating any failure. */
function tryResolve(spec: string): string | null {
  try {
    return createRequire(import.meta.url).resolve(spec)
  } catch {
    return null
  }
}

/** Absolute path to the emscripten core wasm (web-tree-sitter.wasm). */
function resolveCoreWasm(): string {
  // cwd-first (next dev runs from the project root) then node resolution.
  const cwdPath = path.join(
    process.cwd(),
    "node_modules",
    "web-tree-sitter",
    "web-tree-sitter.wasm",
  )
  if (existsSync(cwdPath)) return cwdPath
  return tryResolve("web-tree-sitter/web-tree-sitter.wasm") ?? cwdPath
}

/** Absolute path to a prebuilt grammar wasm, or null when not found. */
function resolveGrammarWasm(grammar: string): string | null {
  const candidates = [
    path.join(
      process.cwd(),
      "node_modules",
      "@vscode",
      "tree-sitter-wasm",
      "wasm",
      `tree-sitter-${grammar}.wasm`,
    ),
  ]
  const pkg = tryResolve("@vscode/tree-sitter-wasm/package.json")
  if (pkg) {
    candidates.push(path.join(path.dirname(pkg), "wasm", `tree-sitter-${grammar}.wasm`))
  }
  return candidates.find((c) => existsSync(c)) ?? null
}

/** Initialize the emscripten core exactly once. Resolves false on failure. */
async function ensureInit(): Promise<boolean> {
  const c = cache()
  if (!c.init) {
    const core = resolveCoreWasm()
    c.init = Parser.init({
      // Emscripten asks for "web-tree-sitter.wasm"; hand it the resolved path.
      locateFile: (name: string) => (name.endsWith(".wasm") ? core : name),
    })
  }
  try {
    await c.init
    return true
  } catch {
    c.init = undefined // allow a later retry
    return false
  }
}

/** Load (and cache) a grammar Language. Resolves null on any failure. */
function loadLanguage(grammar: string): Promise<Language | null> {
  const c = cache()
  let p = c.langs.get(grammar)
  if (!p) {
    p = (async () => {
      const file = resolveGrammarWasm(grammar)
      if (!file) return null
      return await Language.load(file)
    })().catch(() => null)
    c.langs.set(grammar, p)
  }
  return p
}

// ── Compare-side content resolution (mirrors getDiff's sentinels) ─────────────
/**
 * Read the file content for the COMPARE side, honoring the same sentinels
 * `getDiff` uses: WORKING → working-tree file on disk, STAGED → `git show :path`,
 * else → `git show <ref>:path`. Returns null on any failure / missing content.
 */
async function readCompareContent(
  repoPath: string,
  ref: string,
  filePath: string,
): Promise<string | null> {
  try {
    if (ref === "WORKING") {
      return await readFile(path.join(repoPath, filePath), "utf8")
    }
    const spec = ref === "STAGED" ? `:${filePath}` : `${ref}:${filePath}`
    return await git(repoPath).raw(["show", spec])
  } catch {
    return null
  }
}

// ── Tree walking ──────────────────────────────────────────────────────────────
/** Soft cap on source size — skip pathological/minified blobs. */
const MAX_SOURCE_BYTES = 2_000_000

/** Declaration node types we unwrap out of an `export_statement`. */
const DECL_TYPES = new Set([
  "function_declaration",
  "generator_function_declaration",
  "function_signature",
  "class_declaration",
  "abstract_class_declaration",
  "interface_declaration",
  "type_alias_declaration",
  "enum_declaration",
  "lexical_declaration",
  "variable_declaration",
])

/** Value node types that make a `const`/field a function or component symbol. */
const FN_VALUE = new Set([
  "arrow_function",
  "function_expression",
  "generator_function",
])

function fieldText(node: Node, field: string): string | null {
  const n = node.childForFieldName(field)
  return n ? n.text : null
}

function push(
  out: SymbolNode[],
  name: string | null,
  kind: SymbolKind,
  node: Node,
  depth: number,
): void {
  if (!name) return
  out.push({
    name,
    kind,
    startLine: node.startPosition.row + 1,
    endLine: node.endPosition.row + 1,
    depth,
  })
}

/** Arrow/function-valued declarations named in PascalCase read as components. */
function constKind(name: string): SymbolKind {
  return /^[A-Z]/.test(name) ? "component" : "function"
}

function collect(node: Node, depth: number, out: SymbolNode[]): void {
  for (const child of node.namedChildren) {
    if (child) handle(child, depth, out)
  }
}

function handle(node: Node, depth: number, out: SymbolNode[]): void {
  let decl: Node = node
  if (node.type === "export_statement") {
    const inner = node.namedChildren.find((c) => c != null && DECL_TYPES.has(c.type))
    if (!inner) return
    decl = inner
  }

  switch (decl.type) {
    case "function_declaration":
    case "generator_function_declaration":
    case "function_signature": {
      push(out, fieldText(decl, "name"), "function", decl, depth)
      const body = decl.childForFieldName("body")
      if (body) collect(body, depth + 1, out)
      return
    }
    case "class_declaration":
    case "abstract_class_declaration": {
      push(out, fieldText(decl, "name"), "class", decl, depth)
      const body = decl.childForFieldName("body")
      if (body) collectClassBody(body, depth + 1, out)
      return
    }
    case "interface_declaration":
      push(out, fieldText(decl, "name"), "interface", decl, depth)
      return
    case "type_alias_declaration":
      push(out, fieldText(decl, "name"), "type", decl, depth)
      return
    case "enum_declaration":
      push(out, fieldText(decl, "name"), "enum", decl, depth)
      return
    case "lexical_declaration":
    case "variable_declaration": {
      for (const d of decl.namedChildren) {
        if (!d || d.type !== "variable_declarator") continue
        const value = d.childForFieldName("value")
        const name = fieldText(d, "name")
        if (value && name && FN_VALUE.has(value.type)) {
          push(out, name, constKind(name), d, depth)
          const body = value.childForFieldName("body")
          if (body) collect(body, depth + 1, out)
        }
      }
      return
    }
    default:
      // Descend into blocks/statements to reach nested declarations.
      collect(decl, depth, out)
      return
  }
}

function collectClassBody(body: Node, depth: number, out: SymbolNode[]): void {
  for (const m of body.namedChildren) {
    if (!m) continue
    if (m.type === "method_definition") {
      push(out, fieldText(m, "name"), "method", m, depth)
      const b = m.childForFieldName("body")
      if (b) collect(b, depth + 1, out)
    } else if (
      m.type === "public_field_definition" ||
      m.type === "field_definition"
    ) {
      const value = m.childForFieldName("value")
      const name = fieldText(m, "name")
      if (value && name && FN_VALUE.has(value.type)) {
        push(out, name, "method", m, depth)
        const b = value.childForFieldName("body")
        if (b) collect(b, depth + 1, out)
      }
    }
  }
}

// ── Python ────────────────────────────────────────────────────────────────────
// `inClass` turns a `function_definition` in a class body into a `method`; it is
// cleared when descending into a function body so nested defs read as functions.
function collectPython(
  node: Node,
  depth: number,
  out: SymbolNode[],
  inClass: boolean,
): void {
  for (const child of node.namedChildren) {
    if (child) handlePython(child, depth, out, inClass)
  }
}

function handlePython(
  node: Node,
  depth: number,
  out: SymbolNode[],
  inClass: boolean,
): void {
  switch (node.type) {
    case "function_definition": {
      push(out, fieldText(node, "name"), inClass ? "method" : "function", node, depth)
      const body = node.childForFieldName("body")
      if (body) collectPython(body, depth + 1, out, false)
      return
    }
    case "class_definition": {
      push(out, fieldText(node, "name"), "class", node, depth)
      const body = node.childForFieldName("body")
      if (body) collectPython(body, depth + 1, out, true)
      return
    }
    case "decorated_definition": {
      // Unwrap `@decorator` to its underlying function/class definition.
      const def = node.childForFieldName("definition")
      if (def) handlePython(def, depth, out, inClass)
      return
    }
    default:
      // Descend into blocks/statements to reach nested declarations.
      collectPython(node, depth, out, inClass)
      return
  }
}

// ── Go ────────────────────────────────────────────────────────────────────────
function collectGo(node: Node, depth: number, out: SymbolNode[]): void {
  for (const child of node.namedChildren) {
    if (!child) continue
    switch (child.type) {
      case "function_declaration":
        push(out, fieldText(child, "name"), "function", child, depth)
        break
      case "method_declaration":
        push(out, fieldText(child, "name"), "method", child, depth)
        break
      case "type_declaration": {
        for (const spec of child.namedChildren) {
          if (!spec) continue
          if (spec.type === "type_spec") {
            const t = spec.childForFieldName("type")?.type
            const kind: SymbolKind =
              t === "struct_type" ? "class" : t === "interface_type" ? "interface" : "type"
            push(out, fieldText(spec, "name"), kind, spec, depth)
          } else if (spec.type === "type_alias") {
            push(out, fieldText(spec, "name"), "type", spec, depth)
          }
        }
        break
      }
    }
  }
}

// ── Rust ──────────────────────────────────────────────────────────────────────
// `inImpl` turns a `function_item` inside an impl/trait body into a `method`.
function collectRust(
  node: Node,
  depth: number,
  out: SymbolNode[],
  inImpl: boolean,
): void {
  for (const child of node.namedChildren) {
    if (!child) continue
    switch (child.type) {
      case "function_item":
        push(out, fieldText(child, "name"), inImpl ? "method" : "function", child, depth)
        break
      case "function_signature_item":
        push(out, fieldText(child, "name"), "method", child, depth)
        break
      case "struct_item":
      case "union_item":
        push(out, fieldText(child, "name"), "class", child, depth)
        break
      case "enum_item":
        push(out, fieldText(child, "name"), "enum", child, depth)
        break
      case "type_item":
        push(out, fieldText(child, "name"), "type", child, depth)
        break
      case "trait_item": {
        push(out, fieldText(child, "name"), "interface", child, depth)
        const body = child.childForFieldName("body")
        if (body) collectRust(body, depth + 1, out, true)
        break
      }
      case "impl_item": {
        // No symbol for the impl itself; its function_items are methods.
        const body = child.childForFieldName("body")
        if (body) collectRust(body, depth + 1, out, true)
        break
      }
      case "mod_item": {
        const body = child.childForFieldName("body")
        if (body) collectRust(body, depth + 1, out, false)
        break
      }
    }
  }
}

// ── Java ──────────────────────────────────────────────────────────────────────
function collectJava(node: Node, depth: number, out: SymbolNode[]): void {
  for (const child of node.namedChildren) {
    if (!child) continue
    switch (child.type) {
      case "class_declaration":
      case "record_declaration": {
        push(out, fieldText(child, "name"), "class", child, depth)
        const body = child.childForFieldName("body")
        if (body) collectJava(body, depth + 1, out)
        break
      }
      case "interface_declaration": {
        push(out, fieldText(child, "name"), "interface", child, depth)
        const body = child.childForFieldName("body")
        if (body) collectJava(body, depth + 1, out)
        break
      }
      case "enum_declaration": {
        push(out, fieldText(child, "name"), "enum", child, depth)
        const body = child.childForFieldName("body")
        if (body) collectJava(body, depth + 1, out)
        break
      }
      case "method_declaration":
      case "constructor_declaration":
        push(out, fieldText(child, "name"), "method", child, depth)
        break
      default:
        // Descend into class_body/interface_body/enum_body to reach members.
        collectJava(child, depth, out)
        break
    }
  }
}

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Parse the compare-side content of `filePath` at `ref` and return a flat,
 * start-line-ordered list of declarations. Never throws — every failure path
 * (unsupported language, missing blob, tree-sitter not loaded, parse error)
 * returns `[]`.
 */
export async function getSymbols(
  repoPath: string,
  ref: string,
  filePath: string,
): Promise<SymbolNode[]> {
  try {
    const grammar = grammarForPath(filePath)
    if (!grammar) return []

    const content = await readCompareContent(repoPath, ref, filePath)
    if (!content || content.length > MAX_SOURCE_BYTES) return []

    if (!(await ensureInit())) return []
    const lang = await loadLanguage(grammar)
    if (!lang) return []

    const parser = new Parser()
    try {
      parser.setLanguage(lang)
      const tree = parser.parse(content)
      if (!tree) return []
      const out: SymbolNode[] = []
      try {
        const root = tree.rootNode
        switch (grammar) {
          case "python":
            collectPython(root, 0, out, false)
            break
          case "go":
            collectGo(root, 0, out)
            break
          case "rust":
            collectRust(root, 0, out, false)
            break
          case "java":
            collectJava(root, 0, out)
            break
          default:
            collect(root, 0, out)
        }
      } finally {
        tree.delete()
      }
      out.sort(
        (a, b) =>
          a.startLine - b.startLine || a.depth - b.depth || b.endLine - a.endLine,
      )
      return out
    } finally {
      parser.delete()
    }
  } catch {
    return []
  }
}

// ── Comment/string classification (blast-radius false-positive filter) ────────
/**
 * A position to classify, in `git grep`'s coordinate space: a 1-based `line`
 * (the `-n` number) and a 0-based `column` (UTF-16 index of the match within the
 * line). ASCII identifiers — the overwhelming majority — make column == byte
 * offset, so the tree-sitter point lines up exactly.
 */
export interface HitPos {
  line: number
  column: number
}

/** The syntactic bucket a position falls into. */
export type PositionClass = "code" | "comment" | "string"

/** How many ancestors to inspect above the smallest node at a position. */
const CLASSIFY_ANCESTOR_WALK = 4

/**
 * Map a tree-sitter node type to a bucket. Substring tests cover the grammar
 * variants — `line_comment`/`block_comment`/`comment`, and
 * `string`/`string_fragment`/`template_string` — while identifier-ish types
 * ("identifier", "type_identifier", "property_identifier") match neither.
 */
function nodeClass(type: string): PositionClass | null {
  if (type.includes("comment")) return "comment"
  if (type.includes("string")) return "string"
  return null
}

/**
 * Classify each (line, column) in `filePath`@`ref` as code / comment / string,
 * so the blast-radius search can drop `git grep` hits that fall inside comments
 * or string literals (textual false positives).
 *
 * DEFENSIVE in the safe direction: an unsupported language, missing blob,
 * tree-sitter failure, or ANY thrown error yields every position "code" — a
 * missed comment is far better than a dropped real reference, so we NEVER
 * over-filter. The whole tree lifecycle stays inside this module (the caller
 * never touches a `tree`); we reuse the shared parser cache + compare-side
 * content resolver, so this never re-inits tree-sitter or re-reads the blob
 * differently than `getSymbols`.
 */
export async function classifyPositions(
  repoPath: string,
  ref: string,
  filePath: string,
  positions: HitPos[],
): Promise<PositionClass[]> {
  // Default everyone to "code" — the answer we fall back to on every failure.
  const result: PositionClass[] = positions.map(() => "code")
  if (positions.length === 0) return result

  try {
    const grammar = grammarForPath(filePath)
    if (!grammar) return result

    const content = await readCompareContent(repoPath, ref, filePath)
    if (!content || content.length > MAX_SOURCE_BYTES) return result

    if (!(await ensureInit())) return result
    const lang = await loadLanguage(grammar)
    if (!lang) return result

    const parser = new Parser()
    try {
      parser.setLanguage(lang)
      const tree = parser.parse(content)
      if (!tree) return result
      try {
        const root = tree.rootNode
        for (let i = 0; i < positions.length; i++) {
          const { line, column } = positions[i]
          // descendantForPosition wants a 0-based {row, column} Point.
          let node: Node | null = root.descendantForPosition({
            row: line - 1,
            column,
          })
          // The smallest node is usually conclusive, but climb a few ancestors
          // in case the position resolved onto a bare delimiter token. A
          // `template_substitution` short-circuits to "code" so a real reference
          // inside `${ … }` is never mistaken for its enclosing template string.
          for (let up = 0; node && up <= CLASSIFY_ANCESTOR_WALK; up++) {
            if (node.type === "template_substitution") break
            const cls = nodeClass(node.type)
            if (cls) {
              result[i] = cls
              break
            }
            node = node.parent
          }
        }
      } finally {
        tree.delete()
      }
      return result
    } finally {
      parser.delete()
    }
  } catch {
    return result
  }
}
