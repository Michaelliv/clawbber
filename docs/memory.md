# Memory

Per-space agent memory via workspace directories and extension-driven vault structures (Obsidian-compatible).

Mercury stores memory per **space** in the space workspace directory. Memory behavior is extension-driven (for example, via a napkin extension).

## How It Works

Each space gets a workspace at:

```text
.mercury/spaces/<space-id>/
```

Core directories Mercury manages:

```text
.mercury/spaces/<space-id>/
├── inbox/              # Media received from users
├── outbox/             # Files produced by the agent
├── AGENTS.md           # Space instructions
└── .mercury.session.jsonl
```

Additional vault structure (for example `.obsidian/`, `knowledge/`, `daily/`, `entities/`) is created by installed extensions.

## Vault Structure

There is no single required memory schema in core Mercury. The exact structure depends on your extension setup.

A common pattern (napkin example) is:

```text
knowledge/
├── people/
├── projects/
├── references/
└── daily/
```

Conversations do not get their own vaults — multiple platform conversations can link into the same space.

## Agent Capabilities

The agent discovers extension commands via installed skills (for example `napkin` skill in `.mercury/extensions/napkin/skill/`).

### Reading

```bash
napkin search "query"              # Find relevant files
napkin read "filename"             # Read a specific file
napkin link back --file "name"     # See what links to a file
napkin daily read                  # Read today's daily note
```

### Writing

```bash
napkin create --name "Liat" --path entities --content "..."
napkin append --file "Liat" --content "..."
napkin property set --file "Liat" --name birthday --value "April 15"
napkin daily append --content "- Discussed vacation plans"
```

### Wikilinks

The agent uses `[[wikilinks]]` when mentioning entities. This creates a navigable graph:

```markdown
---
type: person
relationship: wife
---

# Liat

[[Michael]]'s wife. Planning a surprise party at [[Dizengoff Italian Place]].
```

## User Interaction

Users manage memory through natural chat:

| User says | What happens |
|-----------|--------------|
| "Remember that Liat's birthday is April 15" | Agent writes to `entities/Liat.md` |
| "What do you know about Liat?" | Agent reads and summarizes the entity file |
| "Forget everything about the project" | Agent deletes the entity file |

## Entity Format

Entities are markdown files with optional YAML frontmatter:

```markdown
---
type: person
birthday: April 15
---

# Liat

Context and notes about Liat.

_2026-02-20:_ Booked the Italian place for April 12.
_2026-02-25:_ Changed venue to [[Cafe Nimrod]].
```

- **Frontmatter** — Structured attributes (replace semantics)
- **Body** — Accumulated context (append semantics, timestamped)
- **Wikilinks** — Connections to other entities

## Persistence

Memory persists because the agent writes to disk during conversation. When a session compacts or restarts, the vault files remain — the agent reads them fresh on next interaction.

The vault is plain markdown. You can:
- Open it in Obsidian and browse the graph
- Edit files directly from the host
- Back it up like any other directory

## Configuration

Memory behavior is controlled by installed extensions and their config.

To use a shared Obsidian vault across tools, symlink or mount it:

```bash
ln -s /path/to/your/vault .mercury/spaces/main
```
