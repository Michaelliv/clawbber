# KB Distillation

Mercury can automatically extract lasting knowledge from conversations and save it to an Obsidian-compatible vault. The KB distiller runs periodically, processing daily message logs and updating entity files.

## How It Works

```
Runtime (interval)
  │
  └─► kbDistill()
        │
        ├─► Export messages to .messages/YYYY-MM-DD.jsonl
        │
        ├─► Compare MD5 hash before/after
        │
        ├─► If changed → run kb-distiller agent
        │
        └─► Agent updates vault (entities/, daily/)
```

The distiller exports messages from the database to daily JSONL files. If a file's content changed (detected via MD5 hash), it runs an AI agent to extract knowledge and update the vault.

## Message Export

Messages are exported to daily partition files:

```
.mercury/groups/<group-id>/
├── .messages/
│   ├── 2026-02-28.jsonl
│   └── 2026-03-01.jsonl
└── entities/
    └── ...                  # Distilled knowledge
```

Each line in the JSONL file:

```json
{"ts":1709123456,"role":"ambient","content":"Alice: Great idea!"}
{"ts":1709123457,"role":"user","content":"What do you think about X?"}
{"ts":1709123458,"role":"assistant","content":"I think..."}
```

| Role | Description |
|------|-------------|
| `ambient` | Group chat message (format: `Name: content`) |
| `user` | Message that triggered the assistant |
| `assistant` | Assistant's response |

## Configuration

Enable via environment variable:

```bash
# Run every hour (3600000ms)
MERCURY_KB_DISTILL_INTERVAL_MS=3600000

# Disable (default)
MERCURY_KB_DISTILL_INTERVAL_MS=0
```

| Value | Behavior |
|-------|----------|
| `0` | Disabled (default) |
| `> 0` | Runs on that interval in milliseconds |

When enabled, distillation runs immediately on startup, then every interval.

## CLI Usage

Run manually via CLI:

```bash
# Process today's changed messages
mercury kb-distill

# Process all changed historical messages
mercury kb-distill --backfill
```

## What Gets Extracted

The distiller extracts three types of knowledge:

### People

Created when someone has 3+ messages, shares a resource, or states a clear position.

```markdown
# Alice

## Expertise
- AI agents
- Product development

## Positions
- Believes agents will replace traditional apps

## Resources Shared
- [[some-tool]]
```

### Resources

Tools, repos, articles, or URLs shared in conversation.

```markdown
# Some Tool

Type: tool
URL: https://example.com
Shared by: [[alice]] on 2026-02-28

## What it does
Description of the tool.

## Why shared
Context for why it was mentioned.
```

### Group Knowledge

Decisions and conclusions reached by the group.

```markdown
# Architecture Decision

Date: 2026-02-28
Participants: [[alice]], [[bob]]

## Question
Should we use approach A or B?

## Conclusion
Go with approach A for reasons X, Y, Z.
```

## Vault Structure

Distilled knowledge goes into the group's existing vault:

```
.mercury/groups/<group-id>/
├── .messages/              # Input (JSONL files)
├── entities/
│   ├── people/             # Person entities
│   ├── resources/          # Tools, repos, articles
│   └── group-knowledge/    # Decisions, conclusions
├── daily/                  # Daily notes
└── .obsidian/              # Obsidian compatibility
```

## Change Detection

The distiller uses MD5 hashing to detect changes:

1. Read existing JSONL file (if any) and compute hash
2. Regenerate file from database
3. Compute hash of new content
4. If hashes differ → file changed → run distiller

This avoids unnecessary distillation runs when no new messages arrived.

## Incremental Updates

The distiller agent is idempotent:

1. Searches vault before creating entities
2. Appends to existing files rather than overwriting
3. Skips already-processed information

This means running distillation multiple times on the same data is safe.

## What Gets Skipped

The distiller ignores:

- Thin interactions (greetings, acknowledgments)
- Encyclopedia-style definitions
- Transient chatter
- `<reply_to>` blocks (quoted messages)
- Tool outputs

## Lifecycle

```
mercury run
  │
  ├─► runtime.initialize()
  │
  ├─► startKbDistill()
  │     ├─► Run immediately
  │     └─► Schedule interval
  │
  ├─► ... running ...
  │
  └─► SIGTERM/SIGINT
        └─► stopKbDistill()
              └─► Clear interval (graceful)
```

## Dependencies

- **[pi](https://github.com/mariozechner/pi)** — Agent runtime
- **[napkin](https://github.com/michaelliv/napkin-ai)** — Obsidian vault CLI

Both must be installed and available in PATH.

## Backfill

To process historical conversations:

```bash
mercury kb-distill --backfill
```

This processes all changed JSONL files across all dates. Safe to run multiple times.

## Troubleshooting

### No changes to distill

The distiller only runs when file content has changed. If messages haven't changed since the last export, nothing happens.

### Force re-distillation

Delete the JSONL files to force regeneration:

```bash
rm .mercury/groups/<group-id>/.messages/*.jsonl
mercury kb-distill --backfill
```
