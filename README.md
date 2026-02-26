# clawbber

NanoClaw-style personal assistant with:
- single orchestrator process
- ingress via Chat SDK adapters (WhatsApp via Baileys, Slack, Discord)
- agent execution always inside Docker containers via full `pi` CLI runtime (not a custom tool loop)

## Architecture (NanoClaw-style)

- Host process: routing, queueing, scheduling, persistence
- Container process: full pi runtime (`pi --print`) via `src/container-agent-entry.ts`
- Host pi environment mounted into container (`CLAWBBER_PI_AGENT_DIR` -> `/home/node/.pi/agent`)
- Group workspaces mounted into container at `/groups`

## Quick start

```bash
cd clawbber
cp .env.example .env
bun install
bun run dev:chat
```

## Ingress options

Enable any combination:

- WhatsApp (Baileys socket):
  - `CLAWBBER_ENABLE_WHATSAPP=true`
  - `CLAWBBER_WHATSAPP_AUTH_DIR=...`
- Slack (webhook):
  - `SLACK_BOT_TOKEN`
  - `SLACK_SIGNING_SECRET`
  - endpoint: `POST /webhooks/slack`
- Discord (webhook + optional gateway trigger):
  - `DISCORD_BOT_TOKEN`
  - `DISCORD_PUBLIC_KEY`
  - `DISCORD_APPLICATION_ID`
  - endpoint: `POST /webhooks/discord`
  - gateway trigger: `GET /discord/gateway`

## Reuse existing NanoClaw WhatsApp auth

Set:

```env
CLAWBBER_WHATSAPP_AUTH_DIR=/absolute/path/to/nanoclaw/store/auth
```

Then run `bun run dev:chat`.

This reuses your existing pi auth/settings/extensions/packages exactly as configured in `CLAWBBER_PI_AGENT_DIR`.

## Resource-loader compatible environment mounts

clawbber mirrors pi's resource-loader expectations:

- **Global env** (all sessions): `CLAWBBER_PI_AGENT_DIR` mounted to `/home/node/.pi/agent`
  - put global files here: `AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, `skills/`, `prompts/`, `extensions/`
- **Per-session env** (per chat thread): `CLAWBBER_GROUPS_DIR/<session>/` mounted under `/groups`
  - each session runs with `cwd=/groups/<session>`
  - put per-session files here: `AGENTS.md` (or `CLAUDE.md`), `.pi/SYSTEM.md`, `.pi/APPEND_SYSTEM.md`, `.pi/{skills,prompts,extensions}/`

Both mounts are read-write, so:
- users can edit from the host filesystem
- the agent can edit from inside the container via tools

## Notes

- Agent runtime is always containerized via `CLAWBBER_AGENT_CONTAINER_IMAGE`.
- Logging level: `CLAWBBER_LOG_LEVEL` (`debug`, `info`, `warn`, `error`, `silent`).
