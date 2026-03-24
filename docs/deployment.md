# Deployment

Mercury runs as a Docker container. The CLI manages the container lifecycle.

## Quick Start

```bash
mercury init          # Create project (.env, workspace, first API key)
mercury build         # Build Docker image with extensions
mercury start         # Start container
mercury logs -f       # View logs
mercury stop          # Stop container
```

## Container Management

```bash
mercury start         # Start (or replace existing) container
mercury stop          # Stop and remove container
mercury restart       # Rebuild image + restart container
mercury logs          # View logs
mercury logs -f       # Follow logs
mercury status        # Check if running
```

The container runs with:
- `--restart unless-stopped` — auto-restarts on crash
- `--cap-add SYS_ADMIN --security-opt seccomp=unconfined` — required for bubblewrap sandbox
- `-v ./:/data` — persistent data (DB, workspace, auth, sessions)
- `--env-file .env` — configuration

## Image

`mercury build` creates a Docker image from the base Dockerfile, then injects extension CLI install commands. The base image includes:

- Bun, Node.js, Python, Go
- `pi` CLI (AI agent runtime)
- `mrctl` (Mercury control CLI)
- Chromium (for browser automation extensions)
- bubblewrap (agent sandbox)

Extensions that declare CLIs (e.g., `npm install -g napkin-ai`) are installed into the image at build time.

## Configuration

All configuration is via `.env`:

```bash
# Required
MERCURY_BOT_USERNAME=mercury
MERCURY_MODEL_PROVIDER=anthropic
MERCURY_MODEL=claude-sonnet-4-20250514

# Server
MERCURY_PORT=3000

# Adapters (all optional — CLI-only mode if none enabled)
MERCURY_ENABLE_WHATSAPP=false
MERCURY_ENABLE_DISCORD=false
MERCURY_ENABLE_SLACK=false

# Trigger
MERCURY_TRIGGER_PATTERNS=@Mercury,Mercury
```

## API Keys

All endpoints require authentication via `Authorization: Bearer <key>`.

```bash
mercury api-keys create <name>    # Create new key (shown once)
mercury api-keys list             # List keys (prefix only)
mercury api-keys revoke <id>      # Revoke a key
```

The first key is generated during `mercury init`. An internal key is auto-generated at startup for agent subprocess → API communication.

## CLI-Only Mode

If no chat adapters are enabled, Mercury runs with only the HTTP API:

- `POST /chat` — send messages, get replies
- `GET/POST /api/*` — management API
- `mercury chat "hello"` — CLI wrapper

## Data Directory

`` contains all persistent state:

```

├── state.db          # SQLite: conversations, messages, tasks, roles, config, mutes, api keys
├── workspace/        # Agent workspace (AGENTS.md, skills, extensions, inbox, outbox)
├── sessions/         # Per-conversation pi session files
├── extensions/       # Installed Mercury extensions
└── whatsapp-auth/    # WhatsApp credentials (if enabled)
```

## Health Check

```bash
curl -H "Authorization: Bearer <key>" http://localhost:3000/health
```

Returns: `{ status, uptime, queue, agent, adapters }`
