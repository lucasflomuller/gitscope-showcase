# Agent access and installation

GitScope exposes a stateless Streamable HTTP MCP server at `/api/mcp`.
It supports MCP 2025-11-25, 2025-06-18 and 2025-03-26, with JSON responses.

## Agent workflow

1. `list_repos` finds registered projects; `add_repo({path, name?})` registers an
   existing local checkout (including linked worktrees), without cloning it.
2. `list_refs({repoId})` discovers branches, tags, remote-tracking refs, worktrees
   and recent commits. Refs are local; no fetch or checkout occurs.
3. `create_comparison_link({repoId, base: "main", compare: "feature/foo"})` returns
   a validated URL using `GITSCOPE_PUBLIC_URL`. Return that URL to the user.
   `mode: "merge-base"` (default) shows PR-style changes; `"direct"` compares trees.
   Optional `file` focuses a changed file. `pin: true` uses immutable commit SHAs;
   otherwise links follow branches as they move. Commits must remain available.
   `WORKING` and `STAGED` are supported on the compare side and cannot be pinned.
4. `get_diff`, `list_commits`, `get_comments`, `add_comment`, `set_comment_state`,
   `get_review_guide` and `submit_review_guide` support review and handoff.
   Pass `compare` to `get_comments` to read the intended branch's notes.
5. `remove_repo({repoId})` unregisters only; repository files and reviews survive.

Tools expose read/write annotations and validate arguments. Invalid refs and
unrelated histories in merge-base mode return errors rather than misleading URLs.
The registry serializes mutations in a single server process and uses atomic writes.
Run only one server per state directory; independent servers are not coordinated.

## Service and Tailscale

Build with `bun install --frozen-lockfile && bun run build`. Adapt
`deployment/gitscope.service.example` into `~/.config/systemd/user/gitscope.service`,
then `systemctl --user daemon-reload && systemctl --user enable --now gitscope`.
Use absolute executable paths and a PATH containing git (plus gh/claude for optional
UI features). For staged upgrades, build with `GITSCOPE_DIST_DIR=.next-release-N`
and set the same variable in the service. Keep the previous build for rollback.

Configure `GITSCOPE_PUBLIC_URL` as a full origin, for example
`https://your-machine.your-tailnet.ts.net:8447`, then add a dedicated private route:

```sh
tailscale serve --bg --https=8447 http://127.0.0.1:3000
```

Check existing Serve routes before choosing a port. Do not reset other routes.
The service binds loopback; Tailscale Serve provides TLS and tailnet access control.
All allowed peers can read registered source and use the app's write APIs. Restrict
access using tailnet policy. There is no per-user in-app auth: do not use Funnel or
expose the service to an untrusted network. MCP rejects foreign browser Origins.
The public URL is configuration, not a per-call host supplied by an agent.
`GITSCOPE_CONFIG_DIR` overrides the default `~/.config/gitscope` (useful for tests).

## Register agents

On the same host:

```sh
codex mcp add gitscope --url http://127.0.0.1:3000/api/mcp
claude mcp add --scope user --transport http gitscope http://127.0.0.1:3000/api/mcp
```

On another tailnet device, use the HTTPS Tailscale origin plus `/api/mcp`.
Restart/reconnect the agent session to discover new tools. A Linux `.desktop`
launcher makes GitScope visible in the system app menu. MCP registration exposes
its tools to local agents; it does not publish an app into ChatGPT's hosted catalog.
Cloud-hosted clients need connectivity to the private endpoint separately.

## Verification

`bun run test:mcp` starts the production build with isolated state and a temporary
Git repository. It checks an official SDK client handshake, discovery, project
lifecycle, comparison links and pins, diffs, review tools, malformed requests,
invalid arguments, origin restrictions and unrelated histories. It never edits
registered user projects. Set `GITSCOPE_DIST_DIR` to test a staged build.
