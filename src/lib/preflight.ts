/**
 * GitScope pre-flight safety scan.
 *
 * A 100% local, static (regex + Shannon entropy, NO LLM, NO network) scan of the
 * ADDED lines of a unified diff. It flags likely secrets (blocker / red) and
 * "don't ship this" leftovers (warning / amber).
 *
 * This module is intentionally PURE: no node/git imports, no I/O, no network. It
 * is invoked server-side from the diff route, but is safe to unit-test in
 * isolation. Findings carry MASKED secret values — the raw secret never leaves
 * this module.
 */

import type {
  PreflightCategory,
  PreflightFinding,
  PreflightRuleId,
  PreflightSeverity,
  PreflightSummary,
} from "@/lib/types"

// ── Limits ────────────────────────────────────────────────────────────────
/** Hard cap on findings for pathological diffs (summary.capped when reached). */
export const MAX_FINDINGS = 500
/** Per-line scan length cap (chars) to bound CPU on minified / one-liner files. */
const MAX_LINE_SCAN = 2000
/** Max displayed snippet length; longer added lines are windowed around the hit. */
const MAX_SNIPPET = 200

// ── Inline suppression pragmas (case-insensitive substring on the added line) ─
const SUPPRESSION_PRAGMAS = [
  "gitscope-ignore",
  "gitleaks:allow",
  "pragma: allowlist secret",
  "nosec",
  "noqa",
]

function hasInlineSuppression(line: string): boolean {
  const lower = line.toLowerCase()
  return SUPPRESSION_PRAGMAS.some((p) => lower.includes(p))
}

// ── Placeholder / example denylist ───────────────────────────────────────────
const PLACEHOLDER_WORDS = [
  "example",
  "placeholder",
  "your-key",
  "your_key",
  "yourkey",
  "your-api",
  "your_api",
  "your-token",
  "your_token",
  "changeme",
  "change-me",
  "change_me",
  "redacted",
  "dummy",
  "sample",
  "insert",
  "replace",
  "todo",
  "fixme",
  "notreal",
  "fake",
  "xxxxxx",
  "******",
  "......",
]

/** True when a candidate value is an obvious placeholder / template / reference. */
function isPlaceholderValue(value: string): boolean {
  const v = value.trim()
  if (!v) return true
  const lower = v.toLowerCase()
  if (PLACEHOLDER_WORDS.some((w) => lower.includes(w))) return true
  // Env/template references rather than a literal secret.
  if (/process\.env|import\.meta\.env|os\.environ|getenv|\$\{|\$\(|<[^>]+>|%[a-z_]+%/i.test(v))
    return true
  // All one repeated char (e.g. "xxxxxxxxxx", "0000000000").
  if (/^(.)\1{5,}$/.test(v)) return true
  // The canonical AWS documentation key/secret.
  if (v.includes("AKIAIOSFODNN7EXAMPLE")) return true
  if (v.includes("wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY")) return true
  // A bare UUID is almost never a credential.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v))
    return true
  return false
}

// ── Path scoping (skip generic + entropy rules in noisy/generated files) ──────
function isScopedPath(path: string): boolean {
  const p = path.toLowerCase()
  const base = p.slice(p.lastIndexOf("/") + 1)
  if (base.endsWith(".lock")) return true
  if (
    base === "package-lock.json" ||
    base === "pnpm-lock.yaml" ||
    base === "yarn.lock" ||
    base === "bun.lock" ||
    base === "bun.lockb" ||
    base === "composer.lock" ||
    base === "gemfile.lock" ||
    base === "cargo.lock" ||
    base === "poetry.lock"
  )
    return true
  if (/\.min\.(js|css|mjs|cjs)$/.test(base)) return true
  if (base.endsWith(".snap")) return true
  if (base.endsWith(".map")) return true
  return false
}

/** True for ".env", ".env.local", … but NOT example/template variants. */
function isEnvFile(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1)
  if (!/^\.env(\.|$)/.test(base)) return false
  if (/\.(example|sample|template|dist|defaults)$/i.test(base)) return false
  return true
}

// ── Shannon entropy ───────────────────────────────────────────────────────────
function shannonEntropy(s: string): number {
  if (!s) return 0
  const freq = new Map<string, number>()
  for (const ch of s) freq.set(ch, (freq.get(ch) ?? 0) + 1)
  let entropy = 0
  const len = s.length
  for (const count of freq.values()) {
    const p = count / len
    entropy -= p * Math.log2(p)
  }
  return entropy
}

// ── Masking ───────────────────────────────────────────────────────────────────
/** Replace the middle of a secret with bullets, keeping a short prefix/suffix. */
function maskSecret(value: string): string {
  if (value.length <= 8) return "•".repeat(Math.max(4, value.length))
  const keepStart = 3
  const keepEnd = 2
  const middle = Math.min(8, value.length - keepStart - keepEnd)
  return value.slice(0, keepStart) + "•".repeat(middle) + value.slice(-keepEnd)
}

// ── Stable, dependency-free id hash (FNV-1a + djb2 → 16 hex chars) ────────────
function hashId(...parts: Array<string | number>): string {
  const s = parts.join("|")
  let fnv = 0x811c9dc5
  let djb2 = 5381
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    fnv ^= c
    fnv = Math.imul(fnv, 0x01000193)
    djb2 = (Math.imul(djb2, 33) + c) | 0
  }
  const a = (fnv >>> 0).toString(16).padStart(8, "0")
  const b = (djb2 >>> 0).toString(16).padStart(8, "0")
  return a + b
}

// ── Snippet windowing ─────────────────────────────────────────────────────────
/**
 * Build the display snippet from a raw added line and the matched range, with
 * `replacement` substituted for the match (masked secret, or the verbatim
 * keyword for leftovers). Long lines are windowed around the match.
 */
function buildSnippet(
  line: string,
  mStart: number,
  mEnd: number,
  replacement: string,
): { snippet: string; match: { start: number; end: number } } {
  const before = line.slice(0, mStart)
  const after = line.slice(mEnd)
  let composed = before + replacement + after
  let start = mStart
  let end = mStart + replacement.length

  if (composed.length > MAX_SNIPPET) {
    const span = end - start
    const pad = Math.max(8, Math.floor((MAX_SNIPPET - span) / 2))
    const from = Math.max(0, start - pad)
    const to = Math.min(composed.length, end + pad)
    const prefix = from > 0 ? "…" : ""
    const suffix = to < composed.length ? "…" : ""
    composed = prefix + composed.slice(from, to) + suffix
    start = prefix.length + (start - from)
    end = prefix.length + (end - from)
  }

  return { snippet: composed, match: { start, end } }
}

// ── Rule table ──────────────────────────────────────────────────────────────
type RuleDef = {
  id: PreflightRuleId
  category: PreflightCategory
  severity: PreflightSeverity
  title: string
  detail: string
  /** Global regex; the value to mask/highlight is `valueGroup` (default 0). */
  re: RegExp
  valueGroup?: number
  /** True for generic/low-signal rules suppressed in scoped (lockfile/min) paths. */
  generic?: boolean
  /** Secret rules mask their matched value; leftovers are shown verbatim. */
  mask: boolean
}

// Secret rules run first (and "claim" their matched ranges); leftovers are
// independent. Generic / entropy rules are handled specially below.
const SECRET_RULES: RuleDef[] = [
  {
    id: "private-key",
    category: "secret",
    severity: "blocker",
    title: "Private key",
    detail: "A PEM private-key header was added — never commit private keys.",
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY-----/g,
    mask: false,
  },
  {
    id: "aws-access-key-id",
    category: "secret",
    severity: "blocker",
    title: "AWS access key id",
    detail: "Looks like an AWS access key id (AKIA/ASIA…).",
    re: /\b((?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA)[A-Z0-9]{16})\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "aws-secret-access-key",
    category: "secret",
    severity: "blocker",
    title: "AWS secret access key",
    detail: "A 40-char value assigned to an AWS-secret-looking key.",
    re: /\b(?:aws_)?secret_?access_?key\b["']?\s*[:=]\s*["']?([A-Za-z0-9/+]{40})\b/gi,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "github-token",
    category: "secret",
    severity: "blocker",
    title: "GitHub token",
    detail: "A GitHub personal-access / app token.",
    re: /\b((?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "slack-token",
    category: "secret",
    severity: "blocker",
    title: "Slack token",
    detail: "A Slack API token (xox…).",
    re: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "slack-webhook",
    category: "secret",
    severity: "blocker",
    title: "Slack webhook URL",
    detail: "An incoming Slack webhook URL (carries posting rights).",
    re: /https:\/\/hooks\.slack\.com\/services\/[A-Za-z0-9/]+/g,
    mask: true,
  },
  {
    id: "google-api-key",
    category: "secret",
    severity: "blocker",
    title: "Google API key",
    detail: "A Google API key (AIza…).",
    re: /\b(AIza[0-9A-Za-z_-]{35})\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "google-oauth-client-id",
    category: "secret",
    severity: "blocker",
    title: "Google OAuth client id",
    detail: "A Google OAuth client id was added.",
    re: /\b([0-9]+-[0-9a-z]{32}\.apps\.googleusercontent\.com)\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "stripe-secret-key",
    category: "secret",
    severity: "blocker",
    title: "Stripe live secret key",
    detail: "A live Stripe secret key (sk_live / rk_live).",
    re: /\b((?:sk|rk)_live_[A-Za-z0-9]{16,})\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "stripe-test-key",
    category: "secret",
    severity: "warning",
    title: "Stripe test secret key",
    detail: "A Stripe test key — lower risk, but still shouldn't be committed.",
    re: /\b((?:sk|rk)_test_[A-Za-z0-9]{16,})\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "anthropic-api-key",
    category: "secret",
    severity: "blocker",
    title: "Anthropic API key",
    detail: "An Anthropic API key (sk-ant-…).",
    re: /\b(sk-ant-[A-Za-z0-9_-]{20,})\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "openai-api-key",
    category: "secret",
    severity: "blocker",
    title: "OpenAI API key",
    detail: "An OpenAI API key (sk-…).",
    re: /\b(sk-(?!ant-)(?:proj-)?[A-Za-z0-9_-]{20,})\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "sendgrid-api-key",
    category: "secret",
    severity: "blocker",
    title: "SendGrid API key",
    detail: "A SendGrid API key (SG.…).",
    re: /\b(SG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,})\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "twilio-account-sid",
    category: "secret",
    severity: "blocker",
    title: "Twilio account SID",
    detail: "A Twilio account SID (AC…).",
    re: /\b(AC[a-f0-9]{32})\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "npm-token",
    category: "secret",
    severity: "blocker",
    title: "npm access token",
    detail: "An npm access token (npm_…).",
    re: /\b(npm_[A-Za-z0-9]{36})\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "gitlab-pat",
    category: "secret",
    severity: "blocker",
    title: "GitLab personal access token",
    detail: "A GitLab personal access token (glpat-…).",
    re: /\b(glpat-[A-Za-z0-9_-]{20,})\b/g,
    valueGroup: 1,
    mask: true,
  },
  {
    id: "jwt",
    category: "secret",
    severity: "blocker",
    title: "JSON Web Token",
    detail: "A JWT (eyJ…) — may carry credentials or PII.",
    re: /\b(eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,})\b/g,
    valueGroup: 1,
    mask: true,
  },
]

// Generic "secret-named assignment to a quoted value" — lower signal, scoped.
const GENERIC_SECRET_RE =
  /\b(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|access[_-]?key|auth[_-]?token|client[_-]?secret|private[_-]?key)\b["']?\s*[:=]\s*["']([^"']{8,120})["']/gi

// .env assignment: KEY=value (optionally `export KEY=`), value unquoted or quoted.
const ENV_ASSIGN_RE = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.+?)\s*$/

// Quoted string literals (used as entropy candidates).
const QUOTED_LITERAL_RE = /["'`]([^"'`\n]{20,})["'`]/g

// ── Leftover rules (independent of secret rules) ──────────────────────────────
const LEFTOVER_RULES: RuleDef[] = [
  {
    id: "merge-conflict",
    category: "leftover",
    severity: "warning",
    title: "Merge-conflict marker",
    detail: "An unresolved merge-conflict marker is in the diff.",
    re: /^(?:<{7}|>{7}|={7})(?=\s|$)/g,
    mask: false,
  },
  {
    id: "console-log",
    category: "leftover",
    severity: "warning",
    title: "console.log left in",
    detail: "A console.log/debug/trace call was added.",
    re: /\bconsole\.(?:log|debug|trace)\s*\(/g,
    mask: false,
  },
  {
    id: "debugger",
    category: "leftover",
    severity: "warning",
    title: "debugger statement",
    detail: "A `debugger` statement was added.",
    re: /\bdebugger\b\s*;?/g,
    mask: false,
  },
  {
    id: "python-debugger",
    category: "leftover",
    severity: "warning",
    title: "Debugger breakpoint",
    detail: "A pdb/breakpoint/binding.pry debug hook was added.",
    re: /\b(?:breakpoint\s*\(|import\s+i?pdb|i?pdb\.set_trace\s*\(|binding\.pry)/g,
    mask: false,
  },
  {
    id: "debug-print",
    category: "leftover",
    severity: "warning",
    title: "print() left in",
    detail: "A print() call was added — may be debug output.",
    re: /(?:^|\s)print\s*\(/g,
    mask: false,
  },
  {
    id: "test-focus",
    category: "leftover",
    severity: "warning",
    title: "Focused test",
    detail: "A focused test (.only / fdescribe / fit) will skip the rest of the suite.",
    re: /\b(?:describe|it|test|context)\.only\b|\bf(?:describe|it)\s*\(/g,
    mask: false,
  },
  {
    id: "test-skip",
    category: "leftover",
    severity: "warning",
    title: "Skipped test",
    detail: "A skipped/disabled test (.skip / xit / test.todo).",
    re: /\b(?:describe|it|test)\.(?:skip|todo)\b|\bx(?:describe|it)\s*\(/g,
    mask: false,
  },
  {
    id: "todo-comment",
    category: "leftover",
    severity: "warning",
    title: "TODO / FIXME",
    detail: "A TODO/FIXME/HACK/XXX/WIP marker was added.",
    re: /\b(?:TODO|FIXME|HACK|XXX|WIP)\b/g,
    mask: false,
  },
]

// ── Per-line scanning ─────────────────────────────────────────────────────────
type scanState = { inPemBlock: boolean }

function overlaps(ranges: Array<[number, number]>, s: number, e: number): boolean {
  return ranges.some(([rs, re]) => s < re && e > rs)
}

function makeFinding(
  rule: Pick<RuleDef, "id" | "category" | "severity" | "title" | "detail">,
  path: string,
  line: number,
  rawLine: string,
  mStart: number,
  mEnd: number,
  replacement: string,
): PreflightFinding {
  const { snippet, match } = buildSnippet(rawLine, mStart, mEnd, replacement)
  return {
    id: hashId(rule.id, path, line, snippet),
    ruleId: rule.id,
    category: rule.category,
    severity: rule.severity,
    title: rule.title,
    detail: rule.detail,
    path,
    line,
    snippet,
    match,
  }
}

/** Scan a single added line, appending any findings to `out`. */
function scanLine(
  rawLine: string,
  path: string,
  line: number,
  state: scanState,
  out: PreflightFinding[],
): void {
  // Inline suppression escape hatch wins over everything.
  if (hasInlineSuppression(rawLine)) return

  const scoped = isScopedPath(path)
  const scan = rawLine.length > MAX_LINE_SCAN ? rawLine.slice(0, MAX_LINE_SCAN) : rawLine
  const claimed: Array<[number, number]> = []

  // Inside a PEM block we already flagged the BEGIN line; suppress noise on the
  // base64 body until END so a key isn't reported line-by-line.
  const insidePem = state.inPemBlock

  // ── Specific secret rules ──
  if (!insidePem) {
    for (const rule of SECRET_RULES) {
      rule.re.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = rule.re.exec(scan)) !== null) {
        if (out.length >= MAX_FINDINGS) return
        const value = rule.valueGroup ? m[rule.valueGroup] ?? m[0] : m[0]
        if (rule.mask && isPlaceholderValue(value)) continue
        const vStart = rule.valueGroup ? scan.indexOf(value, m.index) : m.index
        const vEnd = vStart + value.length
        claimed.push([vStart, vEnd])
        out.push(
          makeFinding(
            rule,
            path,
            line,
            rawLine,
            vStart,
            vEnd,
            rule.mask ? maskSecret(value) : value,
          ),
        )
        if (m.index === rule.re.lastIndex) rule.re.lastIndex++
      }
    }
  }

  // PEM block state transitions (after flagging the BEGIN line above).
  if (/-----BEGIN .*PRIVATE KEY-----/.test(scan)) state.inPemBlock = true
  if (/-----END .*PRIVATE KEY-----/.test(scan)) state.inPemBlock = false

  // ── Generic + entropy rules (skipped in scoped paths and PEM bodies) ──
  if (!scoped && !insidePem) {
    // Generic secret-named assignment.
    GENERIC_SECRET_RE.lastIndex = 0
    let gm: RegExpExecArray | null
    while ((gm = GENERIC_SECRET_RE.exec(scan)) !== null) {
      if (out.length >= MAX_FINDINGS) return
      const value = gm[1]
      const vStart = scan.indexOf(value, gm.index)
      const vEnd = vStart + value.length
      if (!isPlaceholderValue(value) && !overlaps(claimed, vStart, vEnd)) {
        claimed.push([vStart, vEnd])
        out.push(
          makeFinding(
            {
              id: "generic-secret",
              category: "secret",
              severity: "blocker",
              title: "Hard-coded secret",
              detail: "A secret-looking name is assigned a literal value.",
            },
            path,
            line,
            rawLine,
            vStart,
            vEnd,
            maskSecret(value),
          ),
        )
      }
      if (gm.index === GENERIC_SECRET_RE.lastIndex) GENERIC_SECRET_RE.lastIndex++
    }

    // High-entropy quoted string literals.
    QUOTED_LITERAL_RE.lastIndex = 0
    let qm: RegExpExecArray | null
    while ((qm = QUOTED_LITERAL_RE.exec(scan)) !== null) {
      if (out.length >= MAX_FINDINGS) return
      const token = qm[1]
      if (/\s/.test(token)) continue // multi-word strings aren't keys
      const vStart = scan.indexOf(token, qm.index)
      const vEnd = vStart + token.length
      if (overlaps(claimed, vStart, vEnd)) continue
      if (isPlaceholderValue(token)) continue

      const isHex = /^[0-9a-fA-F]{32,}$/.test(token)
      const isB64 = /^[A-Za-z0-9+/_=-]{20,}$/.test(token)
      // 40/64-char pure hex is overwhelmingly a git SHA / digest, not a secret.
      if (isHex && (token.length === 40 || token.length === 64)) continue

      const entropy = shannonEntropy(token)
      // Real base64/secret tokens mix upper, lower AND digits; requiring all
      // three excludes all-lowercase Tailwind classes / kebab-case identifiers.
      const richB64 =
        /[a-z]/.test(token) && /[A-Z]/.test(token) && /[0-9]/.test(token)
      let hit: { id: PreflightRuleId; title: string } | null = null
      if (isHex && entropy >= 3.0) hit = { id: "high-entropy-hex", title: "High-entropy hex string" }
      else if (isB64 && entropy >= 4.0 && richB64)
        hit = { id: "high-entropy-base64", title: "High-entropy string" }

      if (hit) {
        claimed.push([vStart, vEnd])
        out.push(
          makeFinding(
            {
              id: hit.id,
              category: "secret",
              severity: "blocker",
              title: hit.title,
              detail: "A long, random-looking literal that may be a credential.",
            },
            path,
            line,
            rawLine,
            vStart,
            vEnd,
            maskSecret(token),
          ),
        )
      }
    }

    // .env files: treat a non-placeholder assigned value as a secret.
    if (isEnvFile(path)) {
      const em = ENV_ASSIGN_RE.exec(scan)
      if (em && out.length < MAX_FINDINGS) {
        const value = em[2]
        // Strip surrounding quotes for the placeholder check / masking.
        const unquoted = value.replace(/^["']|["']$/g, "")
        const vStart = scan.indexOf(value, em.index)
        const vEnd = vStart + value.length
        if (
          unquoted.length > 0 &&
          !isPlaceholderValue(unquoted) &&
          !overlaps(claimed, vStart, vEnd)
        ) {
          claimed.push([vStart, vEnd])
          out.push(
            makeFinding(
              {
                id: "env-secret",
                category: "secret",
                severity: "blocker",
                title: "Secret in committed .env",
                detail: "A value in a committed .env file — keep these out of git.",
              },
              path,
              line,
              rawLine,
              vStart,
              vEnd,
              maskSecret(unquoted),
            ),
          )
        }
      }
    }
  }

  // ── Leftover rules (always run; independent of secret/entropy claims) ──
  for (const rule of LEFTOVER_RULES) {
    rule.re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = rule.re.exec(scan)) !== null) {
      if (out.length >= MAX_FINDINGS) return
      const mStart = m.index
      const mEnd = m.index + m[0].length
      out.push(makeFinding(rule, path, line, rawLine, mStart, mEnd, m[0]))
      if (m.index === rule.re.lastIndex) rule.re.lastIndex++
    }
  }
}

// ── Unified-diff walker ───────────────────────────────────────────────────────
function stripPathPrefix(p: string): string {
  if (p.startsWith("a/") || p.startsWith("b/")) return p.slice(2)
  return p
}

/**
 * Walk a unified diff, scanning ONLY added content lines (`+`, excluding the
 * `+++` header), tracking the current new-side path + line number.
 *
 * (Truncation is a property of the diff, not the scan, so it's applied in
 * `summarizeFindings` rather than taking an unused options arg here.)
 */
export function scanDiff(patch: string): PreflightFinding[] {
  const out: PreflightFinding[] = []
  if (!patch) return out

  let path = ""
  let newLine = 0
  const state: scanState = { inPemBlock: false }

  const lines = patch.split("\n")
  for (const line of lines) {
    if (out.length >= MAX_FINDINGS) break

    // New-file header: capture the to-path. (a/, b/ prefixes are stripped.)
    if (line.startsWith("+++ ")) {
      const raw = line.slice(4).trim()
      // git appends nothing after the path normally; guard a trailing tab anyway.
      const cut = raw.split("\t")[0]
      path = cut === "/dev/null" ? "" : stripPathPrefix(cut)
      state.inPemBlock = false
      continue
    }
    if (line.startsWith("--- ")) continue

    // Hunk header: reset the new-side line counter to the post-image start.
    if (line.startsWith("@@")) {
      const m = /\+(\d+)/.exec(line.slice(2))
      newLine = m ? parseInt(m[1], 10) : newLine
      continue
    }

    // Skip extended-header / metadata lines outside hunks.
    if (
      line.startsWith("diff --git") ||
      line.startsWith("index ") ||
      line.startsWith("old mode") ||
      line.startsWith("new mode") ||
      line.startsWith("deleted file") ||
      line.startsWith("new file") ||
      line.startsWith("similarity index") ||
      line.startsWith("rename ") ||
      line.startsWith("copy ") ||
      line.startsWith("Binary files") ||
      line.startsWith("GIT binary patch")
    ) {
      continue
    }

    const marker = line[0]
    if (marker === "+") {
      // Added content line (we already excluded "+++ " above).
      if (path) scanLine(line.slice(1), path, newLine, state, out)
      newLine++
    } else if (marker === " ") {
      newLine++
    }
    // "-" (deletion) and "\" (no-newline) lines don't advance the new-side count.
  }

  return out
}

/** Build the roll-up summary for a set of findings. */
export function summarizeFindings(
  findings: PreflightFinding[],
  opts?: { truncated?: boolean },
): PreflightSummary {
  let secrets = 0
  let leftovers = 0
  for (const f of findings) {
    if (f.category === "secret") secrets++
    else leftovers++
  }
  return {
    secrets,
    leftovers,
    total: findings.length,
    truncated: Boolean(opts?.truncated),
    capped: findings.length >= MAX_FINDINGS,
  }
}
