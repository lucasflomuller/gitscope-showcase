# Validation — 2026-10-01

## Environment and results

Local Node.js 25.0.0, Bun 1.3.9, Next.js 16.2.9 and TypeScript 5.9.3.
Existing installed dependencies were reused; no dependency installation occurred.

| Check | Result | Evidence / scope |
| --- | --- | --- |
| `bun run build` | PASS | Production webpack build, TypeScript and route generation completed after runtime changes |
| `bun run typecheck` | PASS | Standalone `tsc --noEmit` |
| `bun run lint` | PASS | Zero errors/warnings after selection/focus fixes and a documented storage-hydration exception |
| `bun run test:demo` | PASS | Creates two independent fixture workspaces; checks refs, staged changes, author identity and no remotes; executes the synthetic metric tests |
| `bun run test:demo-http` | PASS | Production HTTP checks: synthetic data, diff, seeded guide, generic paths, unknown repos, read APIs and write/AI/MCP blocking |
| `bun run test:mcp` | PASS | Official SDK handshake, discovery, lifecycle, comparison/pinned links, diffs, guides/notes, invalid input and origin/protocol checks |
| Browser / screenshots | PASS, bounded review | Chrome desktop: dashboard, unified guide, split React diff, file navigation, staged comparison and redacted worktree picker; four screenshots saved |
| Clean install | NOT RUN | Existing dependency tree used; frozen-lockfile installation still needs verification |
| Vulnerability audit / performance benchmark | NOT RUN | No claim of audit or measured production performance |

The fixture test covers the synthetic data generator and two metric behaviors,
not the full React application. HTTP/MCP tests ran against the final production
build on loopback using temporary synthetic repositories and isolated state.
The normal user registry and real repositories were not used.

The desktop browser review checked the dashboard, seeded guide/note, React diff,
file navigation, unified/split modes, staged changes and reference picker. No
warning/error entries were reported by the tab console in the observed session.
The demo displays generic `/demo/...` paths, including worktree subtitles.
Screenshots in `docs/screenshots/` are actual browser captures, cropped to remove
unused space while retaining the application header and synthetic-demo banner.

No mobile/cross-browser suite, complete accessibility audit, live AI calls, GitHub
integration, performance benchmark or fresh dependency installation was run.
Some write controls remain visible in demo mode; the HTTP layer rejects them.
Demo mode is not intended to authorize public hosting.

## Redacted publication scan

The original local Git history was inspected across all locally reachable refs:
296 text objects scanned; 3 binary objects excluded. The scan included commit
metadata and blob content, credential-shaped patterns, credential URLs and personal
infrastructure indicators. It does not cover remote-only refs, unreachable objects,
binary payloads or all possible secret formats.

- Personal infrastructure appeared in the excluded deployment journal and the
  original `next.config.ts`; the clean snapshot removes/generalizes those values.
- The credential-shaped match in `src/lib/preflight.ts` is the canonical AWS
  documentation example used by the detector's placeholder filter. No live
  credential was confirmed by this scan; nothing was tested against a provider.
- A separate content check of the clean source found none of the selected personal
  host, home-directory, email or employer/client identifier patterns.
- No original `.git`, environment files, runtime review state or real repositories
  were copied. The demo repositories and reviews are synthetic and ignored.

This is a redacted heuristic review, not a certificate that source or history is
free of secrets, confidential data or third-party rights. Recheck the final source
snapshot and any future history before publishing.

## Distribution scope

The owner selected MIT and a new public GitHub showcase with fresh history.
The original repository remains separate. Dependency and generated-component
notices are preserved; see `LICENSE`, `THIRD_PARTY_NOTICES.md` and
`docs/LICENSE-REVIEW.md`. There is no hosted service or CI workflow included.
