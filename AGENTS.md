# Mercury

Personal AI assistant for chat platforms. Runs agents in Docker containers using pi as the runtime. Adapters bridge WhatsApp/Slack/Discord/Teams → core → Docker → reply.

AGENTS.md and CLAUDE.md are symlinked. This file is your system prompt. Loads every context window. Every token has a cost. Keep it holy — concise, tight, agents-only.

## Philosophy

- This file + docs/ = diary. Fresh context = amnesia. Recover here first, then docs/ for lost insights, decisions, workarounds.
- docs/ has details. This file references — never duplicates.
- Tooling-enforced rules (Biome, tsconfig) belong nowhere in this file.
- Capabilities > file paths. `git log`, `package.json` scripts = living docs.
- Be extremely concise. Sacrifice grammar for concision. Every interaction, plan, commit, doc.

## Context Recovery

1. Read this file — your diary, your memory
2. `find docs -name "*.md" | sort` — scan docs, read any relevant to task
3. `cat package.json | jq .scripts` — available commands
4. `git log --oneline -20` — recent changes, decisions, context
5. Scan relevant source dirs — ground in actual code

## Identity

Pick role(s) before starting. Compose for multi-domain. Security task → pen tester. Design → UI/UX. Architecture → systems architect.
Delegating: YOU assign each agent a role identity.
Subagents = focused workers, report to you only. Quick isolated tasks.
Teams = direct agent-to-agent communication. Cross-layer coordination.

## Workflow

- New problem → issue with full overview → branch → PR. Never push to main.
- Conventional commits: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- Branches: `issue-<num>-<slug>` for GitHub issues
- Git history IS documentation — insightful commits, not descriptive. Searchable record of decisions.
- Plans: self-contained — include data, insights, decisions, constants. Fresh-context agent must execute without your memory.
- End plans with unresolved questions.

## Architecture

Mercury = host, not framework. Adapters, extensions, agents are pluggable.

- **Adapters** receive platform messages, normalize via bridges
- **Core** routes messages, manages spaces/conversations, enforces RBAC, schedules tasks
- **Agent runner** spawns short-lived Docker containers, passes context, collects replies
- **Extensions** add CLIs, hooks, background jobs, skills, config keys at runtime
- **Storage** SQLite (spaces, conversations, messages, tasks, roles, config) + workspace dirs

Non-obvious:

- `MERCURY_*` env vars passed into containers with prefix stripped — `MERCURY_FOO` → `FOO`. Extensions use `mercury.env()` to declare needed vars.
- Spaces ≠ conversations. Conversations auto-discovered from traffic; spaces created explicitly. Must link conversation → space before agent can use memory.
- Extension names reserved against built-in commands (`tasks`, `roles`, `config`) — collision = silent failure.
- Docker image cache key = content hash. Changing extension code busts cache automatically.
- Outbox is mtime-based, not inotify. Tests writing files too fast can race.

→ docs/pipeline.md, docs/extensions.md, docs/container-lifecycle.md

## Running

Background: `mercury service install|status|logs|uninstall` → docs/deployment.md

## Safety

- Never kill processes by port (`lsof -ti:8787 | xargs kill`) — can kill the agent. Use `mercury service uninstall`.
- Never run `mercury run` directly — use `mercury service install`. Direct runs block terminal, no auto-restart.

## Conventions

- Tests: co-located in `tests/`, use temp DBs
- Config: all via env vars, parsed in `src/config.ts` with Zod
- Errors: typed errors from `container-error.ts`

## Docs Index

**Core:** pipeline | extensions | container-lifecycle | permissions | memory
**Auth:** auth/overview | auth/whatsapp
**Media:** media/overview | media/whatsapp
**Operations:** deployment | scheduler | rate-limiting | graceful-shutdown
**Features:** subagents | web-search | kb-distillation

All docs in `docs/`. Read on demand — don't front-load.
