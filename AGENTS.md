# BearClaw — Agent Instructions

Personal AI assistant for chat platforms (WhatsApp, Slack, Discord). Runs agents inside Docker containers using pi as the runtime.

## Quick Commands

```bash
bun test                 # Run tests
bun run check            # Typecheck + lint + test
bun run check:fix        # Typecheck + lint:fix + test
bun run typecheck        # TypeScript only
bun run lint             # Biome lint only
bun run lint:fix         # Biome lint + fix
```

## Project Structure

```
src/
├── adapters/            # WhatsApp, Slack, Discord adapters
├── agent/
│   ├── container-entry.ts   # Runs inside container
│   ├── container-runner.ts  # Spawns/manages containers
│   └── container-error.ts   # Error types (timeout, oom, etc.)
├── core/
│   ├── runtime.ts       # Main orchestrator
│   ├── router.ts        # Message routing + trigger matching
│   ├── group-queue.ts   # Per-group concurrency control
│   ├── task-scheduler.ts    # Cron task execution
│   ├── permissions.ts   # RBAC system
│   ├── trigger.ts       # Trigger pattern matching
│   └── api.ts           # Internal API handlers
├── storage/
│   ├── db.ts            # SQLite (groups, messages, tasks, roles)
│   └── memory.ts        # Workspace/file management
├── cli/
│   ├── bearclaw.ts      # Main CLI (init, run, build, status)
│   └── bearclaw-ctl.ts  # In-container management CLI
├── chat-sdk.ts          # Entry point, HTTP server, adapters
├── config.ts            # Zod config schema + env parsing
├── logger.ts            # Logging
└── types.ts             # Shared types

tests/                   # Bun test files
docs/                    # Documentation
container/               # Dockerfile + build script
```

## Key Endpoints

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /health` | No | Health check (uptime, queue, containers, adapters) |
| `POST /webhooks/slack` | Slack signature | Slack events |
| `POST /webhooks/discord` | Discord signature | Discord interactions |
| `/api/*` | `X-BearClaw-Caller` + `X-BearClaw-Group` headers | Internal API for bearclaw-ctl |

## Configuration

All config via environment variables. See `src/config.ts` for the full schema.

Key ones:
- `BEARCLAW_CONTAINER_TIMEOUT_MS` — Container timeout (default 5 min)
- `BEARCLAW_MAX_CONCURRENCY` — Max concurrent containers (default 2)
- `BEARCLAW_CHATSDK_PORT` — HTTP server port (default 8787)

## Container Lifecycle

Containers are labeled `bearclaw.managed=true` for tracking. On startup, orphaned containers from previous runs are cleaned up. See `docs/container-lifecycle.md`.

## Testing

```bash
bun test                     # All tests
bun test tests/db.test.ts    # Single file
```

Tests use temp SQLite databases and clean up after themselves.

## Docs

- `docs/ingress.md` — Adapter message flow
- `docs/graceful-shutdown.md` — Shutdown sequence
- `docs/container-lifecycle.md` — Container management, timeouts, cleanup
