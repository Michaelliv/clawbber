# Private Project Report — clawsome

Date: 2026-02-25

## Current State

clawsome is running as a NanoClaw-style orchestrator with:
- ingress via Chat SDK (currently WhatsApp enabled)
- per-message agent execution in Docker containers
- full `pi` CLI runtime inside container (`bun x pi`)
- per-thread workspace isolation under `CLAWSOME_GROUPS_DIR`
- global pi environment mounted from host `CLAWSOME_PI_AGENT_DIR` to `/home/node/.pi/agent`

## Key Runtime Behavior

### Session model
- pi native session persistence is enabled (`--session <groupWorkspace>/.clawsome.session.json`)
- one pi session file per thread/workspace
- DB still stores message records for routing/context support

### Triggering behavior
- DMs: no `@Mick` needed (auto-mention path in WhatsApp adapter)
- Groups: trigger required for commands/prompts (`@Mick ...`)
- `/compact` is delegated to native pi behavior
- `/stop` supported
- `/new` removed

### Group context handling
- non-trigger group messages are stored as `ambient` in DB
- prompt context window uses messages since previous user trigger

## Environment layering

### Global env (shared)
- Source: `CLAWSOME_PI_AGENT_DIR`
- Mount target in container: `/home/node/.pi/agent`
- Supports global `AGENTS.md`, `SYSTEM.md`, `APPEND_SYSTEM.md`, `skills/`, `prompts/`, `extensions/`

### Per-session env
- Source root: `CLAWSOME_GROUPS_DIR`
- Workspace: one directory per thread (`<groups>/<sanitized-thread-id>`)
- Workspace has `.pi/` directory for project-local resources
- `AGENTS.md` (or `CLAUDE.md`) is used as per-session memory/context file

## Operational Notes

- Current agent image: `oven/bun:1.3`
- Container entrypoint: `src/container-agent-entry.ts`
- Host runtime session: `tmux` session `clawsome-chat` (terminated per user request)

## Recommended next cleanup tasks

1. Remove now-unused helper `resetGroupPiSession()` from `src/memory.ts` if not needed.
2. Decide final strategy for DB context vs pure pi session context to avoid duplicate history signals.
3. Add a lightweight runtime command for diagnostics (`/status`) to show active run + queue depth per thread.
4. Add minimal tests around router command handling (`stop`, `compact`, DM/group trigger rules).
