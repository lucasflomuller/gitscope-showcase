# Showcase provenance

Prepared on 2026-10-01 from the owner's local GitScope snapshot at
`07de580f966cc19c7036e67d83db42e5f1ef2841`.

The original checkout was clean when inspected. This is an independent copy of
tracked files, not a linked worktree. No original commit history, remote, reflog,
runtime registry, review records, environment files or build outputs were copied.
The original checkout and history were not modified.

## Original project and new preparation

The source snapshot contains the React review UI, Git backend, MCP server, review
notes/guides, code intelligence and local workflow integration. Local Git authorship
supports attribution to Lucas; tool-generated author identities also occur. Authorship metadata alone
does not establish legal ownership or third-party rights. The owner selected MIT
for the original application; copied UI primitives retain their notices.

This preparation adds synthetic fixtures, a demo launcher, read-only API guards,
configuration examples, portable settings, documentation, dependency-license
inventory and demo tests. It removes remote font fetching, allows browser zoom,
and addresses lint findings in selection/focus synchronization. Intentional
post-SSR localStorage hydration has a narrowly documented lint exception;
persistence behavior was retained.

## Exclusions and generalizations

- Excluded the machine-specific deployment journal under `docs/`.
- Replaced hard-coded machine addresses/private-network allowlists with the
  optional `GITSCOPE_DEV_ORIGINS` setting. Demo API responses also generalize
  repository/worktree paths to `/demo/...`.
- Removed dated build-output paths from TypeScript configuration.
- Included no customer repositories, employer code, real metrics, personal review
  records, credentials or deployment configurations.
- Created all demo names, authors, records, history, notes and guide for this task.

Existing dependencies were reused through an ignored local `node_modules` symlink
for validation. This link and all `.demo`/`.next` outputs are local-only; exclude
them from any archive or publication. Recipients install from `bun.lock`.

## Publication boundary

This standalone MIT showcase starts a new Git history. The original repository
and its history remain separate. Original history was inspected locally with
redacted findings and is not included. See validation and license-review documents
for scope and limitations. Source publication does not authorize public hosting
of this filesystem-reading application.
