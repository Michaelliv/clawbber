---
name: mercury-setup
description: Guide Mercury setup from scratch — install, authenticate, configure adapters, seed admin, and run. Use when the user asks how to set up Mercury, configure a new instance, or connect a chat platform.
---

## Prerequisites

- **Docker** — Mercury runs agents in containers. Install [Docker Desktop](https://www.docker.com/products/docker-desktop/) or Docker Engine.
- **Bun >= 1.2.0** — Runtime. Install: `curl -fsSL https://bun.sh/install | bash`

Verify:
```bash
docker --version && docker info > /dev/null 2>&1 && echo "Docker OK"
bun --version  # Should print >= 1.2.0
```

## Install & Initialize

```bash
npm install -g mercury-ai
mkdir my-assistant && cd my-assistant
mercury init
```

This creates `.env`, `AGENTS.md`, and the `.mercury/` data directory.

## Authenticate

Mercury needs an AI model provider. Choose one:

### Option A: OAuth Login (recommended)

```bash
mercury auth login              # Interactive provider picker
mercury auth login anthropic    # Or specify provider directly
```

Supported: Anthropic (Claude Pro/Max), GitHub Copilot, Google Gemini CLI, ChatGPT Plus/Pro.

### Option B: API Key

Set in `.env`:
```bash
MERCURY_ANTHROPIC_API_KEY=sk-ant-...
```

Verify auth:
```bash
mercury auth status
```

## Configure Identity

Edit `.env`:
```bash
MERCURY_CHATSDK_USERNAME=Mercury       # Bot display name
MERCURY_TRIGGER_PATTERNS=@Mercury      # Comma-separated trigger words
MERCURY_MODEL_PROVIDER=anthropic       # anthropic | openai
MERCURY_MODEL=claude-sonnet-4-20250514 # Model to use
```

## Connect a Chat Platform

Enable one or more adapters in `.env`. See reference docs for detailed setup:

| Platform | Reference | Key env vars |
|----------|-----------|-------------|
| WhatsApp | [whatsapp.md](references/whatsapp.md) | `MERCURY_ENABLE_WHATSAPP` |
| Discord | [discord.md](references/discord.md) | `MERCURY_ENABLE_DISCORD`, `MERCURY_DISCORD_BOT_TOKEN` |
| Slack | [slack.md](references/slack.md) | `MERCURY_ENABLE_SLACK`, `MERCURY_SLACK_BOT_TOKEN`, `MERCURY_SLACK_SIGNING_SECRET` |
| Teams | [teams.md](references/teams.md) | `MERCURY_ENABLE_TEAMS`, `MERCURY_TEAMS_APP_ID`, `MERCURY_TEAMS_APP_PASSWORD` |

## Seed Admin (optional)

Set admin caller IDs so privileged commands work from day one:
```bash
MERCURY_ADMINS=caller-id-1,caller-id-2
```

See [user-ids.md](references/user-ids.md) for how to find your caller ID on each platform.

## First Run

```bash
mercury run
```

Or install as a background service:
```bash
mercury service install
mercury service status
mercury service logs -f
```

## Test It

Send a message from your connected platform. Mercury should reply.

If it doesn't, check:
1. `mercury auth status` — is auth configured?
2. Docker running? `docker info`
3. Adapter enabled? Check `.env`
4. See [troubleshooting.md](references/troubleshooting.md)

## Set Up Spaces

Mercury discovers conversations from incoming traffic. Link them to spaces (memory boundaries):

```bash
mercury spaces create main
mercury conversations --unlinked   # See discovered conversations
mercury link <id> main             # Link to a space
```
