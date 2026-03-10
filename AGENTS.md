# Mercury — Agent Instructions

Personal AI assistant for chat platforms. Runs agents in Docker containers using [pi](https://github.com/badlogic/pi) as the runtime.

## Philosophy

- Mercury is a **host**, not a framework — adapters, extensions, and agents are pluggable
- Every message runs inside a short-lived Docker container; the host survives crashes
- Spaces are the primary isolation boundary — conversations link to spaces, spaces own memory
- Extensions are the escape hatch — anything Mercury doesn't do natively, an extension can add
- Configuration lives in env vars (`.env`), never in code

## Commands

```bash
bun run check        # Typecheck + lint + test (run before PR)
bun run check:fix    # Same but auto-fix lint issues
bun run format       # Format with Biome
bun test             # Tests only
bun run typecheck    # TypeScript only
bun run lint         # Biome only
```

## ⚠️ Safety Rules

- **Never kill processes by port** (e.g. `lsof -ti:8787 | xargs kill`). This can kill the agent process itself if it has an open connection to that port. Use `mercury service uninstall` to stop Mercury cleanly.
- **Never run `mercury run` directly** — always use `mercury service install`. Direct runs block the terminal and don't auto-restart.

## Running a Mercury Project

To start a mercury project (e.g. after changing extensions or `.env`):

```bash
cd /path/to/mercury-project
mercury service install   # Installs and starts as a system service
```

That's it. The derived Docker image (with extension CLIs) is built automatically on startup if needed, and cached by content hash. You do **not** need to run `mercury build` — that command is only for developing the base mercury-agent image from source.

## Running in Background

The preferred way to run Mercury in the background is via system service (not tmux):

```bash
mercury service install   # Install as launchd (macOS) or systemd (Linux)
mercury service status    # Check if running
mercury service logs -f   # Tail logs
mercury service uninstall # Remove service
```

See [deployment.md](docs/deployment.md) for details.

## Architecture

Mercury connects chat platforms (WhatsApp, Slack, Discord, Teams) to AI agents running in Docker containers.

**Adapters** (`src/adapters/`) receive platform messages and normalize them via **bridges** (`src/bridges/`).
**Core** (`src/core/`) routes messages, manages spaces and conversations, enforces RBAC, and schedules tasks.
**Agent runner** (`src/agent/`) spawns Docker containers, passes context, collects replies.
**Extensions** (`src/extensions/`) add CLIs, hooks, background jobs, skills, and config keys at runtime.
**Storage** (`src/storage/`) manages SQLite (spaces, conversations, messages, tasks, roles, config) and workspace directories.

## Key Files

| File | What it does |
|------|--------------|
| `src/main.ts` | Entry point — initializes runtime, adapters, server |
| `src/core/runtime.ts` | Orchestrates message → container → reply flow |
| `src/storage/db.ts` | All SQLite: spaces, conversations, messages, tasks, roles, config |
| `src/config.ts` | Environment parsing with Zod |
| `src/agent/container-runner.ts` | Docker spawn, timeout, cleanup |
| `src/extensions/loader.ts` | Extension discovery, loading, registry |
| `src/core/handler.ts` | Unified message handler — platform-agnostic |
| `src/core/permissions.ts` | RBAC — role checks, dynamic extension permissions |

## Gotchas

- **All `MERCURY_*` env vars** are passed into containers with the prefix stripped — `MERCURY_FOO` becomes `FOO`. Extensions use `mercury.env()` to declare which vars they need.
- **Spaces vs conversations**: Conversations are discovered automatically from traffic; spaces are created explicitly. A conversation must be _linked_ to a space before the agent can use its memory.
- **Extension names are reserved** against built-in commands (`tasks`, `roles`, `config`, etc.) — see `src/extensions/reserved.ts`.
- **Docker image caching**: When extensions declare CLIs, Mercury builds a derived image. The cache key is a content hash — changing extension code busts it automatically.
- **Outbox is mtime-based**: `src/core/outbox.ts` detects new files by modification time, not inotify. Tests that write files too fast can race.

## Docs

| Doc | Topic |
|-----|-------|
| [auth/overview.md](docs/auth/overview.md) | Authentication (OAuth + API keys + platforms) |
| [pipeline.md](docs/pipeline.md) | Message pipeline (ingress/egress) |
| [memory.md](docs/memory.md) | Obsidian vault system |
| [scheduler.md](docs/scheduler.md) | Task scheduling (cron + at) |
| [permissions.md](docs/permissions.md) | RBAC system |
| [container-lifecycle.md](docs/container-lifecycle.md) | Docker management |
| [extensions.md](docs/extensions.md) | Extension system design |
| [deployment.md](docs/deployment.md) | Service install + deployment |

## Conventions

- **Commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- **Branches**: `issue-<num>-<slug>` for GitHub issues
- **Tests**: Co-located in `tests/`, use temp DBs
- **Config**: All via env vars, parsed in `config.ts`
- **Errors**: Use typed errors from `container-error.ts`
