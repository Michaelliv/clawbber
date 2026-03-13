# KB Distillation

Extension-driven periodic extraction of conversation history into structured vault knowledge.

KB distillation is **extension-based** in Mercury (not built-in).

As of v0.3.x, Mercury no longer ships a built-in `kb-distill` extension. The recommended approach is to use a user-installed extension (for example, `napkin`) that runs a background job and writes distilled knowledge into each space vault.

---

## Recommended Setup

Use the real example extension at:

- `examples/extensions/napkin/`

It demonstrates:

- `workspace_init` hook to scaffold vault structure
- `before_container` hook to set `NAPKIN_VAULT`
- background job (`distill`) for periodic extraction
- dashboard widget + extension store state

---

## How Distillation Works (Extension Pattern)

Typical flow:

1. Read messages from `state.db` per `space_id`
2. Export messages to `.messages/YYYY-MM-DD.jsonl`
3. Detect changed files (hash compare)
4. Run `pi` with a distillation prompt against changed files
5. Update vault files incrementally (append/update, not destructive rewrite)

This keeps runs idempotent and avoids re-processing unchanged days.

---

## Data Layout (napkin example)

```text
.mercury/spaces/<space-id>/
├── .messages/
│   └── YYYY-MM-DD.jsonl
└── knowledge/
    ├── people/
    ├── projects/
    ├── references/
    ├── daily/
    └── templates/
```

Message export format:

```json
{"ts":1709123456,"role":"ambient","content":"Alice: Great idea!"}
{"ts":1709123457,"role":"user","content":"What do you think about X?"}
{"ts":1709123458,"role":"assistant","content":"I think..."}
```

---

## Configuration

With the napkin example extension:

- `MERCURY_KB_DISTILL_INTERVAL_MS=0` → disabled (default)
- `MERCURY_KB_DISTILL_INTERVAL_MS=3600000` → check every hour

You can also expose interval as extension config keys (see `examples/extensions/napkin/index.ts`).

---

## Notes

- Distillation behavior depends on the installed extension implementation
- Mercury core provides hooks, jobs, DB access, and workspace isolation
- Distillation logic/prompt lives in the extension, not in core Mercury
