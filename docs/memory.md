# Memory

Mercury stores memory in a single workspace directory and per-conversation session files.

## Workspace

```
workspace/
├── inbox/              # Media received from users
├── outbox/             # Files produced by the agent
├── AGENTS.md           # Agent instructions
├── .pi/
│   ├── skills/         # Installed skills (built-in + extension)
│   └── extensions/     # Pi extensions (permission guard)
└── (extension dirs)    # Created by extensions (e.g., knowledge/)
```

The workspace is shared across all conversations. Extensions create additional directories via the `workspace_init` hook.

## Sessions

Each conversation gets its own pi session file:

```
sessions/<conversation-id>/session.jsonl
```

Sessions persist agent conversation history across messages. The `/compact` command resets the session (fresh context). The `/new` command starts a new session without compacting.

## Ambient Messages

Non-triggering messages in paired group conversations are stored as ambient context in the `messages` table. When the agent is triggered, recent ambient messages are included in the prompt so the agent has conversational context.

Format: `AuthorName: message text`

## Message History

The agent receives recent message history (up to 200 messages) from the current conversation, starting after the last session boundary. This includes:
- `user` — messages that triggered the agent
- `assistant` — agent responses
- `ambient` — non-triggering group messages

## Extension-Driven Memory

The workspace structure beyond `inbox/`/`outbox/` is extension-driven. For example, the `knowledge` extension creates a vault with `entities/`, `daily/`, etc. See [kb-distillation.md](kb-distillation.md).

## Persistence

Memory persists because:
1. The workspace is on disk (mounted as `/data/workspace` in Docker)
2. Session files accumulate conversation history
3. The SQLite database stores messages, conversations, tasks, roles, config

The workspace is plain files. You can browse it, edit files directly, or back it up.
