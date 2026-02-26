# 🦞 clawbber

<p align="center">
  <em>There are many claws, but this one is mine.</em>
</p>

<p align="center">
  <a href="https://github.com/Michaelliv/clawbber"><img alt="GitHub" src="https://img.shields.io/badge/github-clawbber-181717?style=flat-square&logo=github" /></a>
</p>

Clawbber is a personal AI assistant that lives where you chat. It connects to WhatsApp, Slack, and Discord, runs agents inside containers for isolation, and uses [pi](https://pi.dev) as the runtime — giving you persistent sessions, skills, extensions, and the full coding agent toolkit.

---

## Table of Contents

- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Ingress](#ingress)
  - [WhatsApp](#whatsapp)
  - [Slack](#slack)
  - [Discord](#discord)
- [Workspaces](#workspaces)
- [Sessions](#sessions)
- [Triggers](#triggers)
- [Commands](#commands)
- [Scheduled Tasks](#scheduled-tasks)
- [Permissions](#permissions)
- [Configuration](#configuration)
- [Container Agent](#container-agent)
- [CLI Reference](#cli-reference)
- [Environment Variables](#environment-variables)

---

## Quick Start

```bash
git clone https://github.com/Michaelliv/clawbber
cd clawbber
cp .env.example .env
bun install
```

Set your model credentials in `.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
# or use pi's OAuth via CLAWBBER_AUTH_PATH
```

Enable an ingress (e.g., WhatsApp):

```bash
CLAWBBER_ENABLE_WHATSAPP=true
```

Build the container image and run:

```bash
./container/build.sh
bun run dev:chat
```

Scan the QR code with WhatsApp, then message yourself or a group where the bot is present.

---

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                         Host Process                            │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │ WhatsApp │  │  Slack   │  │ Discord  │  │    Scheduler     │ │
│  │ Adapter  │  │ Adapter  │  │ Adapter  │  │  (cron tasks)    │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────────┬─────────┘ │
│       │             │             │                 │           │
│       └─────────────┴─────────────┴─────────────────┘           │
│                             │                                   │
│                    ┌────────▼────────┐                          │
│                    │  Router/Queue   │                          │
│                    │  (trigger, auth,│                          │
│                    │   permissions)  │                          │
│                    └────────┬────────┘                          │
│                             │                                   │
│                    ┌────────▼────────┐                          │
│                    │   SQLite DB     │                          │
│                    │ (groups, roles, │                          │
│                    │  tasks, config) │                          │
│                    └────────┬────────┘                          │
└─────────────────────────────┼───────────────────────────────────┘
                              │
                    ┌─────────▼─────────┐
                    │  Docker Container │
                    │  ┌─────────────┐  │
                    │  │   pi CLI    │  │
                    │  │  (--print   │  │
                    │  │  --session) │  │
                    │  └─────────────┘  │
                    │                   │
                    │  Mounts:          │
                    │  • /groups/<id>   │
                    │  • ~/.pi/agent    │
                    └───────────────────┘
```

- **Host process**: Routing, queueing, scheduling, persistence
- **Container process**: Full pi runtime with session persistence
- **One session per group**: Each chat thread maintains its own pi session file
- **Ambient context**: Group messages between turns are injected as context

---

## Ingress

Enable any combination of chat platforms.

### WhatsApp

Uses [Baileys](https://github.com/WhiskeySockets/Baileys) for WhatsApp Web socket connection.

```bash
CLAWBBER_ENABLE_WHATSAPP=true
CLAWBBER_WHATSAPP_AUTH_DIR=/path/to/auth  # optional, defaults to .clawbber/whatsapp-auth
```

On first run, scan the QR code displayed in the terminal.

**Reuse existing auth** (e.g., from nanoclaw):

```bash
CLAWBBER_WHATSAPP_AUTH_DIR=/path/to/nanoclaw/store/auth
```

### Slack

```bash
SLACK_BOT_TOKEN=xoxb-...
SLACK_SIGNING_SECRET=...
```

Endpoint: `POST /webhooks/slack`

### Discord

```bash
DISCORD_BOT_TOKEN=...
DISCORD_PUBLIC_KEY=...
DISCORD_APPLICATION_ID=...
```

Endpoint: `POST /webhooks/discord`

Optional gateway trigger: `GET /discord/gateway`

---

## Workspaces

Each group/thread gets its own workspace directory:

```
.clawbber/
├── global/                    # Shared across all groups
│   ├── AGENTS.md              # Global instructions
│   ├── auth.json              # pi OAuth tokens
│   └── .pi/
│       ├── extensions/
│       ├── skills/
│       └── prompts/
├── groups/
│   ├── <group-id>/            # Per-group workspace
│   │   ├── AGENTS.md          # Group-specific instructions
│   │   ├── .clawbber.session.jsonl  # pi session file
│   │   └── .pi/
│   │       ├── extensions/
│   │       ├── skills/
│   │       └── prompts/
│   └── main/                  # Admin DM workspace
└── state.db                   # SQLite database
```

Workspaces are mounted into the container, so:
- You can edit files from the host
- The agent can edit files via tools
- pi discovers AGENTS.md, skills, extensions, and prompts per workspace

---

## Sessions

Clawbber uses native pi session persistence. Each group has a session file at:

```
.clawbber/groups/<group-id>/.clawbber.session.jsonl
```

Sessions are tree-structured (see [pi session docs](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs/session.md)):

- Full conversation history preserved
- Branching and compaction supported
- Survives restarts

**Ambient messages**: Group chatter between your messages is captured and injected as context, so the assistant knows what was discussed.

---

## Triggers

Control when the assistant responds.

| Mode | Behavior |
|------|----------|
| `mention` | Responds to @mentions or name (default) |
| `prefix` | Responds when message starts with trigger |
| `always` | Responds to every message (DMs always respond) |

Configure globally:

```bash
CLAWBBER_TRIGGER_MATCH=mention
CLAWBBER_TRIGGER_PATTERNS=@Clawbber,Clawbber
```

Or per-group via `clawbber-ctl`:

```bash
clawbber-ctl config set trigger_match always
clawbber-ctl config set trigger_patterns "@Bot,Bot"
```

---

## Commands

Chat commands for control (require trigger in groups, work directly in DMs):

| Command | Description |
|---------|-------------|
| `stop` | Abort current run and clear queue |
| `compact` | Set session boundary (fresh context) |

Example: `@Clawbber stop`

---

## Scheduled Tasks

Create recurring tasks with cron expressions:

```bash
# Inside container via clawbber-ctl
clawbber-ctl tasks create --cron "0 9 * * *" --prompt "Good morning! What's on my calendar today?"
clawbber-ctl tasks list
clawbber-ctl tasks pause <id>
clawbber-ctl tasks resume <id>
clawbber-ctl tasks delete <id>
```

Tasks run in the context of the current group with the creator's permissions.

---

## Permissions

Role-based access control per group. Each user has a role, and each role has a set of permissions.

### Roles

| Role | Default Permissions | Description |
|------|---------------------|-------------|
| `system` | All | Internal system caller (scheduler, etc.) — not assignable |
| `admin` | All | Full control over the group |
| `member` | `prompt` | Can chat with the assistant (default for new users) |

Custom roles can be created by assigning permissions to any role name.

### Permissions

| Permission | Description |
|------------|-------------|
| `prompt` | Send messages to the assistant |
| `stop` | Abort running agent and clear queue |
| `compact` | Reset session boundary (fresh context) |
| `tasks.list` | View scheduled tasks |
| `tasks.create` | Create new scheduled tasks |
| `tasks.pause` | Pause scheduled tasks |
| `tasks.resume` | Resume paused tasks |
| `tasks.delete` | Delete scheduled tasks |
| `config.get` | Read group configuration |
| `config.set` | Modify group configuration |
| `roles.list` | View roles in the group |
| `roles.grant` | Assign roles to users |
| `roles.revoke` | Remove roles from users |
| `permissions.get` | View role permissions |
| `permissions.set` | Modify role permissions |

### Managing Roles

```bash
# List all roles in the current group
clawbber-ctl roles list

# Grant admin role to a user
clawbber-ctl roles grant 1234567890@s.whatsapp.net --role admin

# Grant a custom role
clawbber-ctl roles grant 1234567890@s.whatsapp.net --role moderator

# Revoke role (user becomes member)
clawbber-ctl roles revoke 1234567890@s.whatsapp.net
```

### Managing Permissions

```bash
# Show permissions for all roles
clawbber-ctl permissions show

# Show permissions for a specific role
clawbber-ctl permissions show --role member

# Give members ability to stop the agent
clawbber-ctl permissions set member prompt,stop

# Create a moderator role with task management
clawbber-ctl permissions set moderator prompt,stop,tasks.list,tasks.pause,tasks.resume

# Give a role full task control
clawbber-ctl permissions set taskmaster prompt,tasks.list,tasks.create,tasks.pause,tasks.resume,tasks.delete
```

### Seeding Admins

Pre-configure admin users via environment variable. They'll be granted admin on first interaction:

```bash
CLAWBBER_ADMINS=1234567890@s.whatsapp.net,0987654321@s.whatsapp.net
```

### Permission Inheritance

- Permissions are **per-group** — a user can be admin in one group and member in another
- Custom role permissions override defaults for that group only
- The `system` role always has all permissions and cannot be modified

---

## Configuration

### Global (environment)

Set in `.env` or environment. See [Environment Variables](#environment-variables).

### Per-group (database)

```bash
clawbber-ctl config set <key> <value>
clawbber-ctl config get [key]
```

Available keys:
- `trigger_match` — `mention`, `prefix`, `always`
- `trigger_patterns` — Comma-separated patterns
- `trigger_case_sensitive` — `true` or `false`

---

## Container Agent

The agent runs inside a Docker container with:

- Full pi CLI (`pi --print --session <path>`)
- Your pi auth, extensions, skills, prompts mounted
- Group workspace as working directory
- Network access for tools

**Build the image:**

```bash
./container/build.sh
```

**Image name:** `clawbber-agent:latest` (override with `CLAWBBER_AGENT_CONTAINER_IMAGE`)

**What's mounted:**

| Host | Container |
|------|-----------|
| `CLAWBBER_PI_AGENT_DIR` | `/home/node/.pi/agent` |
| `CLAWBBER_GROUPS_DIR` | `/groups` |

---

## CLI Reference

### clawbber-ctl

Management CLI for use inside containers (or via `docker exec`).

```bash
clawbber-ctl whoami                              # Show caller/group info
clawbber-ctl stop                                # Abort current run
clawbber-ctl compact                             # Reset session boundary

clawbber-ctl tasks list                          # List scheduled tasks
clawbber-ctl tasks create --cron <expr> --prompt <text>
clawbber-ctl tasks pause <id>
clawbber-ctl tasks resume <id>
clawbber-ctl tasks delete <id>

clawbber-ctl roles list                          # List roles in group
clawbber-ctl roles grant <user-id> [--role <role>]
clawbber-ctl roles revoke <user-id>

clawbber-ctl permissions show [--role <role>]    # Show permissions
clawbber-ctl permissions set <role> <perm1,perm2,...>

clawbber-ctl config get [key]                    # Get group config
clawbber-ctl config set <key> <value>            # Set group config
```

### Host process

```bash
bun run dev:chat      # Development mode with chat adapters
bun run dev           # Development mode (API only)
bun run start         # Production mode
```

---

## Environment Variables

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWBBER_DATA_DIR` | `.clawbber` | Data directory |
| `CLAWBBER_MAX_CONCURRENCY` | `3` | Max concurrent agent runs |
| `CLAWBBER_CHATSDK_PORT` | `3000` | API server port |
| `CLAWBBER_CHATSDK_USERNAME` | `clawbber` | Bot display name |
| `CLAWBBER_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

### Model

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWBBER_MODEL_PROVIDER` | `anthropic` | Model provider |
| `CLAWBBER_MODEL` | `claude-sonnet-4-20250514` | Model ID |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `CLAWBBER_AUTH_PATH` | — | Path to pi auth.json for OAuth |

### Container

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWBBER_AGENT_CONTAINER_IMAGE` | `clawbber-agent:latest` | Docker image |
| `CLAWBBER_PI_AGENT_DIR` | `.clawbber/global` | Mounted as `/home/node/.pi/agent` |
| `CLAWBBER_GROUPS_DIR` | `.clawbber/groups` | Mounted as `/groups` |

### Triggers

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWBBER_TRIGGER_MATCH` | `mention` | `mention`, `prefix`, `always` |
| `CLAWBBER_TRIGGER_PATTERNS` | `@Clawbber,Clawbber` | Comma-separated |
| `CLAWBBER_ADMINS` | — | Comma-separated admin user IDs |

### WhatsApp

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAWBBER_ENABLE_WHATSAPP` | `false` | Enable WhatsApp adapter |
| `CLAWBBER_WHATSAPP_AUTH_DIR` | `.clawbber/whatsapp-auth` | Auth storage path |

### Slack

| Variable | Description |
|----------|-------------|
| `SLACK_BOT_TOKEN` | Slack bot token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | Slack signing secret |

### Discord

| Variable | Description |
|----------|-------------|
| `DISCORD_BOT_TOKEN` | Discord bot token |
| `DISCORD_PUBLIC_KEY` | Discord public key |
| `DISCORD_APPLICATION_ID` | Discord application ID |
| `CLAWBBER_DISCORD_GATEWAY_SECRET` | Optional gateway auth |
| `CLAWBBER_DISCORD_GATEWAY_DURATION_MS` | Gateway duration |

---

## License

MIT

---

<p align="center">
  <em>There are many claws, but this one is mine.</em> 🦞
</p>
