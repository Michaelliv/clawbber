# 🪽 Mercury

<p align="center">
  <em>There are many claws, but this one is mine.</em>
</p>

<p align="center">
  <a href="https://github.com/Michaelliv/mercury"><img alt="GitHub" src="https://img.shields.io/badge/github-mercury-181717?style=flat-square&logo=github" /></a>
  <a href="https://www.npmjs.com/package/mercury-ai"><img alt="npm" src="https://img.shields.io/npm/v/mercury-ai?style=flat-square&logo=npm" /></a>
</p>

Mercury is a personal AI assistant that lives where you chat. It connects to WhatsApp, Slack, and Discord, runs agents inside containers for isolation, and uses [pi](https://pi.dev) as the runtime — giving you persistent sessions, skills, extensions, and the full coding agent toolkit.

---

## Table of Contents

- [Quick Start](#quick-start)
- [How It Works](#how-it-works)
- [Ingress](#ingress)
  - [WhatsApp](#whatsapp)
  - [Slack](#slack)
  - [Discord](#discord)
- [Adding to Groups](#adding-to-groups)
- [Workspaces](#workspaces)
- [Sessions](#sessions)
- [Memory](#memory)
- [Triggers](#triggers)
- [Media](#media)
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
npm install -g mercury
mkdir my-assistant && cd my-assistant
mercury init
```

Edit `.env` with your model credentials:

```bash
ANTHROPIC_API_KEY=sk-ant-...
```

Enable an ingress (e.g., WhatsApp):

```bash
MERCURY_ENABLE_WHATSAPP=true
```

Run:

```bash
mercury run
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
MERCURY_ENABLE_WHATSAPP=true
MERCURY_WHATSAPP_AUTH_DIR=/path/to/auth  # optional, defaults to .mercury/whatsapp-auth
```

On first run, scan the QR code displayed in the terminal.

**Reuse existing auth** (e.g., from nanoclaw):

```bash
MERCURY_WHATSAPP_AUTH_DIR=/path/to/nanoclaw/store/auth
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

## Adding to Groups

Mercury automatically sets up when it receives its first message from a new group — no manual configuration needed.

| Platform | How to add |
|----------|------------|
| **WhatsApp** | Add the phone number to a group (like any contact) |
| **Slack** | Invite the bot to a channel (`/invite @botname`) |
| **Discord** | Add bot to server via OAuth URL, it sees channels it has access to |

On first triggered message (e.g., `@Mercury hello`):
1. Group record created in database
2. Workspace directory created at `.mercury/groups/<group-id>/`
3. Session file initialized
4. Bot starts responding

---

## Workspaces

Each group/thread gets its own workspace directory:

```
.mercury/
├── global/                    # Shared across all groups
│   ├── AGENTS.md              # Global instructions
│   ├── auth.json              # pi OAuth tokens
│   └── .pi/
│       ├── extensions/
│       ├── skills/
│       └── prompts/
├── groups/
│   ├── <group-id>/            # Per-group workspace (Obsidian vault)
│   │   ├── AGENTS.md          # Group-specific instructions
│   │   ├── .mercury.session.jsonl  # pi session file
│   │   ├── .obsidian/         # Obsidian vault marker
│   │   ├── entities/          # Memory: entity pages
│   │   ├── daily/             # Memory: daily notes
│   │   ├── media/             # Downloaded media files
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

Mercury uses native pi session persistence. Each group has a session file at:

```
.mercury/groups/<group-id>/.mercury.session.jsonl
```

Sessions are tree-structured (see [pi session docs](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/docs/session.md)):

- Full conversation history preserved
- Branching and compaction supported
- Survives restarts

**Ambient messages**: Group chatter between your messages is captured and injected as context, so the assistant knows what was discussed.

---

## Memory

Each group workspace is an Obsidian-compatible vault. The agent uses [napkin](https://github.com/michaelliv/napkin-ai) to read, write, and search memory.

```
.mercury/groups/<group-id>/
├── .obsidian/          # Makes it a valid Obsidian vault
├── entities/           # Entity pages (people, projects, things)
├── daily/              # Daily conversation logs
└── AGENTS.md           # Persistent instructions
```

The agent writes memory as markdown files with `[[wikilinks]]`:

```markdown
---
type: person
birthday: April 15
---

# Liat

[[Michael]]'s wife. Planning a surprise party at [[Dizengoff Italian Place]].
```

**User interaction:**

| You say | What happens |
|---------|--------------|
| "Remember that Liat's birthday is April 15" | Agent writes to `entities/Liat.md` |
| "What do you know about Liat?" | Agent reads and summarizes the file |
| "Forget the project" | Agent deletes the entity |

Memory persists across sessions. You can also open the workspace in Obsidian and browse/edit directly.

See [docs/memory.md](docs/memory.md) for details.

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
MERCURY_TRIGGER_MATCH=mention
MERCURY_TRIGGER_PATTERNS=@Mercury,Mercury
```

Or per-group via `mercury-ctl`:

```bash
mercury-ctl config set trigger_match always
mercury-ctl config set trigger_patterns "@Bot,Bot"
```

---

## Media

Mercury downloads media attachments from chat messages and passes them to pi.

### Supported Types

| Type | Description | pi Support |
|------|-------------|------------|
| `image` | Photos, stickers | ✅ Can view |
| `video` | Videos | ❌ Cannot play |
| `voice` | Voice notes | ❌ Cannot play (needs transcription) |
| `audio` | Audio files | ❌ Cannot play |
| `document` | PDFs, docs, etc. | ⚠️ Text files only |

### Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `MERCURY_MEDIA_ENABLED` | `true` | Enable media downloads |
| `MERCURY_MEDIA_MAX_SIZE_MB` | `10` | Max file size to download |

### Storage

Media is saved to the group workspace:

```
.mercury/groups/<group-id>/media/
├── 1709012345-image.jpg
├── 1709012400-voice.ogg
└── 1709012500-report.pdf
```

### Prompt Format

Attachments are passed to pi as XML:

```xml
<attachments>
  <attachment type="image" path="/groups/xxx/media/123.jpg" mime="image/jpeg" size="12345" />
</attachments>

@mercury what's in this image?
```

See [docs/media/overview.md](docs/media/overview.md) for architecture details.

---

## Commands

Chat commands for control (require trigger in groups, work directly in DMs):

| Command | Description |
|---------|-------------|
| `stop` | Abort current run and clear queue |
| `compact` | Set session boundary (fresh context) |

Example: `@Mercury stop`

On process shutdown (`SIGTERM`/`SIGINT`), mercury runs a full teardown sequence — stopping the scheduler, draining the queue, killing containers, disconnecting adapters, and closing the database. See [docs/graceful-shutdown.md](docs/graceful-shutdown.md) for details.

---

## Scheduled Tasks

Create recurring tasks with cron expressions:

```bash
# Inside container via mercury-ctl
mercury-ctl tasks create --cron "0 9 * * *" --prompt "Good morning! What's on my calendar today?"
mercury-ctl tasks list
mercury-ctl tasks pause <id>
mercury-ctl tasks resume <id>
mercury-ctl tasks delete <id>
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
mercury-ctl roles list

# Grant admin role to a user
mercury-ctl roles grant 1234567890@s.whatsapp.net --role admin

# Grant a custom role
mercury-ctl roles grant 1234567890@s.whatsapp.net --role moderator

# Revoke role (user becomes member)
mercury-ctl roles revoke 1234567890@s.whatsapp.net
```

### Managing Permissions

```bash
# Show permissions for all roles
mercury-ctl permissions show

# Show permissions for a specific role
mercury-ctl permissions show --role member

# Give members ability to stop the agent
mercury-ctl permissions set member prompt,stop

# Create a moderator role with task management
mercury-ctl permissions set moderator prompt,stop,tasks.list,tasks.pause,tasks.resume

# Give a role full task control
mercury-ctl permissions set taskmaster prompt,tasks.list,tasks.create,tasks.pause,tasks.resume,tasks.delete
```

### Seeding Admins

Pre-configure admin users via environment variable. They'll be granted admin on first interaction:

```bash
MERCURY_ADMINS=1234567890@s.whatsapp.net,0987654321@s.whatsapp.net
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
mercury-ctl config set <key> <value>
mercury-ctl config get [key]
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

**Image name:** `mercury-agent:latest` (override with `MERCURY_AGENT_CONTAINER_IMAGE`)

**What's mounted:**

| Host | Container |
|------|-----------|
| `MERCURY_PI_AGENT_DIR` | `/home/node/.pi/agent` |
| `MERCURY_GROUPS_DIR` | `/groups` |

---

## CLI Reference

### mercury-ctl

Management CLI available inside the agent container. This is how the AI agent manages tasks, permissions, and configuration — you don't run this directly, but the agent uses it to control mercury from within.

```bash
mercury-ctl whoami                              # Show caller/group info
mercury-ctl stop                                # Abort current run
mercury-ctl compact                             # Reset session boundary

mercury-ctl tasks list                          # List scheduled tasks
mercury-ctl tasks create --cron <expr> --prompt <text>
mercury-ctl tasks pause <id>
mercury-ctl tasks resume <id>
mercury-ctl tasks delete <id>

mercury-ctl roles list                          # List roles in group
mercury-ctl roles grant <user-id> [--role <role>]
mercury-ctl roles revoke <user-id>

mercury-ctl permissions show [--role <role>]    # Show permissions
mercury-ctl permissions set <role> <perm1,perm2,...>

mercury-ctl config get [key]                    # Get group config
mercury-ctl config set <key> <value>            # Set group config
```

### mercury

Main CLI for managing your assistant.

```bash
mercury init         # Initialize project in current directory
mercury run          # Start chat adapters
mercury build        # Rebuild container image
mercury status       # Show status and configuration
```

---

## Environment Variables

### Core

| Variable | Default | Description |
|----------|---------|-------------|
| `MERCURY_DATA_DIR` | `.mercury` | Data directory |
| `MERCURY_MAX_CONCURRENCY` | `3` | Max concurrent agent runs |
| `MERCURY_CHATSDK_PORT` | `3000` | API server port |
| `MERCURY_CHATSDK_USERNAME` | `mercury` | Bot display name |
| `MERCURY_LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error`, `silent` |

### Model

| Variable | Default | Description |
|----------|---------|-------------|
| `MERCURY_MODEL_PROVIDER` | `anthropic` | Model provider |
| `MERCURY_MODEL` | `claude-sonnet-4-20250514` | Model ID |
| `ANTHROPIC_API_KEY` | — | Anthropic API key |
| `OPENAI_API_KEY` | — | OpenAI API key |
| `MERCURY_AUTH_PATH` | — | Path to pi auth.json for OAuth |

### Container

| Variable | Default | Description |
|----------|---------|-------------|
| `MERCURY_AGENT_CONTAINER_IMAGE` | `mercury-agent:latest` | Docker image |
| `MERCURY_PI_AGENT_DIR` | `.mercury/global` | Mounted as `/home/node/.pi/agent` |
| `MERCURY_GROUPS_DIR` | `.mercury/groups` | Mounted as `/groups` |

### Triggers

| Variable | Default | Description |
|----------|---------|-------------|
| `MERCURY_TRIGGER_MATCH` | `mention` | `mention`, `prefix`, `always` |
| `MERCURY_TRIGGER_PATTERNS` | `@Mercury,Mercury` | Comma-separated |
| `MERCURY_ADMINS` | — | Comma-separated admin user IDs |

### Media

| Variable | Default | Description |
|----------|---------|-------------|
| `MERCURY_MEDIA_ENABLED` | `true` | Enable media downloads |
| `MERCURY_MEDIA_MAX_SIZE_MB` | `10` | Max file size (MB) |

### WhatsApp

| Variable | Default | Description |
|----------|---------|-------------|
| `MERCURY_ENABLE_WHATSAPP` | `false` | Enable WhatsApp adapter |
| `MERCURY_WHATSAPP_AUTH_DIR` | `.mercury/whatsapp-auth` | Auth storage path |

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
| `MERCURY_DISCORD_GATEWAY_SECRET` | Optional gateway auth |
| `MERCURY_DISCORD_GATEWAY_DURATION_MS` | Gateway duration |

---

## License

MIT

---

<p align="center">
  <em>There are many claws, but this one is mine.</em> 🪽
</p>
