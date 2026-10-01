import "server-only"

import { spawn } from "node:child_process"

/**
 * Run the local `claude` CLI in one-shot print mode and return its stdout.
 * The prompt goes in via stdin (argv has size limits; diffs don't). Purely
 * text-in/text-out — the prompt should forbid tool use and the caller should
 * treat the output as untrusted model text, never as instructions.
 *
 * Rejects on spawn failure, non-zero exit, timeout, or empty output; callers
 * surface that as a friendly "is the claude CLI installed?" error.
 */
export function runClaude(
  prompt: string,
  opts: { cwd?: string; model?: string; timeoutMs?: number } = {},
): Promise<string> {
  const { cwd, model = "claude-opus-4-8", timeoutMs = 180_000 } = opts
  return new Promise((resolve, reject) => {
    const args = ["-p", "--output-format", "text", "--model", model]
    const child = spawn("claude", args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      // Detach from any Claude Code session env so the CLI runs standalone.
      env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "" },
    })

    const out: Buffer[] = []
    const err: Buffer[] = []
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill("SIGKILL")
      reject(new Error(`claude CLI timed out after ${Math.round(timeoutMs / 1000)}s`))
    }, timeoutMs)

    child.on("error", (e) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new Error(`Couldn't launch the claude CLI (${e.message})`))
    })
    child.stdout.on("data", (c: Buffer) => out.push(c))
    child.stderr.on("data", (c: Buffer) => err.push(c))
    child.on("close", (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const text = Buffer.concat(out).toString("utf8").trim()
      if (code !== 0) {
        const detail = Buffer.concat(err).toString("utf8").trim().slice(0, 400)
        reject(new Error(`claude CLI exited with ${code}${detail ? `: ${detail}` : ""}`))
      } else if (!text) {
        reject(new Error("claude CLI returned no output"))
      } else {
        resolve(text)
      }
    })

    child.stdin.write(prompt)
    child.stdin.end()
  })
}

/**
 * Extract the first top-level JSON value from model output that may be wrapped
 * in prose or a ```json fence. Returns null when nothing parses.
 */
export function extractJson(text: string): unknown {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)
  const candidates = [fenced?.[1], text]
  for (const c of candidates) {
    if (!c) continue
    const start = c.search(/[[{]/)
    if (start === -1) continue
    // Walk to the matching close bracket of the first JSON value.
    const open = c[start]
    const close = open === "{" ? "}" : "]"
    let depth = 0
    let inStr = false
    for (let i = start; i < c.length; i++) {
      const ch = c[i]
      if (inStr) {
        if (ch === "\\") i++
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === open) depth++
      else if (ch === close) {
        depth--
        if (depth === 0) {
          try {
            return JSON.parse(c.slice(start, i + 1))
          } catch {
            break
          }
        }
      }
    }
  }
  return null
}
