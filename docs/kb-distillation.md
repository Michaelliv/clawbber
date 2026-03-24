# KB Distillation

KB distillation is **extension-based** — not built-in to Mercury core.

## How It Works

The `knowledge` extension (from `mercury-extensions`) runs a background job that:

1. Reads messages from `state.db` per conversation
2. Exports messages to `.messages/YYYY-MM-DD.jsonl`
3. Detects changed files (hash compare)
4. Runs `pi` with a distillation prompt against changed files
5. Updates vault files incrementally

## Setup

Install the knowledge extension:

```bash
mercury ext add npm:mercury-ext-knowledge
mercury restart
```

The extension registers:
- A `distill` background job (runs hourly by default)
- A `workspace_init` hook to scaffold vault structure
- A `before_container` hook to set `NAPKIN_VAULT`
- A dashboard widget showing last run time
- A skill for the agent to search/read the vault

## Data Layout

```
workspace/
├── .messages/
│   └── YYYY-MM-DD.jsonl
└── knowledge/
    ├── people/
    ├── projects/
    ├── references/
    ├── daily/
    └── templates/
```

## Configuration

The job interval is set in the extension. Mercury core provides the infrastructure: hooks, jobs, DB access, and the workspace directory.
