---
name: gitscope
description: Use GitScope to share a visual comparison between Git branches or refs, register local projects, or exchange review notes and guides through its MCP. Use when the user asks for a GitScope or Tailscale diff link or a GitScope review handoff.
---

# GitScope

Use the configured `gitscope` MCP. Discover its current tools and follow their
server-provided descriptions and input schemas; those own the API details.

- Find the intended project and refs through the MCP. Register an existing local
  checkout when needed for the requested comparison; do not guess repository IDs.
- For a diff link, use `create_comparison_link` with the requested base and compare.
  Use PR-style merge-base by default, direct mode for a tree-to-tree comparison,
  and pin only when a fixed commit snapshot is wanted.
- Return the exact tool-generated URL as a clickable link, labeled with the
  project and `base → compare`. Mention Tailscale access when the result requires it.
- Use the MCP's diff, review-note and guide tools when the user requests review
  work. A request for a link alone does not call for a review guide or code edits.
- If the MCP is unavailable, report that the agent needs its configured GitScope
  connection enabled/reconnected. Do not invent a URL or change network exposure.
